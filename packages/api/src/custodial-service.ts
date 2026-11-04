import { writeAuditEntry } from "@matms/db";
import type { AuditTransaction, Database } from "@matms/db";
import { custodialBalances, custodialClassificationPolicies, custodialCountAssignments, custodialCountLines, custodialCountOmissions, custodialCounts, custodialFormProfiles, custodialImportBatches, custodialImportRows, custodialItemCodes, custodialItems, custodialLots, custodialMasterReplays, custodialOperations, custodialPropertyExceptions, custodialReportExports, custodialSections, custodialTransactions } from "@matms/db/schema/custodial-inventory";
import { userProfiles } from "@matms/db/schema/identity";
import { user } from "@matms/db/schema/auth";
import { bookableResources } from "@matms/db/schema/scheduling";
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { projectCustodialLedger } from "./custodial-ledger";
import { calculatePhysicalCountVariance } from "./physical-count-calculation";
import { inspectIsolatedInventoryWorkbook } from "./custodial-import-isolation";

export class CustodialError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "INSUFFICIENT_STOCK" | "NOT_FOUND" | "RATE_LIMITED", message: string) { super(message); }
}

type Actor = { id: string };
type PostInput = { balanceId: string; destinationBalanceId?: string; operationId: string; type: "opening" | "receipt" | "issue" | "return" | "transfer" | "adjustment"; quantity: number; expectedVersion?: number; transactionDate: string; reference: string; reason: string; counterparty?: string; daysToConsume?: number; confirmBackdated?: boolean; backdatedPreviewHash?: string; correlationId: string };
type Result = { operationId: string; balances: Array<{ id: string; quantity: number; version: number }> };

function required(value: string) { if (!value.trim() || value.length > 1000) throw new CustodialError("VALIDATION", "A valid reference and reason are required."); }
function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
async function beginMaster(tx: AuditTransaction, actor: Actor, operationId: string, kind: string, payload: unknown) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new CustodialError("VALIDATION", "A valid operation ID is required.");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId.toLowerCase()}, 0))`);
  const hash = fingerprint({ actorId: actor.id, kind, payload });
  const [prior] = await tx.select().from(custodialMasterReplays).where(eq(custodialMasterReplays.operationId, operationId));
  const [posting] = await tx.select({ id: custodialOperations.id }).from(custodialOperations).where(eq(custodialOperations.operationId, operationId));
  if (posting || (prior && (prior.actorId !== actor.id || prior.kind !== kind || prior.fingerprint !== hash))) throw new CustodialError("CONFLICT", "Operation ID was used for a different action.");
  return { hash, prior };
}
async function saveMaster(tx: AuditTransaction, actor: Actor, operationId: string, kind: string, hash: string, targetId: string, result: unknown) {
  await tx.insert(custodialMasterReplays).values({ operationId, actorId: actor.id, kind, fingerprint: hash, targetId, result: JSON.parse(JSON.stringify(result)) });
}
function savedResult<T>(result: unknown): T {
  const value = result as Record<string, unknown>;
  for (const key of ["createdAt", "updatedAt"]) if (typeof value[key] === "string") value[key] = new Date(value[key] as string);
  return value as T;
}
async function authorize(db: Pick<Database, "select">, actor: Actor) {
  // Hold the account row through mutations and replays, so a concurrent role
  // change cannot commit between authorization and the inventory write.
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).limit(1).for("share");
  if (!profile?.active || (profile.role !== "admin" && profile.role !== "property_custodian") || profile.mustChangePassword) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  return profile;
}

async function authorizeRead(db: Pick<Database, "select">, actor: Actor, history = false) {
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).limit(1).for("share");
  if (!profile?.active || profile.mustChangePassword || (history && profile.role === "viewer")) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  return profile;
}

async function lockCustodialSources(tx: AuditTransaction, exclusive = false) {
  if (exclusive) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('custodial-count-source', 3))`);
  else await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('custodial-count-source', 3))`);
}

async function lockPropertyNumber(tx: AuditTransaction, fundCluster: string, propertyNumber: string) {
  const key = JSON.stringify([fundCluster, propertyNumber]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1))`);
}

/** Stage evidence only; no item, balance, ledger or count is created here. */
export async function stageCustodialImport(db: Database, actor: Actor, input: { filename: string; bytes: Uint8Array; operationId: string; correlationId: string; classificationPolicyId?: string }, workerPath: string) {
  await authorize(db, actor);
  if (!input.bytes.length || input.bytes.length > 8 * 1024 * 1024) throw new CustodialError("VALIDATION", "Workbook size is unsupported.");
  if (input.classificationPolicyId && !z.uuid().safeParse(input.classificationPolicyId).success) throw new CustodialError("VALIDATION", "Classification policy is unavailable.");
  const [policy] = input.classificationPolicyId ? await db.select().from(custodialClassificationPolicies).where(eq(custodialClassificationPolicies.id, input.classificationPolicyId)) : [];
  if (input.classificationPolicyId && !policy) throw new CustodialError("NOT_FOUND", "Classification policy is unavailable.");
  const bytes = Uint8Array.from(input.bytes);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const inspection = await inspectIsolatedInventoryWorkbook(bytes, input.filename, workerPath, policy?.threshold);
  if (inspection.family === "rpcsp" && !policy) throw new CustodialError("VALIDATION", "A reviewed classification policy is required for RPCSP import.");
  if (inspection.sourceHash !== sourceHash) throw new CustodialError("CONFLICT", "Workbook evidence does not match the uploaded file.");
  const evidenceRows = inspection.sheets.flatMap((sheet) => sheet.rows);
  if (evidenceRows.length > 15000) throw new CustodialError("VALIDATION", "Workbook contains too many rows.");
  const values = { filename: input.filename, sourceHash, family: inspection.family, classificationThreshold: policy?.threshold ?? null, classificationPolicyId: policy?.id ?? null };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "import.stage", values);
    if (replay.prior) {
      const [current] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, replay.prior.targetId));
      if (!current || current.status === "expired" || (current.status === "staged" && current.expiresAt <= new Date())) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
      return savedResult<{ id: string; family: string; rowCount: number; duplicateBatchIds: string[] }>(replay.prior.result);
    }
    const duplicates = await tx.select({ id: custodialImportBatches.id }).from(custodialImportBatches).where(and(eq(custodialImportBatches.sourceHash, sourceHash), or(eq(custodialImportBatches.status, "committed"), and(eq(custodialImportBatches.status, "staged"), sql`${custodialImportBatches.expiresAt} > now()`)))).orderBy(desc(custodialImportBatches.createdAt), desc(custodialImportBatches.id)).limit(100);
    const rawBase64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const metadataEvidence = inspection.sheets.map(({ name, metadata, signatures }) => ({ sheet: name, metadata, signatures }));
    const [batch] = await tx.insert(custodialImportBatches).values({ sourceHash, filename: input.filename, family: inspection.family, rawBase64, classificationThreshold: values.classificationThreshold, classificationPolicyId: values.classificationPolicyId, metadataEvidence, expiresAt, warnings: inspection.warnings, createdBy: actor.id }).returning();
    if (!batch) throw new CustodialError("CONFLICT", "Import could not be staged.");
    for (let offset = 0; offset < evidenceRows.length; offset += 250) {
      await tx.insert(custodialImportRows).values(evidenceRows.slice(offset, offset + 250).map((row) => ({ batchId: batch.id, sheetName: row.sheet, sourceRow: row.row, evidence: { section: row.section, fields: row.fields, variance: row.variance }, warnings: row.warnings })));
    }
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.stage", targetType: "custodial_import_batch", targetId: batch.id, after: { family: batch.family, sourceHash, rowCount: evidenceRows.length, expiresAt: expiresAt.toISOString() }, correlationId: input.correlationId });
    const result = { id: batch.id, family: batch.family, rowCount: evidenceRows.length, duplicateBatchIds: duplicates.map((entry) => entry.id) };
    await saveMaster(tx, actor, input.operationId, "import.stage", replay.hash, batch.id, result);
    return result;
  });
}

export async function getCustodialImport(db: Database, actor: Actor, batchId: string) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const [batch] = await tx.select({ id: custodialImportBatches.id, filename: custodialImportBatches.filename, family: custodialImportBatches.family, sourceHash: custodialImportBatches.sourceHash, classificationThreshold: custodialImportBatches.classificationThreshold, classificationPolicyId: custodialImportBatches.classificationPolicyId, metadataEvidence: custodialImportBatches.metadataEvidence, expiresAt: custodialImportBatches.expiresAt, status: custodialImportBatches.status, version: custodialImportBatches.version, warnings: custodialImportBatches.warnings, commitDetails: custodialImportBatches.commitDetails, createdAt: custodialImportBatches.createdAt }).from(custodialImportBatches).where(eq(custodialImportBatches.id, batchId)).for("share");
    if (!batch || batch.status === "expired" || (batch.status === "staged" && batch.expiresAt <= new Date())) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id));
    const propertyNumber = (evidence: unknown) => {
      const parsed = z.object({ fields: z.record(z.string(), z.object({ value: z.unknown() }).passthrough()) }).passthrough().safeParse(evidence);
      const value = parsed.success ? parsed.data.fields.propertyNumber?.value : null;
      return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
    };
    const numbers = [...new Set(rows.map((row) => propertyNumber(row.evidence)).filter((value): value is string => value !== null))];
    const candidates = new Map<string, Array<{ lotId: string; itemId: string; itemCode: string; fundCluster: string; office: string; version: number }>>();
    for (let offset = 0; offset < numbers.length; offset += 500) {
      const matches = await tx.select({ lotId: custodialLots.id, itemId: custodialItems.id, itemCode: custodialItems.code, fundCluster: custodialLots.fundCluster, office: custodialLots.office, version: custodialLots.version, number: custodialLots.normalizedPropertyNumber }).from(custodialLots).innerJoin(custodialItems, eq(custodialItems.id, custodialLots.itemId)).where(and(inArray(custodialLots.normalizedPropertyNumber, numbers.slice(offset, offset + 500)), eq(custodialLots.active, true), eq(custodialItems.active, true))).orderBy(custodialItems.code, custodialLots.id);
      for (const { number, ...candidate } of matches) if (number) { const group = candidates.get(number) ?? []; if (group.length < 20) group.push(candidate); candidates.set(number, group); }
    }
    return { batch, rows: rows.map((row) => ({ ...row, candidates: candidates.get(propertyNumber(row.evidence) ?? "") ?? [] })) };
  });
}

export async function listCustodialImports(db: Database, actor: Actor, input: { page: number; pageSize: number }) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new CustodialError("VALIDATION", "Invalid page.");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const rows = await tx.select({ id: custodialImportBatches.id, filename: custodialImportBatches.filename, family: custodialImportBatches.family, sourceHash: custodialImportBatches.sourceHash, status: custodialImportBatches.status, version: custodialImportBatches.version, createdAt: custodialImportBatches.createdAt, expiresAt: custodialImportBatches.expiresAt }).from(custodialImportBatches).where(or(eq(custodialImportBatches.status, "committed"), and(eq(custodialImportBatches.status, "staged"), sql`${custodialImportBatches.expiresAt} > now()`))).orderBy(desc(custodialImportBatches.createdAt), desc(custodialImportBatches.id)).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
    return { rows: rows.slice(0, input.pageSize), page: input.page, hasNext: rows.length > input.pageSize };
  });
}

function importCsvCell(value: string | number): string {
  let text = String(value);
  if (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** An audited, formula-safe diagnostics file; replay rechecks scope and version. */
export async function exportCustodialImportErrors(db: Database, actor: Actor, input: { batchId: string; expectedVersion: number; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new CustodialError("VALIDATION", "A valid import version is required.");
  const values = { batchId: input.batchId, expectedVersion: input.expectedVersion };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "import.errors.export", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("share");
    if (!batch || batch.status === "expired" || (batch.status === "staged" && batch.expiresAt <= new Date())) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (batch.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "Import changed; refresh before exporting errors.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id));
    rows.sort((a, b) => a.sheetName.localeCompare(b.sheetName) || a.sourceRow - b.sourceRow);
    const records: Array<Array<string | number>> = [["Sheet", "Source row", "Status", "Reason codes", "Resolution"]];
    for (const warning of z.array(z.string()).parse(batch.warnings)) records.push(["Workbook", "", "review", warning, ""]);
    for (const row of rows) {
      const warnings = z.array(z.string()).parse(row.warnings);
      const mapping = importMappingSchema.safeParse(row.mapping);
      if (!warnings.length && mapping.success && mapping.data.disposition !== "exclude") continue;
      const status = mapping.success ? mapping.data.disposition : "unresolved";
      let reason = "";
      if (mapping.success) reason = mapping.data.disposition === "exclude" ? mapping.data.reason : mapping.data.warningResolutions.map((entry) => `${entry.code}: ${entry.reason}`).join("; ");
      records.push([row.sheetName, row.sourceRow, status, warnings.join("; "), reason]);
    }
    const csv = records.map((record) => record.map(importCsvCell).join(",")).join("\r\n") + "\r\n";
    const checksum = createHash("sha256").update(csv).digest("hex");
    if (replay.prior) {
      const saved = savedResult<{ checksum: string }>(replay.prior.result);
      if (saved.checksum !== checksum) throw new CustodialError("CONFLICT", "Import evidence changed; export again.");
      return { csv, checksum, rowCount: records.length - 1 };
    }
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.errors.export", targetType: "custodial_import_batch", targetId: batch.id, after: { version: batch.version, rowCount: records.length - 1, checksum }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "import.errors.export", replay.hash, batch.id, { checksum });
    return { csv, checksum, rowCount: records.length - 1 };
  });
}

export const importMappingSchema = z.discriminatedUnion("disposition", [
  z.object({ disposition: z.literal("exclude"), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ disposition: z.literal("map"), lotId: z.uuid(), expectedLotVersion: z.number().int().nonnegative(), physicalQuantity: z.number().int().nonnegative().max(2147483647).nullable(), condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"]).nullable(), physicalVerification: z.string().trim().max(1000).nullable(), cardMismatchReason: z.string().trim().max(1000).nullable(), opening: z.object({ balanceId: z.uuid(), expectedVersion: z.number().int().nonnegative(), quantity: z.number().int().nonnegative().max(2147483647), transactionDate: z.iso.date(), reference: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(1000) }).strict().nullable().optional(), warningResolutions: z.array(z.object({ code: z.string().min(1).max(120), reason: z.string().trim().min(1).max(1000) }).strict()).max(100) }).strict(),
  z.object({ disposition: z.literal("ledger"), balanceId: z.uuid(), expectedBalanceVersion: z.number().int().nonnegative(), type: z.enum(["opening", "receipt", "issue", "return"]), quantity: z.number().int().positive().max(2147483647), transactionDate: z.iso.date(), reference: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(1000), counterparty: z.string().trim().max(1000).nullable(), balanceAfter: z.number().int().nonnegative().max(2147483647), sourceVerification: z.string().trim().min(1).max(1000), daysToConsume: z.number().int().nonnegative().max(2147483647).nullable(), warningResolutions: z.array(z.object({ code: z.string().min(1).max(120), reason: z.string().trim().min(1).max(1000) }).strict()).max(100) }).strict(),
]);

/** Resolve staged evidence without changing the source values or operational inventory. */
export async function resolveCustodialImportRow(db: Database, actor: Actor, input: { batchId: string; rowId: string; expectedBatchVersion: number; expectedRowVersion: number; mapping: z.infer<typeof importMappingSchema>; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  const parsed = importMappingSchema.safeParse(input.mapping);
  if (!parsed.success || !Number.isSafeInteger(input.expectedBatchVersion) || input.expectedBatchVersion < 0 || !Number.isSafeInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new CustodialError("VALIDATION", "A valid row mapping and versions are required.");
  const values = { batchId: input.batchId, rowId: input.rowId, expectedBatchVersion: input.expectedBatchVersion, expectedRowVersion: input.expectedRowVersion, mapping: parsed.data };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "import.row.resolve", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("update");
    if (!batch || batch.status === "expired" || batch.expiresAt <= new Date()) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (batch.status !== "staged") throw new CustodialError("CONFLICT", "Committed import is immutable.");
    const [row] = await tx.select().from(custodialImportRows).where(and(eq(custodialImportRows.id, input.rowId), eq(custodialImportRows.batchId, batch.id))).for("update");
    if (!row) throw new CustodialError("NOT_FOUND", "Import row is unavailable.");
    if (replay.prior) return savedResult<{ id: string; rowVersion: number; batchVersion: number }>(replay.prior.result);
    if (batch.version !== input.expectedBatchVersion || row.version !== input.expectedRowVersion) throw new CustodialError("CONFLICT", "Import changed; refresh and retry.");
    if (values.mapping.disposition === "map") {
      if (batch.family === "stock_card") throw new CustodialError("VALIDATION", "Stock-card rows require ledger mappings.");
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, values.mapping.lotId)).for("share");
      if (!lot?.active || lot.version !== values.mapping.expectedLotVersion || (batch.family === "rpcsp" && lot.reportingClass !== "semi_expendable") || (batch.family === "rpcppe" && lot.reportingClass !== "ppe")) throw new CustodialError("CONFLICT", "Target lot is unavailable or changed.");
      const warnings = z.array(z.string()).parse(row.warnings);
      const resolutions = new Map(values.mapping.warningResolutions.map((entry) => [entry.code, entry.reason]));
      if (resolutions.size !== values.mapping.warningResolutions.length || warnings.some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every row warning explicitly.");
      if (warnings.includes("FORMULA_DERIVED_PHYSICAL_COUNT") && (!values.mapping.physicalVerification || values.mapping.physicalQuantity === null)) throw new CustodialError("VALIDATION", "Formula-derived counts require independent verification.");
      if (values.mapping.physicalQuantity !== null && values.mapping.condition === null) throw new CustodialError("VALIDATION", "A physical observation requires a reviewed condition.");
      if (values.mapping.opening) {
        const [balance] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, values.mapping.opening.balanceId)).for("share");
        if (!balance || balance.lotId !== lot.id || balance.version !== values.mapping.opening.expectedVersion || balance.quantity !== 0) throw new CustodialError("CONFLICT", "Opening target is unavailable or changed.");
      }
      const siblings = await tx.select({ id: custodialImportRows.id, mapping: custodialImportRows.mapping }).from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id));
      const targetLotId = values.mapping.lotId;
      if (siblings.some((entry) => entry.id !== row.id && typeof entry.mapping === "object" && entry.mapping !== null && "lotId" in entry.mapping && entry.mapping.lotId === targetLotId)) throw new CustodialError("CONFLICT", "Another row already maps to this lot.");
    } else if (values.mapping.disposition === "ledger") {
      if (batch.family !== "stock_card" || (values.mapping.daysToConsume !== null && values.mapping.type !== "issue") || (values.mapping.type !== "opening" && !values.mapping.counterparty)) throw new CustodialError("VALIDATION", "The ledger mapping is incompatible with this workbook.");
      const [balance] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, values.mapping.balanceId)).for("share");
      if (!balance || balance.version !== values.mapping.expectedBalanceVersion) throw new CustodialError("CONFLICT", "Target balance is unavailable or changed.");
      const warnings = z.array(z.string()).parse(row.warnings);
      const resolutions = new Map(values.mapping.warningResolutions.map((entry) => [entry.code, entry.reason]));
      if (resolutions.size !== values.mapping.warningResolutions.length || warnings.some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every row warning explicitly.");
    }
    const [updated] = await tx.update(custodialImportRows).set({ mapping: values.mapping, resolution: values.mapping.disposition === "exclude" ? values.mapping.reason : null, version: row.version + 1 }).where(eq(custodialImportRows.id, row.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Import row could not be resolved.");
    await tx.update(custodialImportBatches).set({ version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.row.resolve", targetType: "custodial_import_row", targetId: row.id, before: { version: row.version }, after: { disposition: values.mapping.disposition, version: updated.version }, correlationId: input.correlationId });
    const result = { id: updated.id, rowVersion: updated.version, batchVersion: batch.version + 1 };
    await saveMaster(tx, actor, input.operationId, "import.row.resolve", replay.hash, batch.id, result);
    return result;
  });
}

function derivedOperationId(operationId: string, suffix: string) {
  const bytes = createHash("sha256").update(`${operationId.toLowerCase()}:${suffix}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Commit reviewed count evidence as a draft, never as a stock adjustment. */
export async function commitCustodialImportCount(db: Database, actor: Actor, input: {
  batchId: string; sourceHash: string; expectedBatchVersion: number; effect: "draft_count"; confirmed: true; acknowledgedExclusions: boolean;
  code: string; profileId: string; asOfDate: string; fundCluster: string; office?: string | null; metadata: z.infer<typeof countMetadata>;
  warningResolutions: Array<{ code: string; reason: string }>; operationId: string; correlationId: string;
}) {
  await authorize(db, actor);
  if (input.effect !== "draft_count" || input.confirmed !== true || !/^[0-9a-f]{64}$/.test(input.sourceHash) || !Number.isSafeInteger(input.expectedBatchVersion) || input.expectedBatchVersion < 0 || !Array.isArray(input.warningResolutions) || input.warningResolutions.length > 5000) throw new CustodialError("VALIDATION", "Confirm a valid draft-count import.");
  const warnings = z.array(z.object({ code: z.string().min(1).max(300), reason: z.string().trim().min(1).max(1000) }).strict()).safeParse(input.warningResolutions);
  if (!warnings.success) throw new CustodialError("VALIDATION", "Workbook warnings require a reason.");
  const { correlationId: _correlationId, ...intent } = input;
  const values = { ...intent, warningResolutions: warnings.data };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    if (!z.uuid().safeParse(input.operationId).success) throw new CustodialError("VALIDATION", "A valid operation ID is required.");
    for (const id of [input.operationId.toLowerCase(), derivedOperationId(input.operationId, "draft-count")].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
    const replay = await beginMaster(tx, actor, input.operationId, "import.commit.count", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("update");
    if (!batch) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (replay.prior) {
      const result = savedResult<{ batchId: string; countId: string; mapped: number; excluded: number }>(replay.prior.result);
      const [count] = await tx.select({ id: custodialCounts.id }).from(custodialCounts).where(eq(custodialCounts.id, result.countId));
      if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
      return result;
    }
    if (batch.status !== "staged" || batch.expiresAt <= new Date()) throw new CustodialError("CONFLICT", "Import is no longer available for commit.");
    if (batch.version !== input.expectedBatchVersion || batch.sourceHash !== input.sourceHash || batch.family === "stock_card") throw new CustodialError("CONFLICT", "Import or intended effect changed; review again.");
    if (batch.classificationPolicyId) {
      const [policy] = await tx.select().from(custodialClassificationPolicies).where(eq(custodialClassificationPolicies.id, batch.classificationPolicyId));
      if (!policy || policy.effectiveFrom > input.asOfDate) throw new CustodialError("VALIDATION", "The classification policy must be effective by the count date.");
    } else if (batch.family === "rpcsp") throw new CustodialError("VALIDATION", "A reviewed classification policy is required for RPCSP import.");
    const batchWarnings = z.array(z.string()).parse(batch.warnings);
    const resolutions = new Map(warnings.data.map((entry) => [entry.code, entry.reason]));
    if (resolutions.size !== warnings.data.length || batchWarnings.some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every workbook warning before commit.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id)).for("update");
    const mapped = rows.map((row) => ({ row, mapping: importMappingSchema.safeParse(row.mapping) }));
    if (mapped.some((entry) => !entry.mapping.success || entry.mapping.data.disposition === "ledger")) throw new CustodialError("VALIDATION", "Resolve every source row for a count before commit.");
    const excluded = mapped.filter((entry) => entry.mapping.success && entry.mapping.data.disposition === "exclude");
    if (excluded.length && !input.acknowledgedExclusions) throw new CustodialError("VALIDATION", "Acknowledge excluded rows before commit.");
    const included = mapped.filter((entry) => entry.mapping.success && entry.mapping.data.disposition === "map");
    const lotIds = new Set<string>();
    for (const entry of included) {
      if (!entry.mapping.success || entry.mapping.data.disposition !== "map") throw new CustodialError("VALIDATION", "Import mapping is invalid.");
      const mapping = entry.mapping.data;
      const rowWarnings = z.array(z.string()).parse(entry.row.warnings);
      const rowResolutions = new Map(mapping.warningResolutions.map((resolution) => [resolution.code, resolution.reason]));
      if (rowResolutions.size !== mapping.warningResolutions.length || rowWarnings.some((warning) => !rowResolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every row warning before commit.");
      if (lotIds.has(mapping.lotId)) throw new CustodialError("CONFLICT", "Multiple rows map to the same lot.");
      lotIds.add(mapping.lotId);
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, mapping.lotId)).for("share");
      if (!lot?.active || lot.version !== mapping.expectedLotVersion || lot.fundCluster !== input.fundCluster.trim() || (batch.family === "rpcsp" ? lot.reportingClass !== "semi_expendable" : lot.reportingClass !== "ppe")) throw new CustodialError("CONFLICT", "A target lot changed or is outside the selected fund.");
      if (mapping.physicalQuantity !== null && (!mapping.condition || !mapping.physicalVerification?.trim())) throw new CustodialError("VALIDATION", "Imported physical quantities require independent verification and a condition.");
    }
    const count = await createCustodialCount(tx as unknown as Database, actor, { code: input.code, family: batch.family, profileId: input.profileId, asOfDate: input.asOfDate, fundCluster: input.fundCluster, office: input.office, metadata: input.metadata, operationId: derivedOperationId(input.operationId, "draft-count"), correlationId: input.correlationId });
    const lines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, count.id)).for("update");
    for (const entry of included) {
      if (!entry.mapping.success || entry.mapping.data.disposition !== "map") throw new CustodialError("VALIDATION", "Import mapping is invalid.");
      const mapping = entry.mapping.data;
      const line = lines.find((candidate) => candidate.lotId === mapping.lotId);
      if (!line) throw new CustodialError("CONFLICT", "A target lot is not in the as-of count scope.");
      const snapshot = z.object({ cardQuantity: z.number().int().nonnegative() }).passthrough().parse(line.snapshot);
      const evidence = z.object({ fields: z.record(z.string(), z.object({ value: z.unknown().optional() }).passthrough()) }).passthrough().parse(entry.row.evidence);
      const sourceCard = evidence.fields.cardQuantity?.value;
      if (typeof sourceCard === "number" && Number.isSafeInteger(sourceCard) && sourceCard !== snapshot.cardQuantity && !mapping.cardMismatchReason?.trim()) throw new CustodialError("VALIDATION", "Source card mismatch requires an explicit resolution.");
      const remarks = evidence.fields.remarks?.value;
      const imported = { batchId: batch.id, sourceHash: batch.sourceHash, sheet: entry.row.sheetName, row: entry.row.sourceRow, evidence: entry.row.evidence, warnings: entry.row.warnings, mapping };
      await tx.update(custodialCountLines).set({ importBatchId: batch.id, importEvidence: imported, status: mapping.physicalQuantity === null ? "uncounted" : "counted", physicalQuantity: mapping.physicalQuantity, condition: mapping.condition, remarks: typeof remarks === "string" ? remarks.slice(0, 4000) : null, reviewRequired: true, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id));
    }
    const excludedRows = excluded.map((entry) => ({ sheet: entry.row.sheetName, row: entry.row.sourceRow, reason: entry.mapping.success && entry.mapping.data.disposition === "exclude" ? entry.mapping.data.reason : "" }));
    await tx.update(custodialCounts).set({ metadata: { ...countMetadata.parse(count.metadata), importProvenance: { batchId: batch.id, sourceHash: batch.sourceHash, excludedRows, warningResolutions: warnings.data } }, version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await tx.update(custodialImportBatches).set({ status: "committed", commitDetails: { effect: input.effect, countId: count.id, warningResolutions: warnings.data, excludedRows, actorId: actor.id }, version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.commit_count", targetType: "custodial_import_batch", targetId: batch.id, after: { countId: count.id, sourceHash: batch.sourceHash, mapped: included.length, excluded: excluded.length }, correlationId: input.correlationId });
    const result = { batchId: batch.id, countId: count.id, mapped: included.length, excluded: excluded.length };
    await saveMaster(tx, actor, input.operationId, "import.commit.count", replay.hash, batch.id, result);
    return result;
  });
}

/** Commit a reviewed historical Stock Card into one previously unused balance. */
export async function commitCustodialImportLedger(db: Database, actor: Actor, input: { batchId: string; sourceHash: string; expectedBatchVersion: number; effect: "historical_ledger"; confirmed: true; acknowledgedExclusions: boolean; warningResolutions?: Array<{ code: string; reason: string }>; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  if (input.effect !== "historical_ledger" || input.confirmed !== true || !/^[0-9a-f]{64}$/.test(input.sourceHash) || !Number.isSafeInteger(input.expectedBatchVersion) || input.expectedBatchVersion < 0) throw new CustodialError("VALIDATION", "Confirm a valid historical-ledger import.");
  const warnings = z.array(z.object({ code: z.string().min(1).max(300), reason: z.string().trim().min(1).max(1000) }).strict()).max(5000).safeParse(input.warningResolutions ?? []);
  if (!warnings.success) throw new CustodialError("VALIDATION", "Workbook warnings require a reason.");
  const { correlationId: _correlationId, ...values } = input;
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    if (!z.uuid().safeParse(input.operationId).success) throw new CustodialError("VALIDATION", "A valid operation ID is required.");
    const pendingRows = await tx.select({ id: custodialImportRows.id }).from(custodialImportRows).where(eq(custodialImportRows.batchId, input.batchId));
    for (const id of [input.operationId.toLowerCase(), ...pendingRows.map((row) => derivedOperationId(input.operationId, `ledger:${row.id}`))].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
    const replay = await beginMaster(tx, actor, input.operationId, "import.commit.ledger", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("update");
    if (!batch) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (replay.prior) {
      const result = savedResult<{ batchId: string; balanceId: string; postings: number; excluded: number }>(replay.prior.result);
      const [current] = await tx.select({ itemActive: custodialItems.active, lotId: custodialBalances.lotId }).from(custodialBalances).innerJoin(custodialItems, eq(custodialBalances.itemId, custodialItems.id)).where(eq(custodialBalances.id, result.balanceId));
      if (!current?.itemActive) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
      if (current.lotId) {
        const [lot] = await tx.select({ active: custodialLots.active }).from(custodialLots).where(eq(custodialLots.id, current.lotId));
        if (!lot?.active) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
      }
      return result;
    }
    if (batch.status !== "staged" || batch.expiresAt <= new Date() || batch.family !== "stock_card" || batch.version !== input.expectedBatchVersion || batch.sourceHash !== input.sourceHash) throw new CustodialError("CONFLICT", "Import or intended effect changed; review again.");
    const batchWarnings = z.array(z.string()).parse(batch.warnings);
    const resolutions = new Map(warnings.data.map((entry) => [entry.code, entry.reason]));
    if (resolutions.size !== warnings.data.length || batchWarnings.some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve workbook-level warnings before committing the ledger.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id)).for("update");
    const mapped = rows.map((row) => ({ row, mapping: importMappingSchema.safeParse(row.mapping) }));
    if (mapped.some((entry) => !entry.mapping.success || entry.mapping.data.disposition === "map")) throw new CustodialError("VALIDATION", "Resolve every source row for the ledger before commit.");
    const excluded = mapped.filter((entry) => entry.mapping.success && entry.mapping.data.disposition === "exclude");
    if (excluded.length && !input.acknowledgedExclusions) throw new CustodialError("VALIDATION", "Acknowledge excluded rows before commit.");
    const included = mapped.filter((entry) => entry.mapping.success && entry.mapping.data.disposition === "ledger").sort((a, b) => a.row.sourceRow - b.row.sourceRow);
    if (!included.length) throw new CustodialError("VALIDATION", "A blank stock card contains no ledger to import.");
    const first = included[0]!;
    if (!first.mapping.success || first.mapping.data.disposition !== "ledger" || first.mapping.data.type !== "opening") throw new CustodialError("VALIDATION", "The first included row must be a verified opening balance.");
    const targetId = first.mapping.data.balanceId;
    const expectedVersion = first.mapping.data.expectedBalanceVersion;
    const [balance] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, targetId)).for("update");
    if (!balance || balance.version !== expectedVersion || balance.quantity !== 0) throw new CustodialError("CONFLICT", "The target balance is unavailable or not empty.");
    const [existing] = await tx.select({ id: custodialTransactions.id }).from(custodialTransactions).where(eq(custodialTransactions.balanceId, balance.id)).limit(1);
    if (existing) throw new CustodialError("CONFLICT", "Historical ledger import requires an unused balance.");
    let quantity = 0, previousDate = "";
    for (const [index, entry] of included.entries()) {
      if (!entry.mapping.success || entry.mapping.data.disposition !== "ledger") throw new CustodialError("VALIDATION", "Ledger mapping is invalid.");
      const mapping = entry.mapping.data;
      const rowWarnings = z.array(z.string()).parse(entry.row.warnings);
      const resolutions = new Map(mapping.warningResolutions.map((resolution) => [resolution.code, resolution.reason]));
      if (resolutions.size !== mapping.warningResolutions.length || rowWarnings.some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every row warning before commit.");
      if (mapping.balanceId !== targetId || mapping.expectedBalanceVersion !== expectedVersion || (index > 0 && mapping.type === "opening") || mapping.transactionDate < previousDate) throw new CustodialError("VALIDATION", "Ledger rows must share one balance and chronological order.");
      previousDate = mapping.transactionDate;
      quantity += mapping.type === "issue" ? -mapping.quantity : mapping.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647 || quantity !== mapping.balanceAfter) throw new CustodialError("VALIDATION", "Ledger balances do not reconcile.");
      await postCustodialOperation(tx as unknown as Database, actor, { balanceId: targetId, operationId: derivedOperationId(input.operationId, `ledger:${entry.row.id}`), type: mapping.type, quantity: mapping.quantity, transactionDate: mapping.transactionDate, reference: mapping.reference, reason: mapping.reason, counterparty: mapping.counterparty ?? undefined, daysToConsume: mapping.daysToConsume ?? undefined, correlationId: input.correlationId });
    }
    await tx.update(custodialImportBatches).set({ status: "committed", commitDetails: { effect: input.effect, balanceId: targetId, warningResolutions: warnings.data, actorId: actor.id }, version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.commit_ledger", targetType: "custodial_import_batch", targetId: batch.id, after: { balanceId: targetId, sourceHash: batch.sourceHash, postings: included.length, excluded: excluded.length }, correlationId: input.correlationId });
    const result = { batchId: batch.id, balanceId: targetId, postings: included.length, excluded: excluded.length };
    await saveMaster(tx, actor, input.operationId, "import.commit.ledger", replay.hash, batch.id, result);
    return result;
  });
}

type ImportOpeningsInput = { batchId: string; sourceHash: string; expectedBatchVersion: number; effect: "verified_openings"; confirmed: true; acknowledgedExclusions: boolean; warningResolutions: Array<{ code: string; reason: string }>; operationId: string; correlationId: string };
/** Shared only within an enclosing atomic import transaction. */
async function commitCustodialImportOpeningsInternal(db: Database, actor: Actor, input: ImportOpeningsInput, combinedCountOperationId?: string) {
  await authorize(db, actor);
  const warnings = z.array(z.object({ code: z.string().min(1).max(300), reason: z.string().trim().min(1).max(1000) }).strict()).max(5000).safeParse(input.warningResolutions);
  if (input.effect !== "verified_openings" || input.confirmed !== true || !/^[0-9a-f]{64}$/.test(input.sourceHash) || !Number.isSafeInteger(input.expectedBatchVersion) || input.expectedBatchVersion < 0 || !warnings.success) throw new CustodialError("VALIDATION", "Confirm a valid opening inventory import.");
  const { correlationId: _correlationId, ...intent } = input;
  const values = { ...intent, warningResolutions: warnings.data, combinedCountOperationId };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    if (!z.uuid().safeParse(input.operationId).success) throw new CustodialError("VALIDATION", "A valid operation ID is required.");
    const pendingRows = await tx.select({ id: custodialImportRows.id }).from(custodialImportRows).where(eq(custodialImportRows.batchId, input.batchId));
    for (const id of [input.operationId.toLowerCase(), ...pendingRows.map((row) => derivedOperationId(input.operationId, `opening:${row.id}`))].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
    const replay = await beginMaster(tx, actor, input.operationId, "import.commit.openings", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("update");
    if (!batch) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (replay.prior) {
      const result = savedResult<{ batchId: string; balanceIds: string[]; openings: number; excluded: number }>(replay.prior.result);
      for (const id of result.balanceIds) {
        const [target] = await tx.select({ itemActive: custodialItems.active, lotId: custodialBalances.lotId }).from(custodialBalances).innerJoin(custodialItems, eq(custodialBalances.itemId, custodialItems.id)).where(eq(custodialBalances.id, id));
        if (!target?.itemActive) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
        if (target.lotId) { const [lot] = await tx.select({ active: custodialLots.active }).from(custodialLots).where(eq(custodialLots.id, target.lotId)); if (!lot?.active) throw new CustodialError("NOT_FOUND", "Balance is unavailable."); }
      }
      return result;
    }
    if (batch.status !== "staged" || batch.expiresAt <= new Date() || batch.family === "stock_card" || batch.version !== input.expectedBatchVersion || batch.sourceHash !== input.sourceHash) throw new CustodialError("CONFLICT", "Import or intended effect changed; review again.");
    const resolutions = new Map(warnings.data.map((entry) => [entry.code, entry.reason]));
    if (resolutions.size !== warnings.data.length || z.array(z.string()).parse(batch.warnings).some((warning) => !resolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every workbook warning before commit.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id)).for("update");
    const mapped = rows.map((row) => ({ row, mapping: importMappingSchema.safeParse(row.mapping) }));
    if (mapped.some((entry) => !entry.mapping.success || entry.mapping.data.disposition === "ledger")) throw new CustodialError("VALIDATION", "Resolve every source row for opening inventory.");
    const excluded = mapped.filter((entry) => entry.mapping.success && entry.mapping.data.disposition === "exclude");
    if (excluded.length && !input.acknowledgedExclusions) throw new CustodialError("VALIDATION", "Acknowledge excluded rows before commit.");
    const included = mapped.flatMap((entry) => entry.mapping.success && entry.mapping.data.disposition === "map" ? [{ row: entry.row, mapping: entry.mapping.data }] : []);
    if (!included.length || included.some((entry) => !entry.mapping.opening)) throw new CustodialError("VALIDATION", "Every included row needs a verified opening.");
    if (new Set(included.map((entry) => entry.mapping.lotId)).size !== included.length) throw new CustodialError("CONFLICT", "Opening rows cannot share a lot.");
    const ids = included.map((entry) => entry.mapping.opening!.balanceId).sort();
    if (new Set(ids).size !== ids.length) throw new CustodialError("CONFLICT", "Opening rows cannot share a balance.");
    const balances = [];
    for (const id of ids) { const [balance] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, id)).for("update"); if (!balance) throw new CustodialError("NOT_FOUND", "Opening balance is unavailable."); balances.push(balance); }
    for (const itemId of [...new Set(balances.map((balance) => balance.itemId))].sort()) { const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, itemId)).for("update"); if (!item?.active) throw new CustodialError("CONFLICT", "Item is unavailable."); }
    for (const lotId of [...new Set(included.map((entry) => entry.mapping.lotId))].sort()) { const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, lotId)).for("update"); if (!lot?.active) throw new CustodialError("CONFLICT", "Lot is unavailable."); }
    for (const entry of included) {
      const opening = entry.mapping.opening!;
      const balance = balances.find((candidate) => candidate.id === opening.balanceId)!;
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, entry.mapping.lotId));
      if (!lot || lot.version !== entry.mapping.expectedLotVersion || balance.lotId !== lot.id || balance.fundCluster !== lot.fundCluster || balance.version !== opening.expectedVersion || balance.quantity !== 0 || (batch.family === "rpcsp" ? lot.reportingClass !== "semi_expendable" : lot.reportingClass !== "ppe")) throw new CustodialError("CONFLICT", "An opening target changed or is invalid.");
      const [existing] = await tx.select({ id: custodialTransactions.id }).from(custodialTransactions).where(eq(custodialTransactions.balanceId, balance.id)).limit(1);
      if (existing) throw new CustodialError("CONFLICT", "Opening import requires unused balances.");
      const rowWarnings = z.array(z.string()).parse(entry.row.warnings);
      const rowResolutions = new Map(entry.mapping.warningResolutions.map((resolution) => [resolution.code, resolution.reason]));
      if (rowResolutions.size !== entry.mapping.warningResolutions.length || rowWarnings.some((warning) => !rowResolutions.has(warning))) throw new CustodialError("VALIDATION", "Resolve every row warning before commit.");
      const evidence = z.object({ fields: z.record(z.string(), z.object({ value: z.unknown().optional() }).passthrough()) }).passthrough().parse(entry.row.evidence);
      const sourceCard = evidence.fields.cardQuantity?.value;
      if (typeof sourceCard === "number" && Number.isSafeInteger(sourceCard) && sourceCard !== opening.quantity && !entry.mapping.cardMismatchReason?.trim()) throw new CustodialError("VALIDATION", "Source card mismatch requires an explicit resolution.");
      if (opening.quantity === 0) {
        await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.zero_opening.verify", targetType: "custodial_balance", targetId: balance.id, after: { batchId: batch.id, rowId: entry.row.id, reference: opening.reference, reason: opening.reason }, correlationId: input.correlationId });
      } else {
        await postCustodialOperation(tx as unknown as Database, actor, { balanceId: balance.id, operationId: derivedOperationId(input.operationId, `opening:${entry.row.id}`), type: "opening", quantity: opening.quantity, transactionDate: opening.transactionDate, reference: opening.reference, reason: opening.reason, correlationId: input.correlationId });
      }
    }
    await tx.update(custodialImportBatches).set({ status: "committed", commitDetails: { effect: combinedCountOperationId ? "openings_and_draft_count" : input.effect, balanceIds: ids, countOperationId: combinedCountOperationId ?? null, warningResolutions: warnings.data, actorId: actor.id }, version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.commit_openings", targetType: "custodial_import_batch", targetId: batch.id, after: { sourceHash: batch.sourceHash, openings: included.length, excluded: excluded.length }, correlationId: input.correlationId });
    const result = { batchId: batch.id, balanceIds: ids, openings: included.length, excluded: excluded.length };
    await saveMaster(tx, actor, input.operationId, "import.commit.openings", replay.hash, batch.id, result);
    return result;
  });
}

/** Commit operator-verified openings from count-form rows into unused balances. */
export async function commitCustodialImportOpenings(db: Database, actor: Actor, input: ImportOpeningsInput) {
  return commitCustodialImportOpeningsInternal(db, actor, input);
}

/** Apply verified openings and create the related draft count in one transaction. */
export async function commitCustodialImportCombined(db: Database, actor: Actor, input: Omit<ImportOpeningsInput, "effect"> & { effect: "openings_and_draft_count"; code: string; profileId: string; asOfDate: string; fundCluster: string; office?: string | null; metadata: z.infer<typeof countMetadata> }) {
  await authorize(db, actor);
  if (input.effect !== "openings_and_draft_count" || input.confirmed !== true || !z.iso.date().safeParse(input.asOfDate).success || !z.uuid().safeParse(input.operationId).success) throw new CustodialError("VALIDATION", "Confirm valid openings and a draft count.");
  const { correlationId: _correlationId, ...values } = input;
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const pendingRows = await tx.select({ id: custodialImportRows.id }).from(custodialImportRows).where(eq(custodialImportRows.batchId, input.batchId));
    const openingsOperationId = derivedOperationId(input.operationId, "combined-openings");
    const operationIds = [input.operationId.toLowerCase(), openingsOperationId, derivedOperationId(input.operationId, "combined-count"), ...pendingRows.map((row) => derivedOperationId(openingsOperationId, `opening:${row.id}`))];
    for (const id of [...new Set(operationIds)].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
    const replay = await beginMaster(tx, actor, input.operationId, "import.commit.combined", values);
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, input.batchId)).for("update");
    if (!batch) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (replay.prior) {
      const result = savedResult<{ batchId: string; countId: string; balanceIds: string[]; openings: number; excluded: number }>(replay.prior.result);
      const [count] = await tx.select({ id: custodialCounts.id }).from(custodialCounts).where(eq(custodialCounts.id, result.countId));
      if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
      for (const id of result.balanceIds) {
        const [target] = await tx.select({ itemActive: custodialItems.active, lotId: custodialBalances.lotId }).from(custodialBalances).innerJoin(custodialItems, eq(custodialBalances.itemId, custodialItems.id)).where(eq(custodialBalances.id, id));
        if (!target?.itemActive) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
        if (target.lotId) { const [lot] = await tx.select({ active: custodialLots.active }).from(custodialLots).where(eq(custodialLots.id, target.lotId)); if (!lot?.active) throw new CustodialError("NOT_FOUND", "Balance is unavailable."); }
      }
      return result;
    }
    if (batch.status !== "staged" || batch.expiresAt <= new Date() || batch.family === "stock_card" || batch.version !== input.expectedBatchVersion || batch.sourceHash !== input.sourceHash) throw new CustodialError("CONFLICT", "Import or intended effect changed; review again.");
    const rows = await tx.select().from(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id)).for("update");
    const mapped = rows.map((row) => ({ row, mapping: importMappingSchema.safeParse(row.mapping) }));
    if (mapped.some((entry) => !entry.mapping.success || entry.mapping.data.disposition === "ledger")) throw new CustodialError("VALIDATION", "Resolve every source row for both effects.");
    const included = mapped.flatMap((entry) => entry.mapping.success && entry.mapping.data.disposition === "map" ? [{ row: entry.row, mapping: entry.mapping.data }] : []);
    for (const entry of included) {
      if (!entry.mapping.opening || entry.mapping.opening.transactionDate > input.asOfDate || (entry.mapping.physicalQuantity !== null && (!entry.mapping.condition || !entry.mapping.physicalVerification?.trim()))) throw new CustodialError("VALIDATION", "Openings must precede the count and physical observations require independent verification.");
    }
    const countOperationId = derivedOperationId(input.operationId, "combined-count");
    const openings = await commitCustodialImportOpeningsInternal(tx as unknown as Database, actor, { batchId: input.batchId, sourceHash: input.sourceHash, expectedBatchVersion: input.expectedBatchVersion, effect: "verified_openings", confirmed: true, acknowledgedExclusions: input.acknowledgedExclusions, warningResolutions: input.warningResolutions, operationId: derivedOperationId(input.operationId, "combined-openings"), correlationId: input.correlationId }, countOperationId);
    const count = await createCustodialCount(tx as unknown as Database, actor, { code: input.code, family: batch.family, profileId: input.profileId, asOfDate: input.asOfDate, fundCluster: input.fundCluster, office: input.office, metadata: input.metadata, operationId: countOperationId, correlationId: input.correlationId });
    const lines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, count.id)).for("update");
    for (const entry of included) {
      const mapping = entry.mapping;
      const line = lines.find((candidate) => candidate.lotId === mapping.lotId);
      if (!line) throw new CustodialError("CONFLICT", "A target lot is not in the as-of count scope.");
      const snapshot = z.object({ cardQuantity: z.number().int().nonnegative() }).passthrough().parse(line.snapshot);
      const evidence = z.object({ fields: z.record(z.string(), z.object({ value: z.unknown().optional() }).passthrough()) }).passthrough().parse(entry.row.evidence);
      const sourceCard = evidence.fields.cardQuantity?.value;
      if (typeof sourceCard === "number" && Number.isSafeInteger(sourceCard) && sourceCard !== snapshot.cardQuantity && !mapping.cardMismatchReason?.trim()) throw new CustodialError("VALIDATION", "Source card mismatch requires an explicit resolution.");
      const remarks = evidence.fields.remarks?.value;
      const imported = { batchId: batch.id, sourceHash: batch.sourceHash, sheet: entry.row.sheetName, row: entry.row.sourceRow, evidence: entry.row.evidence, warnings: entry.row.warnings, mapping };
      await tx.update(custodialCountLines).set({ importBatchId: batch.id, importEvidence: imported, status: mapping.physicalQuantity === null ? "uncounted" : "counted", physicalQuantity: mapping.physicalQuantity, condition: mapping.condition, remarks: typeof remarks === "string" ? remarks.slice(0, 4000) : null, reviewRequired: true, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id));
    }
    const excludedRows = mapped.flatMap((entry) => entry.mapping.success && entry.mapping.data.disposition === "exclude" ? [{ sheet: entry.row.sheetName, row: entry.row.sourceRow, reason: entry.mapping.data.reason }] : []);
    await tx.update(custodialCounts).set({ metadata: { ...countMetadata.parse(count.metadata), importProvenance: { batchId: batch.id, sourceHash: batch.sourceHash, excludedRows, warningResolutions: input.warningResolutions } }, version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.commit_combined", targetType: "custodial_import_batch", targetId: batch.id, after: { countId: count.id, sourceHash: batch.sourceHash, openings: openings.openings, excluded: openings.excluded }, correlationId: input.correlationId });
    const result = { ...openings, countId: count.id };
    await saveMaster(tx, actor, input.operationId, "import.commit.combined", replay.hash, batch.id, result);
    return result;
  });
}

/** Drop expired temporary bytes and staged row details, retaining a minimal batch record. */
export async function expireCustodialImport(db: Database, actor: Actor, batchId: string, operationId: string, correlationId: string) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const replay = await beginMaster(tx, actor, operationId, "import.expire", { batchId });
    const [batch] = await tx.select().from(custodialImportBatches).where(eq(custodialImportBatches.id, batchId)).for("update");
    if (!batch) throw new CustodialError("NOT_FOUND", "Import is unavailable.");
    if (replay.prior) return savedResult<{ expired: boolean }>(replay.prior.result);
    if (batch.expiresAt > new Date()) throw new CustodialError("CONFLICT", "Import has not expired.");
    if (batch.status !== "expired" && batch.rawBase64 !== null) {
      if (batch.status === "staged") await tx.delete(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id));
      await tx.update(custodialImportBatches).set({ rawBase64: null, status: batch.status === "staged" ? "expired" : batch.status, version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
      await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.import.expire", targetType: "custodial_import_batch", targetId: batch.id, after: { status: batch.status === "staged" ? "expired" : batch.status }, correlationId });
    }
    const result = { expired: true };
    await saveMaster(tx, actor, operationId, "import.expire", replay.hash, batch.id, result);
    return result;
  });
}

/** Internal housekeeping; committed provenance remains after temporary bytes expire. */
export async function purgeExpiredCustodialImports(db: Database) {
  return db.transaction(async (tx) => {
    const expired = await tx.select().from(custodialImportBatches).where(and(lte(custodialImportBatches.expiresAt, new Date()), isNotNull(custodialImportBatches.rawBase64))).limit(50).for("update", { skipLocked: true });
    for (const batch of expired) {
      if (batch.status === "staged") await tx.delete(custodialImportRows).where(eq(custodialImportRows.batchId, batch.id));
      await tx.update(custodialImportBatches).set({ rawBase64: null, status: batch.status === "staged" ? "expired" : batch.status, version: batch.version + 1 }).where(eq(custodialImportBatches.id, batch.id));
      await writeAuditEntry(tx, { actorId: null, action: "custodial.import.expire", targetType: "custodial_import_batch", targetId: batch.id, after: { status: batch.status === "staged" ? "expired" : batch.status }, correlationId: crypto.randomUUID() });
    }
    return expired.length;
  });
}

const headingStyle = z.object({ font: z.string().trim().min(1).max(100), size: z.number().positive().max(72), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), alignment: z.enum(["left", "center", "right"]).optional() });
const detailBorderRule = z.object({ single: z.array(z.string().regex(/^[ntm]{4}$/)).max(12), first: z.array(z.string().regex(/^[ntm]{4}$/)).max(12), middle: z.array(z.string().regex(/^[ntm]{4}$/)).max(12), last: z.array(z.string().regex(/^[ntm]{4}$/)).max(12) });
const profileSheet = z.object({
  name: z.string().trim().min(1).max(31), title: z.string().trim().min(1).max(240), label: z.string().trim().min(1).max(120),
  reportTitle: z.string().trim().min(1).max(240).optional(), typeCaption: z.string().trim().min(1).max(240).optional(),
  columns: z.array(z.object({ label: z.string().trim().min(1).max(120), width: z.number().positive().max(100) })).min(1).max(12),
  font: z.string().trim().min(1).max(100), fontSize: z.number().positive().max(72),
  headingStyles: z.object({ label: headingStyle.optional(), title: headingStyle.optional(), type: headingStyle.optional(), caption: headingStyle.optional(), date: headingStyle.optional() }).optional(),
  headerBorders: z.array(z.array(z.string().regex(/^[ntm]{4}$/)).max(12)).max(3).optional(),
  detailBorders: detailBorderRule.optional(),
  detailBordersBySection: z.record(z.string().trim().min(1).max(240), detailBorderRule).refine((rules) => Object.keys(rules).length <= 20).optional(),
  articleRotation: z.union([z.literal(0), z.literal(90)]).optional(),
  articleStyle: headingStyle.optional(),
  articleStylesBySection: z.record(z.string().trim().min(1).max(240), headingStyle).refine((styles) => Object.keys(styles).length <= 20).optional(),
  continuationRows: z.boolean().optional(),
  signatureExtraMerges: z.array(z.object({ rowOffset: z.number().int().min(1).max(110), startColumn: z.number().int().min(1).max(12), endColumn: z.number().int().min(1).max(12) }).refine((range) => range.startColumn < range.endColumn)).max(20).optional(),
  thresholdNotePosition: z.object({ rowOffset: z.number().int().min(1).max(120), column: z.number().int().min(1).max(12) }).optional(),
  thresholdNoteStyle: headingStyle.optional(),
  orientation: z.enum(["portrait", "landscape"]), margins: z.object({ top: z.number().min(0).max(5), bottom: z.number().min(0).max(5), left: z.number().min(0).max(5), right: z.number().min(0).max(5) }),
  mergedRanges: z.array(z.string().regex(/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/)).max(200),
  applyHeaderMerges: z.boolean().optional(),
  headerRows: z.object({ first: z.number().int().positive(), last: z.number().int().positive() }).refine((rows) => rows.first <= rows.last),
  detailStartRow: z.number().int().positive(), sectionLabels: z.array(z.string().trim().min(1).max(240)).max(20),
  subtotalAfterSections: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  sumUnitValues: z.boolean().optional(),
  stockCardPageRows: z.number().int().min(2).max(100).optional(),
  signatures: z.array(z.object({ role: z.enum(["custodian", "committee_chair", "committee_member", "school_head"]), startColumn: z.number().int().min(1).max(12), endColumn: z.number().int().min(1).max(12), rowOffset: z.number().int().min(0).max(100), designationOffset: z.number().int().min(1).max(5).optional(), signatureLabel: z.string().trim().min(1).max(240).optional(), labelOffset: z.number().int().min(1).max(5).optional(), labelEndColumn: z.number().int().min(1).max(12).optional(), underlineName: z.boolean().optional() }).refine((signature) => signature.startColumn <= signature.endColumn && (signature.labelEndColumn === undefined || signature.labelEndColumn >= signature.startColumn) && (!signature.signatureLabel || (signature.labelOffset ?? 1) !== (signature.designationOffset ?? 1)))).max(4),
});
export const custodialProfileDefinition = z.object({
  rendererVersion: z.literal("v1").optional(),
  sheets: z.array(profileSheet).min(1).max(3), dateFormat: z.string().trim().min(1).max(80), numberFormat: z.string().trim().min(1).max(80), currencyFormat: z.string().trim().min(1).max(80),
  asOfDisplay: z.enum(["iso", "month_year", "long_date"]).optional(),
  thresholdNote: z.string().trim().max(1000),
  thresholdExample: z.string().trim().min(1).max(1000).optional(),
  defaultSignatories: z.object({ accountableOfficer: z.string().trim().max(240).optional(), accountableDesignation: z.string().trim().max(240).optional(), custodian: z.string().trim().max(240).optional(), custodianDesignation: z.string().trim().max(240).optional(), committeeChair: z.string().trim().max(240).optional(), committeeChairDesignation: z.string().trim().max(240).optional(), committeeMember: z.string().trim().max(240).optional(), committeeMemberDesignation: z.string().trim().max(240).optional(), schoolHead: z.string().trim().max(240).optional(), schoolHeadDesignation: z.string().trim().max(240).optional() }).strict().optional(),
});
export type CustodialProfileDefinition = z.infer<typeof custodialProfileDefinition>;
function freezeProfileDefinition(definition: CustodialProfileDefinition, family: "stock_card" | "rpcsp" | "rpcppe"): CustodialProfileDefinition {
  const reportTitle = family === "stock_card" ? "STOCK CARD" : family === "rpcsp" ? "REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY" : "REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT";
  const typeCaption = family === "rpcsp" ? "(Type of Semi-Expendable Property)" : "(Type of Property, Plant and Equipment)";
  return { ...definition, rendererVersion: definition.rendererVersion ?? "v1", asOfDisplay: definition.asOfDisplay ?? "iso", sheets: definition.sheets.map((sheet) => ({ ...sheet, reportTitle: sheet.reportTitle ?? reportTitle, ...(family === "stock_card" ? {} : { typeCaption: sheet.typeCaption ?? typeCaption }), applyHeaderMerges: sheet.applyHeaderMerges ?? false, continuationRows: sheet.continuationRows ?? false, subtotalAfterSections: sheet.subtotalAfterSections ?? [], sumUnitValues: sheet.sumUnitValues ?? false, ...(family === "stock_card" ? { stockCardPageRows: sheet.stockCardPageRows ?? 26 } : {}) })) };
}

export const countMetadata = z.object({
  entity: z.string().trim().min(1).max(240), accountableOfficer: z.string().trim().min(1).max(240), accountableDesignation: z.string().trim().min(1).max(240),
  accountabilityAssumedDate: z.iso.date(), custodian: z.string().trim().min(1).max(240), custodianDesignation: z.string().trim().min(1).max(240),
  committeeChair: z.string().trim().min(1).max(240), committeeChairDesignation: z.string().trim().min(1).max(240),
  committeeMember: z.string().trim().min(1).max(240), committeeMemberDesignation: z.string().trim().min(1).max(240), schoolHead: z.string().trim().min(1).max(240), schoolHeadDesignation: z.string().trim().min(1).max(240),
});

async function getCountSources(tx: AuditTransaction, scope: { family: "rpcsp" | "rpcppe"; fundCluster: string; office: string | null; asOfDate: string; sectionIds: string[] }) {
  type LedgerRow = { id: string; effectiveDate: string; sequence: number; delta: number; balanceId: string; office: string };
  // One statement gives all included lots and their dated ledger a single PostgreSQL snapshot.
  const lots = await tx.select({ lot: custodialLots, item: custodialItems, section: custodialSections, ledger: sql<LedgerRow[]>`coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'effectiveDate', co.transaction_date, 'sequence', co.sequence, 'delta', ct.delta, 'balanceId', cb.id, 'office', cb.office) order by co.transaction_date, co.sequence, ct.id) from custodial_transactions ct join custodial_operations co on co.id = ct.operation_id join custodial_balances cb on cb.id = ct.balance_id where cb.lot_id = ${custodialLots.id} and co.transaction_date <= ${scope.asOfDate} ${scope.office ? sql`and cb.office = ${scope.office}` : sql``}), '[]'::jsonb)`, balanceVersions: sql<{ id: string; version: number }[]>`coalesce((select jsonb_agg(jsonb_build_object('id', cb.id, 'version', cb.version) order by cb.id) from custodial_balances cb where cb.lot_id = ${custodialLots.id} ${scope.office ? sql`and cb.office = ${scope.office}` : sql``}), '[]'::jsonb)` }).from(custodialLots).innerJoin(custodialItems, eq(custodialLots.itemId, custodialItems.id)).leftJoin(custodialSections, eq(custodialItems.defaultSectionId, custodialSections.id)).where(and(eq(custodialLots.fundCluster, scope.fundCluster), eq(custodialLots.reportingClass, scope.family === "rpcsp" ? "semi_expendable" : "ppe"), eq(custodialLots.active, true), eq(custodialItems.active, true), sql`(${custodialLots.acquiredOn} IS NULL OR ${custodialLots.acquiredOn} <= ${scope.asOfDate})`));
  const sources: Array<{ lotId: string; snapshot: Record<string, unknown>; sourceFingerprint: string }> = [];
  for (const { lot, item, section, ledger, balanceVersions } of lots) {
    if (scope.sectionIds.length && (!item.defaultSectionId || !scope.sectionIds.includes(item.defaultSectionId))) continue;
    if (scope.office && ledger.length === 0 && lot.office !== scope.office) continue;
    const ordered = [...ledger].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence || a.id.localeCompare(b.id));
    const cardQuantity = ordered.reduce((sum, entry) => sum + entry.delta, 0);
    if (!Number.isSafeInteger(cardQuantity) || cardQuantity < 0 || cardQuantity > 2147483647) throw new CustodialError("CONFLICT", "The as-of ledger is invalid.");
    const snapshot = { itemId: item.id, itemCode: item.code, article: item.article, description: item.description, unit: item.unit, sectionId: item.defaultSectionId, section: section ? { id: section.id, version: section.version, name: section.name, sheetName: section.sheetName, displayOrder: section.displayOrder, active: section.active, effectiveFrom: section.effectiveFrom, effectiveUntil: section.effectiveUntil } : null, lotId: lot.id, lotVersion: lot.version, propertyNumber: lot.propertyNumber, unitValue: lot.unitValue, supplier: lot.supplier, acquiredOn: lot.acquiredOn, yearLabel: lot.yearLabel, fundCluster: lot.fundCluster, accountableOfficer: lot.accountableOfficer, lotOffice: lot.office, office: scope.office, condition: lot.condition, remarks: lot.remarks, cardQuantity };
    sources.push({ lotId: lot.id, snapshot: { ...snapshot, balanceVersions }, sourceFingerprint: fingerprint({ snapshot, ledger: ordered }) });
  }
  return sources;
}

async function getCountRefreshPlan(tx: AuditTransaction, count: typeof custodialCounts.$inferSelect) {
  if (count.family === "stock_card") throw new CustodialError("VALIDATION", "Count family is unavailable.");
  const sources = await getCountSources(tx, { family: count.family, fundCluster: count.fundCluster, office: count.office, asOfDate: count.asOfDate, sectionIds: count.sectionIds });
  const lines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, count.id));
  const omissions = await tx.select().from(custodialCountOmissions).where(and(eq(custodialCountOmissions.countId, count.id), eq(custodialCountOmissions.active, true)));
  const sourceByLot = new Map(sources.map((source) => [source.lotId, source]));
  const lineByLot = new Map(lines.map((line) => [line.lotId, line]));
  const omissionByLot = new Map(omissions.map((entry) => [entry.lotId, entry]));
  const added = sources.filter((source) => !lineByLot.has(source.lotId) && (!omissionByLot.has(source.lotId) || omissionByLot.get(source.lotId)!.sourceFingerprint !== source.sourceFingerprint)).sort((a, b) => a.lotId.localeCompare(b.lotId));
  const omitted = omissions.map((omission) => ({ omission, source: sourceByLot.get(omission.lotId) ?? null })).sort((a, b) => a.omission.lotId.localeCompare(b.omission.lotId));
  const changed = lines.filter((line) => sourceByLot.has(line.lotId) && sourceByLot.get(line.lotId)!.sourceFingerprint !== line.sourceFingerprint).sort((a, b) => a.lotId.localeCompare(b.lotId)).map((line) => ({ line, source: sourceByLot.get(line.lotId)! }));
  const unavailable = lines.filter((line) => !sourceByLot.has(line.lotId)).sort((a, b) => a.lotId.localeCompare(b.lotId));
  const planHash = fingerprint({ countId: count.id, version: count.version, added: added.map((source) => [source.lotId, source.sourceFingerprint]), changed: changed.map(({ line, source }) => [line.id, line.version, source.sourceFingerprint]), unavailable: unavailable.map((line) => [line.id, line.version]), omitted: omitted.map(({ omission, source }) => [omission.id, omission.sourceFingerprint, source?.sourceFingerprint ?? null]) });
  return { added, changed, unavailable, omitted, planHash };
}

/** Preview membership and source changes without changing saved observations. */
export async function previewCustodialCountRefresh(db: Database, actor: Actor, countId: string) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, countId)).for("share");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    const plan = await getCountRefreshPlan(tx, count);
    return { version: count.version, planHash: plan.planHash, added: plan.added.map((source) => ({ lotId: source.lotId, snapshot: source.snapshot })), changed: plan.changed.map(({ line, source }) => ({ lineId: line.id, lotId: line.lotId, before: line.snapshot, after: source.snapshot })), unavailable: plan.unavailable.map((line) => ({ lineId: line.id, lotId: line.lotId, snapshot: line.snapshot })), omitted: plan.omitted.map(({ omission, source }) => ({ lotId: omission.lotId, reason: omission.reason, snapshot: omission.snapshot, currentlyAvailable: source !== null })) };
  });
}

/** Refresh only after an explicit preview; retained lines never lose observations. */
export async function refreshCustodialCount(db: Database, actor: Actor, input: { countId: string; expectedVersion: number; planHash: string; includeLotIds: string[]; excludeLots?: Array<{ lotId: string; reason: string }>; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  const exclusions = z.array(z.object({ lotId: z.uuid(), reason: z.string().trim().min(1).max(1000) }).strict()).max(10000).safeParse(input.excludeLots ?? []);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !/^[0-9a-f]{64}$/.test(input.planHash) || input.includeLotIds.length > 10000 || new Set(input.includeLotIds).size !== input.includeLotIds.length || !exclusions.success || new Set(exclusions.data.map((entry) => entry.lotId)).size !== exclusions.data.length || exclusions.data.some((entry) => input.includeLotIds.includes(entry.lotId))) throw new CustodialError("VALIDATION", "Invalid refresh selection.");
  const excludeLots = [...exclusions.data].sort((a, b) => a.lotId.localeCompare(b.lotId));
  const values = { countId: input.countId, expectedVersion: input.expectedVersion, planHash: input.planHash, includeLotIds: [...input.includeLotIds].sort(), excludeLots: excludeLots.length ? excludeLots : undefined };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.refresh", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    if (replay.prior) return savedResult<{ version: number; added: number; changed: number; unavailable: number }>(replay.prior.result);
    if (count.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The count changed; preview again.");
    const plan = await getCountRefreshPlan(tx, count);
    if (plan.planHash !== input.planHash) throw new CustodialError("CONFLICT", "Inventory changed; preview again.");
    const selected = new Set(values.includeLotIds);
    const selectable = new Map([...plan.added, ...plan.omitted.flatMap(({ source }) => source ? [source] : [])].map((source) => [source.lotId, source]));
    if (values.includeLotIds.some((id) => !selectable.has(id)) || excludeLots.some((entry) => !plan.added.some((source) => source.lotId === entry.lotId))) throw new CustodialError("VALIDATION", "The selected items are not in the current preview.");
    for (const id of values.includeLotIds) {
      await tx.insert(custodialCountLines).values({ countId: count.id, ...selectable.get(id)! });
      await tx.update(custodialCountOmissions).set({ active: false }).where(and(eq(custodialCountOmissions.countId, count.id), eq(custodialCountOmissions.lotId, id)));
    }
    for (const exclusion of excludeLots) {
      const source = selectable.get(exclusion.lotId)!;
      const [previous] = await tx.select().from(custodialCountOmissions).where(and(eq(custodialCountOmissions.countId, count.id), eq(custodialCountOmissions.lotId, exclusion.lotId)));
      const decision = { sourceFingerprint: source.sourceFingerprint, snapshot: source.snapshot, reason: exclusion.reason, active: true, decidedBy: actor.id, decidedAt: new Date() };
      if (previous) await tx.update(custodialCountOmissions).set(decision).where(eq(custodialCountOmissions.id, previous.id));
      else await tx.insert(custodialCountOmissions).values({ countId: count.id, lotId: exclusion.lotId, ...decision });
    }
    for (const { line, source } of plan.changed) await tx.update(custodialCountLines).set({ snapshot: source.snapshot, sourceFingerprint: source.sourceFingerprint, reviewRequired: true, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id));
    for (const line of plan.unavailable.filter((entry) => !entry.reviewRequired && entry.status !== "unavailable" && entry.status !== "excluded")) await tx.update(custodialCountLines).set({ reviewRequired: true, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id));
    await tx.update(custodialCounts).set({ version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    const result = { version: count.version + 1, added: selected.size, excluded: excludeLots.length, changed: plan.changed.length, unavailable: plan.unavailable.length };
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.refresh", targetType: "custodial_count", targetId: count.id, before: { version: count.version }, after: { ...result, addedLotIds: values.includeLotIds, exclusions: excludeLots, changedLineIds: plan.changed.map(({ line }) => line.id), unavailableLineIds: plan.unavailable.map((line) => line.id) }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "count.refresh", replay.hash, count.id, result);
    return result;
  });
}

export async function reviewCustodialCountLine(db: Database, actor: Actor, input: { countId: string; lineId: string; expectedVersion: number; note: string; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  required(input.note);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new CustodialError("VALIDATION", "A valid line version is required.");
  const values = { countId: input.countId, lineId: input.lineId, expectedVersion: input.expectedVersion, note: input.note.trim() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.line.review", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    const [line] = await tx.select().from(custodialCountLines).where(and(eq(custodialCountLines.id, input.lineId), eq(custodialCountLines.countId, count.id))).for("update");
    if (!line) throw new CustodialError("NOT_FOUND", "Line is unavailable.");
    if (replay.prior) return savedResult<{ id: string; version: number }>(replay.prior.result);
    if (line.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The count line changed; refresh and retry.");
    if (line.status !== "counted") throw new CustodialError("VALIDATION", "A counted line is required for review.");
    const plan = await getCountRefreshPlan(tx, count);
    if (plan.changed.some((entry) => entry.line.id === line.id) || plan.unavailable.some((entry) => entry.id === line.id)) throw new CustodialError("CONFLICT", "The source changed; preview the count again.");
    const [updated] = await tx.update(custodialCountLines).set({ reviewRequired: false, resolution: values.note, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Review could not be saved.");
    await tx.update(custodialCounts).set({ version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.line.review", targetType: "custodial_count_line", targetId: line.id, before: { reviewRequired: line.reviewRequired }, after: { reviewRequired: false, note: values.note }, correlationId: input.correlationId });
    const result = { id: updated.id, version: updated.version };
    await saveMaster(tx, actor, input.operationId, "count.line.review", replay.hash, count.id, result);
    return result;
  });
}

/** Explicitly resolve a line without treating missing physical data as zero. */
export async function resolveCustodialCountLine(db: Database, actor: Actor, input: { countId: string; lineId: string; expectedVersion: number; status: "excluded" | "unavailable"; reason: string; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  required(input.reason);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !["excluded", "unavailable"].includes(input.status)) throw new CustodialError("VALIDATION", "A valid line version and resolution are required.");
  const values = { countId: input.countId, lineId: input.lineId, expectedVersion: input.expectedVersion, status: input.status, reason: input.reason.trim() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.line.resolve", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    const [line] = await tx.select().from(custodialCountLines).where(and(eq(custodialCountLines.id, input.lineId), eq(custodialCountLines.countId, count.id))).for("update");
    if (!line) throw new CustodialError("NOT_FOUND", "Line is unavailable.");
    if (replay.prior) return savedResult<{ id: string; version: number }>(replay.prior.result);
    if (line.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The count line changed; refresh and retry.");
    const plan = await getCountRefreshPlan(tx, count);
    if (plan.changed.some((entry) => entry.line.id === line.id)) throw new CustodialError("CONFLICT", "The source changed; preview the count again.");
    const [updated] = await tx.update(custodialCountLines).set({ status: input.status, physicalQuantity: null, resolution: values.reason, reviewRequired: false, version: line.version + 1 }).where(eq(custodialCountLines.id, line.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Resolution could not be saved.");
    await tx.update(custodialCounts).set({ version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.line.resolve", targetType: "custodial_count_line", targetId: line.id, before: { status: line.status, physicalQuantity: line.physicalQuantity }, after: { status: updated.status, reason: values.reason }, correlationId: input.correlationId });
    const result = { id: updated.id, version: updated.version };
    await saveMaster(tx, actor, input.operationId, "count.line.resolve", replay.hash, count.id, result);
    return result;
  });
}

/** Creates a draft from one consistent effective-dated ledger snapshot. */
export async function createCustodialCount(db: Database, actor: Actor, input: { code: string; family: "rpcsp" | "rpcppe"; profileId: string; asOfDate: string; fundCluster: string; office?: string | null; sectionIds?: string[]; metadata: z.infer<typeof countMetadata>; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  required(input.code); required(input.fundCluster);
  if (input.office) required(input.office);
  const parsed = countMetadata.safeParse(input.metadata);
  const date = new Date(`${input.asOfDate}T00:00:00.000Z`);
  if (!parsed.success || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.asOfDate || !["rpcsp", "rpcppe"].includes(input.family)) throw new CustodialError("VALIDATION", "Valid count metadata and as-of date are required.");
  const scope = z.array(z.uuid()).max(100).safeParse(input.sectionIds ?? []);
  if (!scope.success || new Set(scope.data).size !== scope.data.length) throw new CustodialError("VALIDATION", "Invalid count section scope.");
  const values = { code: input.code.trim(), normalizedCode: input.code.trim().toUpperCase(), family: input.family, profileId: input.profileId, asOfDate: input.asOfDate, fundCluster: input.fundCluster.trim(), office: input.office?.trim() || null, ...(scope.data.length ? { sectionIds: [...scope.data].sort() } : {}), metadata: parsed.data };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.create", values);
    if (replay.prior) {
      const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, replay.prior.targetId));
      if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
      return savedResult<typeof count>(replay.prior.result);
    }
    const [profile] = await tx.select().from(custodialFormProfiles).where(eq(custodialFormProfiles.id, input.profileId));
    if (!profile || profile.family !== input.family || profile.effectiveFrom > input.asOfDate) throw new CustodialError("VALIDATION", "A matching effective form profile is required.");
    if (values.sectionIds?.length) {
      const sections = await tx.select().from(custodialSections).where(inArray(custodialSections.id, values.sectionIds));
      const definition = custodialProfileDefinition.safeParse(profile.definition);
      if (!definition.success || sections.length !== values.sectionIds.length || sections.some((section) => section.formFamily !== input.family || !section.active || (section.effectiveFrom && section.effectiveFrom > input.asOfDate) || (section.effectiveUntil && section.effectiveUntil < input.asOfDate) || !definition.data.sheets.some((sheet) => sheet.name === section.sheetName && sheet.sectionLabels.includes(section.name)))) throw new CustodialError("VALIDATION", "Selected sections must be active, effective and included in the chosen profile.");
    }
    const [count] = await tx.insert(custodialCounts).values({ ...values, createdBy: actor.id }).returning();
    if (!count) throw new CustodialError("CONFLICT", "Count could not be created.");
    for (const source of await getCountSources(tx, { ...values, sectionIds: values.sectionIds ?? [] })) {
      await tx.insert(custodialCountLines).values({ countId: count.id, ...source });
    }
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.create", targetType: "custodial_count", targetId: count.id, after: { family: count.family, fundCluster: count.fundCluster, asOfDate: count.asOfDate, sectionIds: count.sectionIds }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "count.create", replay.hash, count.id, count);
    return count;
  });
}

/** Assign or revoke a staff member's access to a draft session or one line. */
export async function setCustodialCountAssignment(db: Database, actor: Actor, input: { countId: string; lineId?: string | null; userId: string; active: boolean; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  const values = { countId: input.countId, lineId: input.lineId ?? null, userId: input.userId, active: input.active };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.assignment", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    if (input.lineId) {
      const [line] = await tx.select({ id: custodialCountLines.id }).from(custodialCountLines).where(and(eq(custodialCountLines.id, input.lineId), eq(custodialCountLines.countId, count.id)));
      if (!line) throw new CustodialError("NOT_FOUND", "Line is unavailable.");
    }
    const [assignee] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, input.userId)).for("share");
    if (!assignee || (input.active && (!assignee.active || assignee.role !== "staff" || assignee.mustChangePassword))) throw new CustodialError("VALIDATION", "Assign an active Staff account.");
    if (replay.prior) return savedResult<{ id: string; active: boolean }>(replay.prior.result);
    const [existing] = await tx.select().from(custodialCountAssignments).where(and(eq(custodialCountAssignments.countId, count.id), eq(custodialCountAssignments.userId, input.userId), values.lineId ? eq(custodialCountAssignments.lineId, values.lineId) : isNull(custodialCountAssignments.lineId))).for("update");
    const [assignment] = existing ? await tx.update(custodialCountAssignments).set({ active: input.active, assignedBy: actor.id }).where(eq(custodialCountAssignments.id, existing.id)).returning() : await tx.insert(custodialCountAssignments).values({ countId: count.id, lineId: values.lineId, userId: input.userId, active: input.active, assignedBy: actor.id }).returning();
    if (!assignment) throw new CustodialError("CONFLICT", "Assignment could not be saved.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.assignment", targetType: "custodial_count", targetId: count.id, before: { active: existing?.active ?? false }, after: { userId: input.userId, lineId: values.lineId, active: input.active }, correlationId: input.correlationId });
    const result = { id: assignment.id, active: assignment.active };
    await saveMaster(tx, actor, input.operationId, "count.assignment", replay.hash, count.id, result);
    return result;
  });
}

export const conditionBreakdownSchema = z.array(z.object({ condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use"]), quantity: z.number().int().positive().max(2147483647) }).strict()).min(2).max(7);

/** Save only physical observations; card quantity and valuation remain frozen. */
export async function saveCustodialCountLine(db: Database, actor: Actor, input: { countId: string; lineId: string; expectedVersion: number; physicalQuantity: number; condition: string; conditionBreakdown?: z.infer<typeof conditionBreakdownSchema> | null; remarks?: string | null; reviewerNote?: string | null; operationId: string; correlationId: string }) {
  if (!Number.isSafeInteger(input.physicalQuantity) || input.physicalQuantity < 0 || input.physicalQuantity > 2147483647 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new CustodialError("VALIDATION", "A nonnegative quantity and line version are required.");
  required(input.condition);
  if (!["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved", "mixed"].includes(input.condition.trim())) throw new CustodialError("VALIDATION", "Choose a supported condition.");
  const breakdown = input.conditionBreakdown == null ? null : conditionBreakdownSchema.safeParse(input.conditionBreakdown);
  if ((breakdown && !breakdown.success) || (input.condition.trim() === "mixed" && (!breakdown || !breakdown.success || new Set(breakdown.data.map((part) => part.condition)).size !== breakdown.data.length || breakdown.data.reduce((total, part) => total + part.quantity, 0) !== input.physicalQuantity)) || (input.condition.trim() !== "mixed" && breakdown)) throw new CustodialError("VALIDATION", "A mixed condition requires distinct quantities that add up to the physical count.");
  if (input.remarks && input.remarks.length > 4000) throw new CustodialError("VALIDATION", "Remarks are too long.");
  if (input.reviewerNote && input.reviewerNote.length > 4000) throw new CustodialError("VALIDATION", "Reviewer note is too long.");
  const values = { countId: input.countId, lineId: input.lineId, expectedVersion: input.expectedVersion, physicalQuantity: input.physicalQuantity, condition: input.condition.trim(), ...(breakdown?.success ? { conditionBreakdown: [...breakdown.data].sort((a, b) => a.condition.localeCompare(b.condition)) } : {}), remarks: input.remarks?.trim() || null, reviewerNote: input.reviewerNote === undefined ? undefined : input.reviewerNote?.trim() || null };
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).for("share");
    if (!profile?.active || profile.mustChangePassword || !["admin", "property_custodian", "staff"].includes(profile.role)) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const replay = await beginMaster(tx, actor, input.operationId, "count.line.save", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    const [line] = await tx.select().from(custodialCountLines).where(and(eq(custodialCountLines.id, input.lineId), eq(custodialCountLines.countId, count.id))).for("update");
    if (!line) throw new CustodialError("NOT_FOUND", "Line is unavailable.");
    if (profile.role === "staff") {
      const [assignment] = await tx.select({ id: custodialCountAssignments.id }).from(custodialCountAssignments).where(and(eq(custodialCountAssignments.countId, count.id), eq(custodialCountAssignments.userId, actor.id), eq(custodialCountAssignments.active, true), or(isNull(custodialCountAssignments.lineId), eq(custodialCountAssignments.lineId, line.id)))).limit(1);
      if (!assignment) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
      if (line.status === "excluded" || line.status === "unavailable") throw new CustodialError("FORBIDDEN", "This line requires review.");
    }
    if (replay.prior) return savedResult<{ id: string; version: number }>(replay.prior.result);
    if (line.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The count line changed; refresh and retry.");
    const [updated] = await tx.update(custodialCountLines).set({ status: "counted", physicalQuantity: input.physicalQuantity, condition: values.condition, conditionBreakdown: values.conditionBreakdown ?? null, remarks: values.remarks, reviewerNote: values.reviewerNote === undefined ? line.reviewerNote : values.reviewerNote, resolution: null, reviewRequired: line.reviewRequired || line.resolution !== null || values.condition === "mixed", version: line.version + 1 }).where(eq(custodialCountLines.id, line.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Line could not be saved.");
    await tx.update(custodialCounts).set({ version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.line.save", targetType: "custodial_count_line", targetId: line.id, before: { status: line.status, physicalQuantity: line.physicalQuantity, condition: line.condition, conditionBreakdown: line.conditionBreakdown }, after: { status: updated.status, physicalQuantity: updated.physicalQuantity, condition: updated.condition, conditionBreakdown: updated.conditionBreakdown }, correlationId: input.correlationId });
    const result = { id: updated.id, version: updated.version };
    await saveMaster(tx, actor, input.operationId, "count.line.save", replay.hash, count.id, result);
    return result;
  });
}

/** Available configuration for authorized inventory and count managers. */
export async function getCustodialCountConfiguration(db: Database, actor: Actor) {
  return db.transaction(async (tx) => {
    const profile = await authorize(tx, actor);
    const profiles = await tx.select({ id: custodialFormProfiles.id, family: custodialFormProfiles.family, version: custodialFormProfiles.version, effectiveFrom: custodialFormProfiles.effectiveFrom, versionNote: custodialFormProfiles.versionNote, definition: custodialFormProfiles.definition }).from(custodialFormProfiles).orderBy(desc(custodialFormProfiles.version));
    const sections = await tx.select().from(custodialSections).where(profile.role === "admin" ? undefined : eq(custodialSections.active, true)).orderBy(custodialSections.displayOrder, custodialSections.id);
    const policies = await tx.select().from(custodialClassificationPolicies).orderBy(desc(custodialClassificationPolicies.effectiveFrom), desc(custodialClassificationPolicies.version));
    return { profiles, sections, policies };
  });
}

export async function createCustodialClassificationPolicy(db: Database, actor: Actor, input: { effectiveFrom: string; threshold: string; note: string; operationId: string; correlationId: string }) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  const parsed = z.object({ effectiveFrom: z.iso.date(), threshold: z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/), note: z.string().trim().min(1).max(1000), operationId: z.uuid(), correlationId: z.string().min(1) }).strict().safeParse(input);
  if (!parsed.success) throw new CustodialError("VALIDATION", "Valid classification policy details are required.");
  const [whole, fraction = ""] = input.threshold.split(".");
  const values = { effectiveFrom: input.effectiveFrom, threshold: `${BigInt(whole!).toString()}.${fraction.padEnd(2, "0")}`, note: input.note.trim() };
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const replay = await beginMaster(tx, actor, input.operationId, "classification.policy.create", values);
    if (replay.prior) {
      const [current] = await tx.select().from(custodialClassificationPolicies).where(eq(custodialClassificationPolicies.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Classification policy is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('custodial-classification-policy', 5))`);
    const [last] = await tx.select({ version: sql<number>`coalesce(max(${custodialClassificationPolicies.version}), 0)` }).from(custodialClassificationPolicies);
    const [policy] = await tx.insert(custodialClassificationPolicies).values({ ...values, version: Number(last?.version ?? 0) + 1, createdBy: actor.id }).returning();
    if (!policy) throw new CustodialError("CONFLICT", "Classification policy could not be recorded.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.classification_policy.create", targetType: "custodial_classification_policy", targetId: policy.id, after: { version: policy.version, effectiveFrom: policy.effectiveFrom, threshold: policy.threshold, note: policy.note }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "classification.policy.create", replay.hash, policy.id, policy);
    return policy;
  });
}

export async function listCustodialCountAssignees(db: Database, actor: Actor) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    return tx.select({ id: user.id, name: user.name }).from(user).innerJoin(userProfiles, eq(userProfiles.userId, user.id)).where(and(eq(userProfiles.role, "staff"), eq(userProfiles.active, true), eq(userProfiles.mustChangePassword, false))).orderBy(user.name, user.id);
  });
}

const sectionInput = z.object({ name: z.string().trim().min(1).max(240), sheetName: z.string().trim().min(1).max(31), displayOrder: z.number().int().min(0).max(2147483647), active: z.boolean(), effectiveFrom: z.iso.date().nullable(), effectiveUntil: z.iso.date().nullable(), reason: z.string().trim().min(1).max(1000) }).strict().refine((entry) => !entry.effectiveFrom || !entry.effectiveUntil || entry.effectiveFrom <= entry.effectiveUntil);
const sectionSheets = { rpcsp: ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"], rpcppe: ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"] } as const;

export async function createCustodialSection(db: Database, actor: Actor, input: { code: string; family: "rpcsp" | "rpcppe"; name: string; sheetName: string; displayOrder: number; active: boolean; effectiveFrom: string | null; effectiveUntil: string | null; reason: string; operationId: string; correlationId: string }) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  const parsed = sectionInput.safeParse({ name: input.name, sheetName: input.sheetName, displayOrder: input.displayOrder, active: input.active, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil, reason: input.reason });
  if (!parsed.success || !/^[A-Z0-9_-]{1,64}$/.test(input.code.trim().toUpperCase()) || !sectionSheets[input.family]?.includes(input.sheetName as never)) throw new CustodialError("VALIDATION", "Valid section details are required.");
  const values = { code: input.code.trim().toUpperCase(), family: input.family, ...parsed.data };
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    await lockCustodialSources(tx);
    const replay = await beginMaster(tx, actor, input.operationId, "section.create", values);
    if (replay.prior) {
      const [current] = await tx.select().from(custodialSections).where(eq(custodialSections.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Section is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${values.family}, 6))`);
    if (values.active) {
      const [duplicate] = await tx.select({ id: custodialSections.id }).from(custodialSections).where(and(eq(custodialSections.formFamily, values.family), eq(custodialSections.active, true), sql`lower(${custodialSections.name}) = lower(${values.name})`)).limit(1);
      if (duplicate) throw new CustodialError("CONFLICT", "An active section with this name already exists in the form family.");
    }
    const [section] = await tx.insert(custodialSections).values({ code: values.code, formFamily: values.family, name: values.name, sheetName: values.sheetName, displayOrder: values.displayOrder, active: values.active, effectiveFrom: values.effectiveFrom, effectiveUntil: values.effectiveUntil }).returning();
    if (!section) throw new CustodialError("CONFLICT", "Section could not be created.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.section.create", targetType: "custodial_section", targetId: section.id, after: { ...values }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "section.create", replay.hash, section.id, section);
    return section;
  });
}

export async function updateCustodialSection(db: Database, actor: Actor, input: { sectionId: string; expectedVersion: number; name: string; sheetName: string; displayOrder: number; active: boolean; effectiveFrom: string | null; effectiveUntil: string | null; reason: string; operationId: string; correlationId: string }) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  const parsed = sectionInput.safeParse({ name: input.name, sheetName: input.sheetName, displayOrder: input.displayOrder, active: input.active, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil, reason: input.reason });
  if (!parsed.success || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new CustodialError("VALIDATION", "Valid section details and version are required.");
  const values = { sectionId: input.sectionId, expectedVersion: input.expectedVersion, ...parsed.data };
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    await lockCustodialSources(tx);
    const replay = await beginMaster(tx, actor, input.operationId, "section.update", values);
    // Serialize section names across updates in the same family before changing a row.
    const [scope] = await tx.select({ family: custodialSections.formFamily }).from(custodialSections).where(eq(custodialSections.id, input.sectionId));
    if (!scope) throw new CustodialError("NOT_FOUND", "Section is unavailable.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.family}, 6))`);
    const [section] = await tx.select().from(custodialSections).where(eq(custodialSections.id, input.sectionId)).for("update");
    if (!section) throw new CustodialError("NOT_FOUND", "Section is unavailable.");
    if (replay.prior) return savedResult<typeof section>(replay.prior.result);
    if (section.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "Section changed; refresh and retry.");
    if (!(section.formFamily in sectionSheets) || !sectionSheets[section.formFamily as keyof typeof sectionSheets].includes(values.sheetName as never)) throw new CustodialError("VALIDATION", "Choose a sheet in the same report family.");
    if (values.active) {
      const [duplicate] = await tx.select({ id: custodialSections.id }).from(custodialSections).where(and(eq(custodialSections.formFamily, section.formFamily), eq(custodialSections.active, true), sql`lower(${custodialSections.name}) = lower(${values.name})`, sql`${custodialSections.id} <> ${section.id}`)).limit(1);
      if (duplicate) throw new CustodialError("CONFLICT", "An active section with this name already exists in the form family.");
    }
    const [updated] = await tx.update(custodialSections).set({ name: values.name, sheetName: values.sheetName, displayOrder: values.displayOrder, active: values.active, effectiveFrom: values.effectiveFrom, effectiveUntil: values.effectiveUntil, version: section.version + 1 }).where(eq(custodialSections.id, section.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Section could not be saved.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.section.update", targetType: "custodial_section", targetId: section.id, before: { name: section.name, sheetName: section.sheetName, displayOrder: section.displayOrder, active: section.active, effectiveFrom: section.effectiveFrom, effectiveUntil: section.effectiveUntil, version: section.version }, after: { name: updated.name, sheetName: updated.sheetName, displayOrder: updated.displayOrder, active: updated.active, effectiveFrom: updated.effectiveFrom, effectiveUntil: updated.effectiveUntil, version: updated.version, reason: values.reason }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "section.update", replay.hash, section.id, updated);
    return updated;
  });
}

/** List only sessions that the current account is allowed to open. */
export async function listCustodialCounts(db: Database, actor: Actor, input: { page: number; pageSize: number }) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new CustodialError("VALIDATION", "Invalid page.");
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).for("share");
    if (!profile?.active || profile.mustChangePassword || !["admin", "property_custodian", "staff"].includes(profile.role)) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const scope = profile.role === "staff" ? and(eq(custodialCounts.status, "draft"), sql`exists (select 1 from custodial_count_assignments a where a.count_id = ${custodialCounts.id} and a.user_id = ${actor.id} and a.active = true)`) : undefined;
    const rows = await tx.select({ id: custodialCounts.id, code: custodialCounts.code, family: custodialCounts.family, asOfDate: custodialCounts.asOfDate, fundCluster: custodialCounts.fundCluster, office: custodialCounts.office, status: custodialCounts.status, version: custodialCounts.version, createdAt: custodialCounts.createdAt, finalizedAt: custodialCounts.finalizedAt }).from(custodialCounts).where(scope).orderBy(desc(custodialCounts.createdAt), desc(custodialCounts.id)).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
    return { rows: rows.slice(0, input.pageSize), hasNext: rows.length > input.pageSize, page: input.page };
  });
}

export async function getCustodialCount(db: Database, actor: Actor, countId: string) {
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, actor.id)).for("share");
    if (!profile?.active || profile.mustChangePassword || !["admin", "property_custodian", "staff"].includes(profile.role)) throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, countId)).for("share");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    const assignments = profile.role === "staff" ? await tx.select({ lineId: custodialCountAssignments.lineId }).from(custodialCountAssignments).where(and(eq(custodialCountAssignments.countId, countId), eq(custodialCountAssignments.userId, actor.id), eq(custodialCountAssignments.active, true))) : [];
    if (profile.role === "staff" && (count.status !== "draft" || assignments.length === 0)) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    const allLines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, countId));
    const sessionAssignment = assignments.some((assignment) => assignment.lineId === null);
    const allowed = profile.role === "staff" && !sessionAssignment ? allLines.filter((line) => assignments.some((assignment) => assignment.lineId === line.id)) : allLines;
    const lines = allowed.map((line) => {
      const snapshot = z.object({ cardQuantity: z.number().int().nonnegative(), unitValue: z.string().nullable() }).passthrough().parse(line.snapshot);
      const variance = line.status === "counted" && line.physicalQuantity !== null ? calculatePhysicalCountVariance({ cardQuantity: snapshot.cardQuantity, physicalQuantity: line.physicalQuantity, unitValue: snapshot.unitValue }) : null;
      return { id: line.id, lotId: line.lotId, snapshot, importBatchId: line.importBatchId, importEvidence: line.importEvidence, status: line.status, physicalQuantity: line.physicalQuantity, condition: line.condition, conditionBreakdown: line.conditionBreakdown, remarks: line.remarks, reviewerNote: line.reviewerNote, resolution: line.resolution, reviewRequired: line.reviewRequired, version: line.version, variance };
    });
    const plan = count.status === "draft" && profile.role !== "staff" ? await getCountRefreshPlan(tx, count) : null;
    const managerAssignments = profile.role !== "staff" ? await tx.select({ id: custodialCountAssignments.id, userId: custodialCountAssignments.userId, lineId: custodialCountAssignments.lineId, active: custodialCountAssignments.active }).from(custodialCountAssignments).where(eq(custodialCountAssignments.countId, countId)) : [];
    return { count, lines, assignments: managerAssignments, sourceChanges: plan ? { added: plan.added.length, changed: plan.changed.length, unavailable: plan.unavailable.length } : null };
  });
}

/** Freeze reviewed report data without posting an inventory adjustment. */
export async function finalizeCustodialCount(db: Database, actor: Actor, input: { countId: string; expectedVersion: number; reviewedSheets: string[]; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || new Set(input.reviewedSheets).size !== input.reviewedSheets.length) throw new CustodialError("VALIDATION", "Valid count and sheet review are required.");
  const values = { countId: input.countId, expectedVersion: input.expectedVersion, reviewedSheets: [...input.reviewedSheets].sort() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    // All custodial source mutations acquire the shared counterpart before writing.
    await lockCustodialSources(tx, true);
    const replay = await beginMaster(tx, actor, input.operationId, "count.finalize", values);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("update");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (replay.prior) return savedResult<{ id: string; finalizedAt: string; version: number }>(replay.prior.result);
    if (count.status !== "draft") throw new CustodialError("CONFLICT", "Finalized count is immutable.");
    if (count.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The count changed; refresh and review it again.");
    const plan = await getCountRefreshPlan(tx, count);
    if (plan.added.length || plan.changed.length || plan.unavailable.some((line) => line.reviewRequired || (line.status !== "unavailable" && line.status !== "excluded"))) throw new CustodialError("CONFLICT", "Inventory sources changed; preview and reconcile the count.");
    const [profile] = await tx.select().from(custodialFormProfiles).where(eq(custodialFormProfiles.id, count.profileId));
    if (!profile || profile.family !== count.family) throw new CustodialError("CONFLICT", "The form profile is unavailable.");
    const definition = custodialProfileDefinition.safeParse(profile.definition);
    if (!definition.success) throw new CustodialError("CONFLICT", "The form profile is invalid.");
    const sheetNames = definition.data.sheets.map((sheet) => sheet.name).sort();
    if (JSON.stringify(values.reviewedSheets) !== JSON.stringify(sheetNames)) throw new CustodialError("VALIDATION", "Review all sheets before finalization.");
    const lines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, count.id));
    const sections = await tx.select().from(custodialSections).where(eq(custodialSections.formFamily, count.family));
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const selectedSections = count.sectionIds.map((id) => sectionById.get(id));
    if (selectedSections.some((section) => !section || !section.active || (section.effectiveFrom && section.effectiveFrom > count.asOfDate) || (section.effectiveUntil && section.effectiveUntil < count.asOfDate) || !definition.data.sheets.some((sheet) => sheet.name === section.sheetName && sheet.sectionLabels.includes(section.name)))) throw new CustodialError("VALIDATION", "Selected report sections must remain active, effective and included in the profile.");
    const sectionScope = selectedSections.map((section) => ({ id: section!.id, name: section!.name, sheetName: section!.sheetName, version: section!.version }));
    const quantities = new Map<string, { card: number; physical: number; shortage: number; overage: number }>();
    let shortageCents = 0n, overageCents = 0n;
    const reportLines = [];
    for (const line of lines) {
      const parsed = z.object({ cardQuantity: z.number().int().nonnegative(), unitValue: z.string().nullable(), unit: z.string().min(1), propertyNumber: z.string().nullable(), sectionId: z.string().nullable() }).passthrough().safeParse(line.snapshot);
      if (!parsed.success || line.reviewRequired || line.status === "uncounted") throw new CustodialError("VALIDATION", "Every line must be counted or resolved and reviewed.");
      const snapshot = parsed.data;
      const section = snapshot.sectionId ? sectionById.get(snapshot.sectionId) : null;
      const sheet = definition.data.sheets.find((candidate) => candidate.name === section?.sheetName);
      if (!section?.active || !sheet || !sheet.sectionLabels.includes(section.name) || (section.effectiveFrom && section.effectiveFrom > count.asOfDate) || (section.effectiveUntil && section.effectiveUntil < count.asOfDate)) throw new CustodialError("VALIDATION", "Every line requires a valid reviewed report section.");
      if (line.status !== "counted") {
        if (!line.resolution?.trim()) throw new CustodialError("VALIDATION", "Excluded or unavailable lines require a reason.");
        reportLines.push({ id: line.id, lotId: line.lotId, snapshot, importBatchId: line.importBatchId, importEvidence: line.importEvidence, section: { code: section.code, name: section.name, sheetName: section.sheetName, order: section.displayOrder }, status: line.status, reviewerNote: line.reviewerNote, resolution: line.resolution, variance: null });
        continue;
      }
      if (line.physicalQuantity === null || !line.condition || line.condition === "mixed_unresolved" || !snapshot.propertyNumber || snapshot.unitValue === null) throw new CustodialError("VALIDATION", "Counted lines require a property number, valuation and resolved condition.");
      if (line.condition === "mixed") {
        const breakdown = conditionBreakdownSchema.safeParse(line.conditionBreakdown);
        if (!breakdown.success || new Set(breakdown.data.map((part) => part.condition)).size !== breakdown.data.length || breakdown.data.reduce((total, part) => total + part.quantity, 0) !== line.physicalQuantity) throw new CustodialError("VALIDATION", "Mixed condition quantities must add up to the physical count.");
      }
      const variance = calculatePhysicalCountVariance({ cardQuantity: snapshot.cardQuantity, physicalQuantity: line.physicalQuantity, unitValue: snapshot.unitValue });
      if ((variance.quantity !== 0 || !["serviceable", "operational"].includes(line.condition) || /^0+(?:\.0+)?$/.test(snapshot.unitValue)) && !line.resolution?.trim()) throw new CustodialError("VALIDATION", "Variance, condition and zero-value cases require a review note.");
      const total = quantities.get(snapshot.unit) ?? { card: 0, physical: 0, shortage: 0, overage: 0 };
      total.card += snapshot.cardQuantity; total.physical += line.physicalQuantity;
      if (variance.quantity < 0) total.shortage += -variance.quantity; else total.overage += variance.quantity;
      if (!Object.values(total).every(Number.isSafeInteger)) throw new CustodialError("VALIDATION", "Count totals exceed the supported range.");
      quantities.set(snapshot.unit, total);
      const value = variance.value!; const negative = value.startsWith("-"); const magnitude = negative ? value.slice(1) : value; const [whole, fraction] = magnitude.split(".");
      const cents = BigInt(whole!) * 100n + BigInt(fraction!);
      if (negative) shortageCents += cents; else overageCents += cents;
      reportLines.push({ id: line.id, lotId: line.lotId, snapshot, importBatchId: line.importBatchId, importEvidence: line.importEvidence, section: { code: section.code, name: section.name, sheetName: section.sheetName, order: section.displayOrder }, status: line.status, physicalQuantity: line.physicalQuantity, condition: line.condition, conditionBreakdown: line.conditionBreakdown, remarks: line.remarks, reviewerNote: line.reviewerNote, resolution: line.resolution, variance });
    }
    reportLines.sort((a, b) => a.section.order - b.section.order || a.lotId.localeCompare(b.lotId));
    const formatCents = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
    const finalizedAt = new Date();
    const membershipExclusions = plan.omitted.map(({ omission }) => ({ lotId: omission.lotId, snapshot: omission.snapshot, reason: omission.reason, decidedBy: omission.decidedBy, decidedAt: omission.decidedAt.toISOString() }));
    const payload = { countId: count.id, code: count.code, family: count.family, asOfDate: count.asOfDate, fundCluster: count.fundCluster, office: count.office, sectionScope, metadata: count.metadata, profile: { id: profile.id, family: profile.family, version: profile.version, sourceHash: profile.sourceHash, definition: freezeProfileDefinition(definition.data, count.family) }, reviewedSheets: values.reviewedSheets, membershipExclusions, lines: reportLines, totals: { quantitiesByUnit: Object.fromEntries(quantities), shortageValue: formatCents(shortageCents), overageValue: formatCents(overageCents) } };
    const dataHash = fingerprint(payload);
    await tx.update(custodialCounts).set({ status: "finalized", finalizedBy: actor.id, finalizedAt, finalPayload: { ...payload, dataHash }, version: count.version + 1 }).where(eq(custodialCounts.id, count.id));
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.finalize", targetType: "custodial_count", targetId: count.id, after: { family: count.family, profileId: profile.id, lineCount: reportLines.length, dataHash }, correlationId: input.correlationId });
    const result = { id: count.id, version: count.version + 1, finalizedAt: finalizedAt.toISOString() };
    await saveMaster(tx, actor, input.operationId, "count.finalize", replay.hash, count.id, result);
    return result;
  });
}

/** Copy a finalized count into a linked draft; the original snapshot stays intact. */
export async function amendCustodialCount(db: Database, actor: Actor, input: { countId: string; code: string; reason: string; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  required(input.code); required(input.reason);
  const values = { countId: input.countId, code: input.code.trim(), normalizedCode: input.code.trim().toUpperCase(), reason: input.reason.trim() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const replay = await beginMaster(tx, actor, input.operationId, "count.amend", values);
    const [original] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("share");
    if (!original) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (original.status !== "finalized") throw new CustodialError("VALIDATION", "Only finalized counts can be amended.");
    if (replay.prior) {
      const [current] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Amendment is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    const [amendment] = await tx.insert(custodialCounts).values({ code: values.code, normalizedCode: values.normalizedCode, family: original.family, profileId: original.profileId, asOfDate: original.asOfDate, fundCluster: original.fundCluster, office: original.office, sectionIds: original.sectionIds, metadata: original.metadata, createdBy: actor.id, supersedesId: original.id, amendmentReason: values.reason }).returning();
    if (!amendment) throw new CustodialError("CONFLICT", "Amendment could not be created.");
    const lines = await tx.select().from(custodialCountLines).where(eq(custodialCountLines.countId, original.id));
    for (const line of lines) await tx.insert(custodialCountLines).values({ countId: amendment.id, lotId: line.lotId, snapshot: line.snapshot, sourceFingerprint: line.sourceFingerprint, importBatchId: line.importBatchId, importEvidence: line.importEvidence, status: line.status, physicalQuantity: line.physicalQuantity, condition: line.condition, conditionBreakdown: line.conditionBreakdown, remarks: line.remarks, reviewerNote: line.reviewerNote, resolution: line.status === "counted" ? null : line.resolution, reviewRequired: line.status === "counted" });
    const omissions = await tx.select().from(custodialCountOmissions).where(and(eq(custodialCountOmissions.countId, original.id), eq(custodialCountOmissions.active, true)));
    for (const omission of omissions) await tx.insert(custodialCountOmissions).values({ countId: amendment.id, lotId: omission.lotId, sourceFingerprint: omission.sourceFingerprint, snapshot: omission.snapshot, reason: omission.reason, decidedBy: omission.decidedBy, decidedAt: omission.decidedAt });
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.count.amend", targetType: "custodial_count", targetId: amendment.id, after: { supersedesId: original.id, reason: values.reason }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "count.amend", replay.hash, amendment.id, amendment);
    return amendment;
  });
}

export async function createCustodialFormProfile(db: Database, actor: Actor, input: { family: "stock_card" | "rpcsp" | "rpcppe"; effectiveFrom: string; sourceHash: string; versionNote: string; visualApproval: string; definition: CustodialProfileDefinition; operationId: string; correlationId: string }) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  const parsed = custodialProfileDefinition.safeParse(input.definition);
  const names = { stock_card: ["SC"], rpcsp: ["RPCSP_IT EQPMNTS", "RPCSP_F&F", "RPCSP_ OTHERSUPPLIES"], rpcppe: ["RPCPPE_LAND", "RPCPPE_BLDG", "RPCPPE_OTHERBLDG"] } as const;
  const expected = names[input.family];
  if (!expected || !parsed.success || parsed.data.sheets.length !== expected.length || parsed.data.sheets.some((sheet, index) => sheet.name !== expected[index])) throw new CustodialError("VALIDATION", "The profile must include the required sheets in order.");
  if (parsed.data.thresholdExample && !parsed.data.thresholdNote) throw new CustodialError("VALIDATION", "A threshold example requires a threshold note.");
  const columnCount = input.family === "stock_card" ? 7 : input.family === "rpcsp" ? 10 : 12;
  const orientation = input.family === "stock_card" ? "portrait" : "landscape";
  const signatureCount = input.family === "stock_card" ? 0 : 4;
  if (parsed.data.sheets.some((sheet) => sheet.columns.length !== columnCount || sheet.orientation !== orientation || sheet.signatures.length !== signatureCount || new Set(sheet.signatures.map((signature) => signature.role)).size !== signatureCount)) throw new CustodialError("VALIDATION", "The profile has invalid columns, orientation or signature blocks.");
  const headerFirst = input.family === "rpcsp" ? 10 : 11;
  const headerLast = input.family === "rpcppe" ? 13 : input.family === "rpcsp" ? 11 : 12;
  if (parsed.data.sheets.some((sheet) => sheet.headerRows.first !== headerFirst || sheet.headerRows.last !== headerLast || sheet.detailStartRow !== headerLast + 1 || (sheet.headerBorders && (sheet.headerBorders.length !== headerLast - headerFirst + 1 || sheet.headerBorders.some((row) => row.length !== columnCount))) || [sheet.detailBorders, ...Object.values(sheet.detailBordersBySection ?? {})].some((rule) => rule && Object.values(rule).some((row) => row.length !== columnCount)) || [...Object.keys(sheet.detailBordersBySection ?? {}), ...Object.keys(sheet.articleStylesBySection ?? {})].some((section) => !sheet.sectionLabels.includes(section)))) throw new CustodialError("VALIDATION", "The profile header rows, detail start or border dimensions do not match this form family.");
  if (parsed.data.sheets.some((sheet) => {
    const subtotals = sheet.subtotalAfterSections ?? [];
    if (new Set(sheet.sectionLabels).size !== sheet.sectionLabels.length || new Set(subtotals).size !== subtotals.length || subtotals.some((section) => !sheet.sectionLabels.includes(section))) return true;
    const placements = [...sheet.signatures.flatMap((signature) => [
      { row: signature.rowOffset, start: signature.startColumn, end: signature.endColumn },
      { row: signature.rowOffset + (signature.designationOffset ?? 1), start: signature.startColumn, end: signature.endColumn },
      ...(signature.signatureLabel ? [{ row: signature.rowOffset + (signature.labelOffset ?? 1), start: signature.startColumn, end: signature.labelEndColumn ?? signature.startColumn }] : []),
    ]), ...(sheet.signatureExtraMerges ?? []).map((range) => ({ row: range.rowOffset - 1, start: range.startColumn, end: range.endColumn }))];
    return placements.some((first, index) => first.end > columnCount || placements.slice(index + 1).some((second) => first.row === second.row && first.start <= second.end && second.start <= first.end)) || !!(sheet.thresholdNotePosition && (sheet.thresholdNotePosition.column > columnCount || placements.some((placement) => placement.row === sheet.thresholdNotePosition!.rowOffset - 1 && placement.start <= sheet.thresholdNotePosition!.column && placement.end >= sheet.thresholdNotePosition!.column)));
  })) throw new CustodialError("VALIDATION", "Profile sections or signature blocks overlap or are invalid.");
  const date = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.effectiveFrom || !/^[0-9a-f]{64}$/.test(input.sourceHash)) throw new CustodialError("VALIDATION", "A valid effective date and source hash are required.");
  required(input.versionNote); required(input.visualApproval);
  const values = { family: input.family, effectiveFrom: input.effectiveFrom, sourceHash: input.sourceHash, versionNote: input.versionNote.trim(), visualApproval: input.visualApproval.trim(), definition: parsed.data };
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const replay = await beginMaster(tx, actor, input.operationId, "profile.create", values);
    if (replay.prior) {
      const [current] = await tx.select().from(custodialFormProfiles).where(eq(custodialFormProfiles.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Profile is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.family}, 2))`);
    const [last] = await tx.select({ version: sql<number>`coalesce(max(${custodialFormProfiles.version}), 0)` }).from(custodialFormProfiles).where(eq(custodialFormProfiles.family, input.family));
    const [profile] = await tx.insert(custodialFormProfiles).values({ ...values, version: Number(last?.version ?? 0) + 1, createdBy: actor.id }).returning();
    if (!profile) throw new CustodialError("CONFLICT", "Profile could not be recorded.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.profile.create", targetType: "custodial_form_profile", targetId: profile.id, after: { family: profile.family, version: profile.version, sourceHash: profile.sourceHash }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "profile.create", replay.hash, profile.id, profile);
    return profile;
  });
}

export async function approveCustodialPropertyException(db: Database, actor: Actor, input: { fundCluster: string; propertyNumber: string; reason: string; operationId: string; correlationId: string }) {
  if ((await authorize(db, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
  for (const value of [input.fundCluster, input.propertyNumber, input.reason]) required(value);
  const values = { fundCluster: input.fundCluster.trim(), normalizedPropertyNumber: input.propertyNumber.trim().toUpperCase(), reason: input.reason.trim() };
  return db.transaction(async (tx) => {
    if ((await authorize(tx, actor)).role !== "admin") throw new CustodialError("FORBIDDEN", "This action is unavailable.");
    const replay = await beginMaster(tx, actor, input.operationId, "property.exception", values);
    await lockPropertyNumber(tx, values.fundCluster, values.normalizedPropertyNumber);
    if (replay.prior) {
      const [current] = await tx.select().from(custodialPropertyExceptions).where(eq(custodialPropertyExceptions.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Exception is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    const [existing] = await tx.select({ id: custodialLots.id }).from(custodialLots).where(and(eq(custodialLots.fundCluster, values.fundCluster), eq(custodialLots.normalizedPropertyNumber, values.normalizedPropertyNumber))).limit(1);
    if (!existing) throw new CustodialError("VALIDATION", "An exception requires an existing property number in this fund.");
    const [exception] = await tx.insert(custodialPropertyExceptions).values({ ...values, approvedBy: actor.id }).returning();
    if (!exception) throw new CustodialError("CONFLICT", "Exception could not be recorded.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.property_exception.approve", targetType: "custodial_property_exception", targetId: exception.id, after: { ...values, existingLotId: existing.id }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "property.exception", replay.hash, exception.id, exception);
    return exception;
  });
}

export async function createCustodialItem(db: Database, actor: Actor, input: { code: string; article: string; description: string; unit: string; reorderPoint: number | null; defaultSectionId?: string | null; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  for (const value of [input.code, input.article, input.description, input.unit]) required(value);
  if (input.reorderPoint !== null && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0 || input.reorderPoint > 2147483647)) throw new CustodialError("VALIDATION", "Reorder point must be a nonnegative whole number.");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const values = { code: input.code.trim(), normalizedCode: input.code.trim().toUpperCase(), article: input.article.trim(), description: input.description.trim(), unit: input.unit.trim(), reorderPoint: input.reorderPoint, defaultSectionId: input.defaultSectionId ?? null };
    const replay = await beginMaster(tx, actor, input.operationId, "item.create", { ...values, defaultSectionId: values.defaultSectionId ?? undefined });
    if (replay.prior) {
      const [current] = await tx.select().from(custodialItems).where(eq(custodialItems.id, replay.prior.targetId));
      if (!current?.active) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    if (values.defaultSectionId) {
      const [section] = await tx.select().from(custodialSections).where(eq(custodialSections.id, values.defaultSectionId));
      if (!section?.active) throw new CustodialError("VALIDATION", "The selected section is unavailable.");
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${values.normalizedCode}, 4))`);
    const [reserved] = await tx.select({ itemId: custodialItemCodes.itemId }).from(custodialItemCodes).where(eq(custodialItemCodes.normalizedCode, values.normalizedCode));
    if (reserved) throw new CustodialError("CONFLICT", "This item code is already reserved.");
    const [item] = await tx.insert(custodialItems).values(values).returning();
    if (!item) throw new CustodialError("CONFLICT", "Item could not be created.");
    await tx.insert(custodialItemCodes).values({ normalizedCode: item.normalizedCode, itemId: item.id, code: item.code });
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.item.create", targetType: "custodial_item", targetId: item.id, after: { code: item.code }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "item.create", replay.hash, item.id, item);
    return item;
  });
}

export async function updateCustodialItem(db: Database, actor: Actor, input: { itemId: string; expectedVersion: number; code: string; article: string; description: string; unit: string; reorderPoint: number | null; defaultSectionId: string | null; notes: string | null; active: boolean; reason: string; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  for (const value of [input.code, input.article, input.description, input.unit, input.reason]) required(value);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || (input.reorderPoint !== null && (!Number.isSafeInteger(input.reorderPoint) || input.reorderPoint < 0 || input.reorderPoint > 2147483647)) || (input.notes !== null && input.notes.length > 4000)) throw new CustodialError("VALIDATION", "Valid item details and version are required.");
  const values = { itemId: input.itemId, expectedVersion: input.expectedVersion, code: input.code.trim(), normalizedCode: input.code.trim().toUpperCase(), article: input.article.trim(), description: input.description.trim(), unit: input.unit.trim(), reorderPoint: input.reorderPoint, defaultSectionId: input.defaultSectionId, notes: input.notes?.trim() || null, active: input.active, reason: input.reason.trim() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const replay = await beginMaster(tx, actor, input.operationId, "item.update", values);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${values.normalizedCode}, 4))`);
    const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, input.itemId)).for("update");
    if (!item) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
    if (replay.prior) return savedResult<typeof item>(replay.prior.result);
    if (item.version !== values.expectedVersion) throw new CustodialError("CONFLICT", "Item changed; refresh and retry.");
    if (values.defaultSectionId) {
      const [section] = await tx.select().from(custodialSections).where(eq(custodialSections.id, values.defaultSectionId));
      if (!section?.active) throw new CustodialError("VALIDATION", "The selected section is unavailable.");
    }
    if (values.unit !== item.unit) {
      const [lot] = await tx.select({ id: custodialLots.id }).from(custodialLots).where(eq(custodialLots.itemId, item.id)).limit(1);
      const [balance] = await tx.select({ id: custodialBalances.id }).from(custodialBalances).where(eq(custodialBalances.itemId, item.id)).limit(1);
      if (lot || balance) throw new CustodialError("CONFLICT", "The unit cannot change after a lot or balance is created.");
    }
    if (item.active && !values.active) {
      const [bookable] = await tx.select({ id: bookableResources.id }).from(bookableResources).innerJoin(custodialLots, eq(custodialLots.id, bookableResources.lotId)).where(and(eq(custodialLots.itemId, item.id), eq(bookableResources.active, true))).limit(1);
      if (bookable) throw new CustodialError("CONFLICT", "Retire linked bookable equipment before making this item inactive.");
      const [stock] = await tx.select({ id: custodialBalances.id }).from(custodialBalances).where(and(eq(custodialBalances.itemId, item.id), sql`${custodialBalances.quantity} > 0`)).limit(1);
      if (stock) throw new CustodialError("CONFLICT", "Move or account for all stock before making this item inactive.");
    }
    if (values.normalizedCode !== item.normalizedCode) {
      const [reserved] = await tx.select({ itemId: custodialItemCodes.itemId }).from(custodialItemCodes).where(eq(custodialItemCodes.normalizedCode, values.normalizedCode));
      if (reserved) throw new CustodialError("CONFLICT", "This item code is already reserved.");
      await tx.insert(custodialItemCodes).values({ normalizedCode: values.normalizedCode, itemId: item.id, code: values.code });
    }
    const [updated] = await tx.update(custodialItems).set({ code: values.code, normalizedCode: values.normalizedCode, article: values.article, description: values.description, unit: values.unit, reorderPoint: values.reorderPoint, defaultSectionId: values.defaultSectionId, notes: values.notes, active: values.active, version: item.version + 1, updatedAt: new Date() }).where(eq(custodialItems.id, item.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Item could not be updated.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.item.update", targetType: "custodial_item", targetId: item.id, before: { code: item.code, article: item.article, description: item.description, unit: item.unit, reorderPoint: item.reorderPoint, defaultSectionId: item.defaultSectionId, notes: item.notes, active: item.active, version: item.version }, after: { code: updated.code, article: updated.article, description: updated.description, unit: updated.unit, reorderPoint: updated.reorderPoint, defaultSectionId: updated.defaultSectionId, notes: updated.notes, active: updated.active, version: updated.version, reason: values.reason }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "item.update", replay.hash, item.id, updated);
    return updated;
  });
}

export async function createCustodialLot(db: Database, actor: Actor, input: {
  itemId: string; reportingClass: "stock_card" | "semi_expendable" | "ppe";
  propertyNumber?: string | null; propertyExceptionId?: string | null; unitValue: string | null; supplier?: string | null;
  acquiredOn?: string | null; yearLabel?: string | null; fundCluster: string; office: string;
  accountableOfficer?: string | null; condition?: string | null; remarks?: string | null; operationId: string; correlationId: string;
}) {
  await authorize(db, actor);
  required(input.fundCluster); required(input.office);
  if (!["stock_card", "semi_expendable", "ppe"].includes(input.reportingClass)) throw new CustodialError("VALIDATION", "Invalid reporting class.");
  if (input.unitValue !== null && !/^\d{1,16}(?:\.\d{1,2})?$/.test(input.unitValue)) throw new CustodialError("VALIDATION", "Unit value must be a nonnegative decimal with at most two fractional digits.");
  if (input.acquiredOn) {
    const date = new Date(`${input.acquiredOn}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.acquiredOn) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.acquiredOn) throw new CustodialError("VALIDATION", "Invalid acquisition date.");
  }
  const optional = (value: string | null | undefined) => {
    const trimmed = value?.trim() || null;
    if (trimmed && trimmed.length > 1000) throw new CustodialError("VALIDATION", "Text is too long.");
    return trimmed;
  };
  const propertyNumber = optional(input.propertyNumber);
  if (input.propertyExceptionId && !propertyNumber) throw new CustodialError("VALIDATION", "An exception requires a property number.");
  const values = { itemId: input.itemId, reportingClass: input.reportingClass, propertyNumber, normalizedPropertyNumber: propertyNumber?.toUpperCase() ?? null, propertyExceptionId: input.propertyExceptionId || null, unitValue: input.unitValue, supplier: optional(input.supplier), acquiredOn: input.acquiredOn || null, yearLabel: optional(input.yearLabel), fundCluster: input.fundCluster.trim(), office: input.office.trim(), accountableOfficer: optional(input.accountableOfficer), condition: optional(input.condition), remarks: optional(input.remarks) };
  if (values.condition && !["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"].includes(values.condition)) throw new CustodialError("VALIDATION", "Choose a supported condition.");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const replay = await beginMaster(tx, actor, input.operationId, "lot.create", values);
    if (values.normalizedPropertyNumber) await lockPropertyNumber(tx, values.fundCluster, values.normalizedPropertyNumber);
    if (values.propertyExceptionId) {
      const [exception] = await tx.select().from(custodialPropertyExceptions).where(eq(custodialPropertyExceptions.id, values.propertyExceptionId));
      if (!exception || exception.fundCluster !== values.fundCluster || exception.normalizedPropertyNumber !== values.normalizedPropertyNumber) throw new CustodialError("VALIDATION", "Property-number exception does not match this fund and number.");
    }
    const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, input.itemId)).for("update");
    if (!item?.active) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
    if (replay.prior) {
      const [current] = await tx.select().from(custodialLots).where(eq(custodialLots.id, replay.prior.targetId));
      if (!current?.active) throw new CustodialError("NOT_FOUND", "Lot is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    const [lot] = await tx.insert(custodialLots).values(values).returning();
    if (!lot) throw new CustodialError("CONFLICT", "Lot could not be created.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.lot.create", targetType: "custodial_lot", targetId: lot.id, after: { itemId: lot.itemId, reportingClass: lot.reportingClass, fundCluster: lot.fundCluster }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "lot.create", replay.hash, lot.id, lot);
    return lot;
  });
}

export async function updateCustodialLot(db: Database, actor: Actor, input: { lotId: string; expectedVersion: number; propertyNumber: string | null; propertyExceptionId: string | null; unitValue: string | null; supplier: string | null; acquiredOn: string | null; yearLabel: string | null; fundCluster: string; office: string; accountableOfficer: string | null; condition: string | null; remarks: string | null; active: boolean; reason: string; operationId: string; correlationId: string }) {
  await authorize(db, actor);
  const valid = z.object({ lotId: z.uuid(), expectedVersion: z.number().int().min(0).max(2147483647), propertyNumber: z.string().trim().max(1000).nullable(), propertyExceptionId: z.uuid().nullable(), unitValue: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(), supplier: z.string().trim().max(1000).nullable(), acquiredOn: z.iso.date().nullable(), yearLabel: z.string().trim().max(1000).nullable(), fundCluster: z.string().trim().min(1).max(1000), office: z.string().trim().min(1).max(1000), accountableOfficer: z.string().trim().max(1000).nullable(), condition: z.enum(["serviceable", "unserviceable", "not_functional", "operational", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"]).nullable(), remarks: z.string().trim().max(1000).nullable(), active: z.boolean(), reason: z.string().trim().min(1).max(1000), operationId: z.uuid(), correlationId: z.string().min(1) }).strict().safeParse(input);
  if (!valid.success) throw new CustodialError("VALIDATION", "Valid lot details and version are required.");
  const clean = (value: string | null) => value?.trim() || null;
  const propertyNumber = clean(input.propertyNumber);
  if (!propertyNumber && input.propertyExceptionId) throw new CustodialError("VALIDATION", "An exception requires a property number.");
  const values = { lotId: input.lotId, expectedVersion: input.expectedVersion, propertyNumber, normalizedPropertyNumber: propertyNumber?.toUpperCase() ?? null, propertyExceptionId: input.propertyExceptionId, unitValue: input.unitValue, supplier: clean(input.supplier), acquiredOn: input.acquiredOn, yearLabel: clean(input.yearLabel), fundCluster: input.fundCluster.trim(), office: input.office.trim(), accountableOfficer: clean(input.accountableOfficer), condition: input.condition, remarks: clean(input.remarks), active: input.active, reason: input.reason.trim() };
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const replay = await beginMaster(tx, actor, input.operationId, "lot.update", values);
    if (values.normalizedPropertyNumber) await lockPropertyNumber(tx, values.fundCluster, values.normalizedPropertyNumber);
    const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, input.lotId)).for("update");
    if (!lot) throw new CustodialError("NOT_FOUND", "Lot is unavailable.");
    if (replay.prior) return savedResult<typeof lot>(replay.prior.result);
    if (lot.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "Lot changed; refresh and retry.");
    if (values.propertyExceptionId) {
      const [exception] = await tx.select().from(custodialPropertyExceptions).where(eq(custodialPropertyExceptions.id, values.propertyExceptionId));
      if (!exception || exception.fundCluster !== values.fundCluster || exception.normalizedPropertyNumber !== values.normalizedPropertyNumber) throw new CustodialError("VALIDATION", "Property-number exception does not match this fund and number.");
    }
    if (values.fundCluster !== lot.fundCluster) {
      const [balance] = await tx.select({ id: custodialBalances.id }).from(custodialBalances).where(eq(custodialBalances.lotId, lot.id)).limit(1);
      if (balance) throw new CustodialError("CONFLICT", "A lot with balances cannot change its fund cluster.");
    }
    if (lot.active && !values.active) {
      const [bookable] = await tx.select({ id: bookableResources.id }).from(bookableResources).where(and(eq(bookableResources.lotId, lot.id), eq(bookableResources.active, true))).limit(1);
      if (bookable) throw new CustodialError("CONFLICT", "Retire linked bookable equipment before making this lot inactive.");
      const [stock] = await tx.select({ id: custodialBalances.id }).from(custodialBalances).where(and(eq(custodialBalances.lotId, lot.id), sql`${custodialBalances.quantity} > 0`)).limit(1);
      if (stock) throw new CustodialError("CONFLICT", "Move or account for all stock before making this lot inactive.");
    }
    const [updated] = await tx.update(custodialLots).set({ propertyNumber: values.propertyNumber, normalizedPropertyNumber: values.normalizedPropertyNumber, propertyExceptionId: values.propertyExceptionId, unitValue: values.unitValue, supplier: values.supplier, acquiredOn: values.acquiredOn, yearLabel: values.yearLabel, fundCluster: values.fundCluster, office: values.office, accountableOfficer: values.accountableOfficer, condition: values.condition, remarks: values.remarks, active: values.active, version: lot.version + 1 }).where(eq(custodialLots.id, lot.id)).returning();
    if (!updated) throw new CustodialError("CONFLICT", "Lot could not be updated.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.lot.update", targetType: "custodial_lot", targetId: lot.id, before: { propertyNumber: lot.propertyNumber, propertyExceptionId: lot.propertyExceptionId, unitValue: lot.unitValue, supplier: lot.supplier, acquiredOn: lot.acquiredOn, yearLabel: lot.yearLabel, fundCluster: lot.fundCluster, office: lot.office, accountableOfficer: lot.accountableOfficer, condition: lot.condition, remarks: lot.remarks, active: lot.active, version: lot.version }, after: { propertyNumber: updated.propertyNumber, propertyExceptionId: updated.propertyExceptionId, unitValue: updated.unitValue, supplier: updated.supplier, acquiredOn: updated.acquiredOn, yearLabel: updated.yearLabel, fundCluster: updated.fundCluster, office: updated.office, accountableOfficer: updated.accountableOfficer, condition: updated.condition, remarks: updated.remarks, active: updated.active, version: updated.version, reason: values.reason }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "lot.update", replay.hash, lot.id, updated);
    return updated;
  });
}

export async function createCustodialBalance(db: Database, actor: Actor, input: { itemId: string; lotId?: string | null; fundCluster: string; office: string; operationId: string; correlationId: string }) {
  await authorize(db, actor); required(input.fundCluster); required(input.office);
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const values = { itemId: input.itemId, lotId: input.lotId ?? null, fundCluster: input.fundCluster.trim(), office: input.office.trim() };
    const replay = await beginMaster(tx, actor, input.operationId, "balance.create", values);
    const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, input.itemId)).for("update");
    if (!item?.active) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
    if (input.lotId) {
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, input.lotId)).for("update");
      if (!lot?.active || lot.itemId !== input.itemId || lot.fundCluster !== input.fundCluster.trim()) throw new CustodialError("NOT_FOUND", "Lot is unavailable.");
    }
    if (replay.prior) {
      const [current] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, replay.prior.targetId));
      if (!current) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
      return savedResult<typeof current>(replay.prior.result);
    }
    const [balance] = await tx.insert(custodialBalances).values(values).returning();
    if (!balance) throw new CustodialError("CONFLICT", "Balance could not be created.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.balance.create", targetType: "custodial_balance", targetId: balance.id, after: { itemId: item.id, fundCluster: balance.fundCluster, office: balance.office }, correlationId: input.correlationId });
    await saveMaster(tx, actor, input.operationId, "balance.create", replay.hash, balance.id, balance);
    return balance;
  });
}

export type CustodialItemFilters = { query?: string; reportingClass?: "stock_card" | "semi_expendable" | "ppe"; sectionId?: string; fundCluster?: string; office?: string; condition?: string; active?: boolean; acquisitionYear?: string; reorder?: boolean; outOfStock?: boolean; conditionReview?: boolean; dataQuality?: boolean };

/** Bounded item search; lot and office filters are applied before pagination. */
export async function listCustodialItems(db: Database, actor: Actor, input: { page: number; pageSize: number; filters: CustodialItemFilters }) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new CustodialError("VALIDATION", "Invalid page.");
  const parsed = z.object({ query: z.string().trim().max(200).optional(), reportingClass: z.enum(["stock_card", "semi_expendable", "ppe"]).optional(), sectionId: z.uuid().optional(), fundCluster: z.string().trim().min(1).max(1000).optional(), office: z.string().trim().min(1).max(1000).optional(), condition: z.string().trim().min(1).max(1000).optional(), active: z.boolean().optional(), acquisitionYear: z.string().regex(/^\d{4}$/).optional(), reorder: z.boolean().optional(), outOfStock: z.boolean().optional(), conditionReview: z.boolean().optional(), dataQuality: z.boolean().optional() }).strict().safeParse(input.filters);
  if (!parsed.success) throw new CustodialError("VALIDATION", "Invalid inventory filters.");
  const f = parsed.data;
  return db.transaction(async (tx) => {
    await authorizeRead(tx, actor);
    const predicates: SQL[] = [];
    if (f.query) predicates.push(sql`(strpos(lower(${custodialItems.code}), lower(${f.query})) > 0 OR strpos(lower(${custodialItems.article}), lower(${f.query})) > 0 OR strpos(lower(${custodialItems.description}), lower(${f.query})) > 0)`);
    if (f.sectionId) predicates.push(eq(custodialItems.defaultSectionId, f.sectionId));
    if (f.active !== undefined) predicates.push(eq(custodialItems.active, f.active));
    const hasScope = f.reportingClass !== undefined || f.fundCluster !== undefined || f.office !== undefined || f.condition !== undefined || f.acquisitionYear !== undefined || f.reorder !== undefined || f.outOfStock !== undefined || f.conditionReview !== undefined || f.dataQuality !== undefined;
    if (hasScope) {
      const lot: SQL[] = [sql`l.item_id = ${custodialItems.id}`];
      const standalone: SQL[] = [sql`b.item_id = ${custodialItems.id}`, sql`b.lot_id IS NULL`];
      if (f.active === true) lot.push(sql`l.active = true`);
      if (f.reportingClass) { lot.push(sql`l.reporting_class = ${f.reportingClass}`); if (f.reportingClass !== "stock_card") standalone.push(sql`false`); }
      if (f.fundCluster) { lot.push(sql`l.fund_cluster = ${f.fundCluster}`); standalone.push(sql`b.fund_cluster = ${f.fundCluster}`); }
      if (f.office) { lot.push(sql`coalesce(b.office, l.office) = ${f.office}`); standalone.push(sql`b.office = ${f.office}`); }
      if (f.condition) { lot.push(sql`l.condition = ${f.condition}`); standalone.push(sql`false`); }
      if (f.acquisitionYear) { lot.push(sql`(extract(year from l.acquired_on)::text = ${f.acquisitionYear} OR l.year_label = ${f.acquisitionYear})`); standalone.push(sql`false`); }
      if (f.reorder !== undefined) {
        const comparison = f.reorder ? sql`b.quantity <= ${custodialItems.reorderPoint}` : sql`b.quantity > ${custodialItems.reorderPoint}`;
        lot.push(sql`b.id IS NOT NULL AND ${custodialItems.reorderPoint} IS NOT NULL AND ${comparison}`);
        standalone.push(sql`${custodialItems.reorderPoint} IS NOT NULL AND ${comparison}`);
      }
      if (f.outOfStock !== undefined) { const comparison = f.outOfStock ? sql`b.quantity = 0` : sql`b.quantity > 0`; lot.push(sql`b.id IS NOT NULL AND ${comparison}`); standalone.push(comparison); }
      if (f.conditionReview !== undefined) { const comparison = sql`l.condition IN ('unserviceable', 'not_functional', 'needs_minor_repair', 'needs_major_repair', 'not_in_use', 'mixed_unresolved')`; lot.push(f.conditionReview ? comparison : sql`NOT coalesce(${comparison}, false)`); if (f.conditionReview) standalone.push(sql`false`); }
      if (f.dataQuality !== undefined) {
        const issue = sql`(l.reporting_class <> 'stock_card' AND (l.property_number IS NULL OR l.unit_value IS NULL OR l.condition IS NULL OR l.condition = 'mixed_unresolved'))`;
        lot.push(f.dataQuality ? issue : sql`NOT ${issue}`);
        if (f.dataQuality) standalone.push(sql`false`);
      }
      predicates.push(sql`(exists (select 1 from custodial_lots l left join custodial_balances b on b.lot_id = l.id where ${sql.join(lot, sql` AND `)}) OR exists (select 1 from custodial_balances b where ${sql.join(standalone, sql` AND `)}))`);
    }
    const rows = await tx.select().from(custodialItems).where(and(...predicates)).orderBy(custodialItems.code, custodialItems.id).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
    const items = rows.slice(0, input.pageSize);
    const ids = items.map((item) => item.id);
    const lots = ids.length ? await tx.select().from(custodialLots).where(inArray(custodialLots.itemId, ids)) : [];
    const balances = ids.length ? await tx.select().from(custodialBalances).where(inArray(custodialBalances.itemId, ids)) : [];
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const balanceCountByLot = new Map<string, number>();
    for (const balance of balances) if (balance.lotId) balanceCountByLot.set(balance.lotId, (balanceCountByLot.get(balance.lotId) ?? 0) + 1);
    const lotMatches = (lot: typeof custodialLots.$inferSelect) => {
      const qualityIssue = lot.reportingClass !== "stock_card" && (lot.propertyNumber === null || lot.unitValue === null || lot.condition === null || lot.condition === "mixed_unresolved");
      const needsConditionReview = lot.condition !== null && ["unserviceable", "not_functional", "needs_minor_repair", "needs_major_repair", "not_in_use", "mixed_unresolved"].includes(lot.condition);
      return (f.active !== true || lot.active) && (!f.reportingClass || lot.reportingClass === f.reportingClass) && (!f.fundCluster || lot.fundCluster === f.fundCluster) && (!f.condition || lot.condition === f.condition) && (!f.acquisitionYear || lot.acquiredOn?.startsWith(f.acquisitionYear) || lot.yearLabel === f.acquisitionYear) && (f.conditionReview === undefined || needsConditionReview === f.conditionReview) && (f.dataQuality === undefined || qualityIssue === f.dataQuality);
    };
    return { rows: items.map((item) => {
      const scopedBalances = balances.filter((balance) => {
        if (balance.itemId !== item.id || (f.fundCluster && balance.fundCluster !== f.fundCluster) || (f.office && balance.office !== f.office)) return false;
        if (balance.lotId) { const lot = lotById.get(balance.lotId); if (!lot || !lotMatches(lot)) return false; }
        else if ((f.reportingClass && f.reportingClass !== "stock_card") || f.condition || f.acquisitionYear || f.conditionReview === true || f.dataQuality === true) return false;
        return (f.outOfStock === undefined || (balance.quantity === 0) === f.outOfStock) && (f.reorder === undefined || (item.reorderPoint !== null && (balance.quantity <= item.reorderPoint) === f.reorder));
      });
      const scopedLotIds = new Set(scopedBalances.map((balance) => balance.lotId).filter((lotId): lotId is string => lotId !== null));
      const scopedLots = lots.filter((lot) => {
        if (lot.itemId !== item.id || !lotMatches(lot)) return false;
        return balanceCountByLot.has(lot.id) ? scopedLotIds.has(lot.id) : f.reorder === undefined && f.outOfStock === undefined && (!f.office || lot.office === f.office);
      });
      return { item, lots: scopedLots, balances: scopedBalances.map((balance) => ({ ...balance, reorder: item.reorderPoint !== null && balance.quantity <= item.reorderPoint })) };
    }), page: input.page, hasNext: rows.length > input.pageSize };
  });
}

/** Custodial metrics remain separate from printed-form inventory. */
export async function custodialDashboard(db: Database, actor: Actor) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const result = await tx.execute<{ low: string; out: string; unresolved: string; unserviceable: string; drafts: string; awaiting: string }>(sql`
      SELECT
        (SELECT count(*) FROM custodial_balances b JOIN custodial_items i ON i.id = b.item_id LEFT JOIN custodial_lots l ON l.id = b.lot_id WHERE i.active AND (b.lot_id IS NULL OR l.active) AND i.reorder_point IS NOT NULL AND b.quantity <= i.reorder_point)::text AS low,
        (SELECT count(*) FROM custodial_balances b JOIN custodial_items i ON i.id = b.item_id LEFT JOIN custodial_lots l ON l.id = b.lot_id WHERE i.active AND (b.lot_id IS NULL OR l.active) AND b.quantity = 0)::text AS out,
        (SELECT count(*) FROM custodial_count_lines l JOIN custodial_counts c ON c.id = l.count_id WHERE c.status = 'draft' AND l.status = 'counted' AND l.resolution IS NULL AND (l.review_required OR (jsonb_typeof(l.snapshot->'cardQuantity') = 'number' AND l.physical_quantity <> (l.snapshot->>'cardQuantity')::numeric) OR l.condition NOT IN ('serviceable', 'operational')))::text AS unresolved,
        (SELECT count(*) FROM custodial_lots l JOIN custodial_items i ON i.id = l.item_id WHERE l.active AND i.active AND l.condition IN ('unserviceable', 'not_functional', 'needs_minor_repair', 'needs_major_repair', 'not_in_use', 'mixed_unresolved'))::text AS unserviceable,
        (SELECT count(*) FROM custodial_counts WHERE status = 'draft')::text AS drafts,
        (SELECT count(*) FROM custodial_counts c WHERE c.status = 'draft' AND NOT EXISTS (SELECT 1 FROM custodial_count_lines l WHERE l.count_id = c.id AND (l.status = 'uncounted' OR l.review_required)))::text AS awaiting`);
    const metrics = result.rows[0];
    if (!metrics) throw new CustodialError("CONFLICT", "Inventory dashboard is unavailable.");
    const recent = await tx.select({ id: custodialOperations.id, type: custodialOperations.operationType, date: custodialOperations.transactionDate, reference: custodialOperations.reference, itemId: custodialItems.id, itemCode: custodialItems.code, article: custodialItems.article, office: custodialBalances.office, delta: custodialTransactions.delta }).from(custodialTransactions).innerJoin(custodialOperations, eq(custodialTransactions.operationId, custodialOperations.id)).innerJoin(custodialBalances, eq(custodialTransactions.balanceId, custodialBalances.id)).innerJoin(custodialItems, eq(custodialBalances.itemId, custodialItems.id)).where(and(eq(custodialItems.active, true), or(eq(custodialOperations.operationType, "receipt"), eq(custodialOperations.operationType, "issue")))).orderBy(desc(custodialOperations.createdAt), desc(custodialOperations.id), desc(custodialTransactions.id)).limit(5);
    return { low: Number(metrics.low), out: Number(metrics.out), unresolved: Number(metrics.unresolved), unserviceable: Number(metrics.unserviceable), drafts: Number(metrics.drafts), awaiting: Number(metrics.awaiting), recent };
  });
}

/** Read the item and its separate lot and office balances without summing scopes. */
export async function getCustodialItem(db: Database, actor: Actor, itemId: string) {
  return db.transaction(async (tx) => {
    await authorizeRead(tx, actor);
    const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, itemId));
    if (!item) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
    const lots = await tx.select().from(custodialLots).where(eq(custodialLots.itemId, itemId)).orderBy(custodialLots.createdAt, custodialLots.id);
    const balances = await tx.select().from(custodialBalances).where(eq(custodialBalances.itemId, itemId)).orderBy(custodialBalances.fundCluster, custodialBalances.office, custodialBalances.id);
    return { item, lots, balances: balances.map((balance) => ({ ...balance, reorder: item.reorderPoint !== null && balance.quantity <= item.reorderPoint })) };
  });
}

/** Read a dated card from immutable deltas; stored posting balances are not chronological facts. */
export async function getCustodialStockCard(db: Database, actor: Actor, input: { itemId: string; fundCluster: string; office?: string; asOfDate: string }) {
  await authorizeRead(db, actor, true);
  required(input.fundCluster);
  if (input.office !== undefined) required(input.office);
  const asOf = new Date(`${input.asOfDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) || Number.isNaN(asOf.valueOf()) || asOf.toISOString().slice(0, 10) !== input.asOfDate) throw new CustodialError("VALIDATION", "Invalid as-of date.");
  return db.transaction(async (tx) => {
    await authorizeRead(tx, actor, true);
    const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, input.itemId));
    if (!item) throw new CustodialError("NOT_FOUND", "Item is unavailable.");
    const rows = await tx.select({ id: custodialTransactions.id, effectiveDate: custodialOperations.transactionDate, sequence: custodialOperations.sequence, delta: custodialTransactions.delta, reference: custodialOperations.reference, type: custodialOperations.operationType, actorId: custodialOperations.actorId, office: custodialBalances.office, counterparty: custodialOperations.counterparty, daysToConsume: custodialTransactions.daysToConsume })
      .from(custodialTransactions)
      .innerJoin(custodialOperations, eq(custodialTransactions.operationId, custodialOperations.id))
      .innerJoin(custodialBalances, eq(custodialTransactions.balanceId, custodialBalances.id))
      .where(and(eq(custodialBalances.itemId, input.itemId), eq(custodialBalances.fundCluster, input.fundCluster.trim()), input.office === undefined ? undefined : eq(custodialBalances.office, input.office.trim()), sql`${custodialOperations.transactionDate} <= ${input.asOfDate}`));
    const projection = projectCustodialLedger(rows);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const entries = projection.map((entry) => { const row = rowById.get(entry.id)!; return { ...row, office: row.counterparty ?? row.office, balanceBefore: entry.balanceBefore, balanceAfter: entry.balanceAfter }; });
    return { item, fundCluster: input.fundCluster.trim(), office: input.office?.trim() ?? null, asOfDate: input.asOfDate, entries, balance: entries.at(-1)?.balanceAfter ?? 0 };
  });
}

type PreviewHistory = { balance: typeof custodialBalances.$inferSelect; delta: number; history: Array<{ id: string; effectiveDate: string; sequence: number; delta: number }> };
function backdatedPlanHash(input: PostInput, histories: PreviewHistory[]) {
  const { correlationId: _correlationId, confirmBackdated: _confirmBackdated, backdatedPreviewHash: _backdatedPreviewHash, ...intent } = input;
  return fingerprint({ intent, balances: [...histories].sort((a, b) => a.balance.id.localeCompare(b.balance.id)).map(({ balance, delta, history }) => ({ id: balance.id, version: balance.version, quantity: balance.quantity, delta, history: [...history].sort((a, b) => a.id.localeCompare(b.id)) })) });
}

/** Review the chronological effect without changing balances or ledger rows. */
export async function previewCustodialOperation(db: Database, actor: Actor, input: PostInput) {
  const valid = z.object({ balanceId: z.uuid(), destinationBalanceId: z.uuid().optional(), operationId: z.uuid(), type: z.enum(["opening", "receipt", "issue", "return", "transfer", "adjustment"]), quantity: z.number().int().min(0).max(2147483647), expectedVersion: z.number().int().min(0).max(2147483647).optional(), transactionDate: z.iso.date(), reference: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(1000), counterparty: z.string().trim().max(1000).optional(), daysToConsume: z.number().int().min(0).max(2147483647).optional(), confirmBackdated: z.boolean().optional(), backdatedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), correlationId: z.string().min(1) }).strict().safeParse(input);
  if (!valid.success || (input.quantity === 0 && input.type !== "adjustment") || (input.daysToConsume !== undefined && input.type !== "issue") || (input.type === "transfer" ? !input.destinationBalanceId || input.destinationBalanceId === input.balanceId : Boolean(input.destinationBalanceId)) || (input.type === "adjustment" && input.expectedVersion === undefined) || (["receipt", "issue", "return"].includes(input.type) && !input.counterparty?.trim())) throw new CustodialError("VALIDATION", "Valid operation details are required.");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    const balances: Array<typeof custodialBalances.$inferSelect> = [];
    for (const id of [input.balanceId, ...(input.destinationBalanceId ? [input.destinationBalanceId] : [])].sort()) {
      const [balance] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, id)).for("update");
      if (!balance) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
      balances.push(balance);
    }
    for (const itemId of [...new Set(balances.map((balance) => balance.itemId))].sort()) {
      const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, itemId)).for("update");
      if (!item?.active) throw new CustodialError("CONFLICT", "Item is inactive.");
    }
    for (const lotId of [...new Set(balances.map((balance) => balance.lotId).filter((id): id is string => id !== null))].sort()) {
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, lotId)).for("update");
      if (!lot?.active) throw new CustodialError("CONFLICT", "Lot is inactive.");
    }
    const source = balances.find((balance) => balance.id === input.balanceId)!;
    const destination = balances.find((balance) => balance.id === input.destinationBalanceId);
    if (destination && (destination.itemId !== source.itemId || destination.lotId !== source.lotId || destination.fundCluster !== source.fundCluster)) throw new CustodialError("VALIDATION", "Transfer must use the same item, lot and fund.");
    if (input.type === "adjustment" && source.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The balance changed; refresh and retry.");
    const delta = input.type === "issue" || input.type === "transfer" ? -input.quantity : input.type === "adjustment" ? input.quantity - source.quantity : input.quantity;
    if (delta === 0) throw new CustodialError("VALIDATION", "Adjustment does not change the balance.");
    const changes = [{ balance: source, delta }, ...(destination ? [{ balance: destination, delta: input.quantity }] : [])];
    const histories: PreviewHistory[] = [];
    const impacts = [];
    for (const change of changes) {
      if (change.balance.quantity + change.delta < 0 || change.balance.quantity + change.delta > 2147483647) throw new CustodialError("INSUFFICIENT_STOCK", "The resulting balance is invalid.");
      const history = await tx.select({ id: custodialTransactions.id, effectiveDate: custodialOperations.transactionDate, sequence: custodialOperations.sequence, delta: custodialTransactions.delta }).from(custodialTransactions).innerJoin(custodialOperations, eq(custodialTransactions.operationId, custodialOperations.id)).where(eq(custodialTransactions.balanceId, change.balance.id));
      if (input.type === "opening" && history.length) throw new CustodialError("CONFLICT", "Opening balance has already been established.");
      let before, after;
      try {
        before = projectCustodialLedger(history);
        after = projectCustodialLedger([...history, { id: `preview:${change.balance.id}`, effectiveDate: input.transactionDate, sequence: history.reduce((highest, entry) => Math.max(highest, entry.sequence), 0) + 1, delta: change.delta }]);
      } catch { throw new CustodialError("INSUFFICIENT_STOCK", "The chronological balance would be invalid."); }
      const beforeById = new Map(before.map((entry) => [entry.id, entry.balanceAfter]));
      impacts.push({ balanceId: change.balance.id, office: change.balance.office, currentQuantity: change.balance.quantity, resultingQuantity: change.balance.quantity + change.delta, proposed: after.find((entry) => entry.id.startsWith("preview:")), affected: after.filter((entry) => beforeById.has(entry.id) && beforeById.get(entry.id) !== entry.balanceAfter).map((entry) => ({ id: entry.id, effectiveDate: entry.effectiveDate, previousBalance: beforeById.get(entry.id), projectedBalance: entry.balanceAfter })) });
      histories.push({ ...change, history });
    }
    return { previewHash: backdatedPlanHash(input, histories), backdated: histories.some(({ history }) => history.some((entry) => entry.effectiveDate > input.transactionDate)), impacts };
  });
}

export async function postCustodialOperation(db: Database, actor: Actor, input: PostInput): Promise<Result> {
  await authorize(db, actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)) throw new CustodialError("VALIDATION", "A valid operation ID is required.");
  required(input.reference); required(input.reason);
  if (input.counterparty && input.counterparty.trim().length > 1000) throw new CustodialError("VALIDATION", "The source or office is too long.");
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0 || (input.quantity === 0 && input.type !== "adjustment") || input.quantity > 2147483647) throw new CustodialError("VALIDATION", "Quantity must be a positive whole number; adjustments may set a balance to zero.");
  if (input.daysToConsume !== undefined && (!Number.isInteger(input.daysToConsume) || input.daysToConsume < 0 || input.type !== "issue")) throw new CustodialError("VALIDATION", "Days to consume is valid only for an issue.");
  if (input.type === "transfer" && (!input.destinationBalanceId || input.destinationBalanceId === input.balanceId)) throw new CustodialError("VALIDATION", "Choose a different destination.");
  if (input.type !== "transfer" && input.destinationBalanceId) throw new CustodialError("VALIDATION", "Destination is only valid for transfers.");
  if (input.type === "adjustment" && input.expectedVersion === undefined) throw new CustodialError("VALIDATION", "Expected balance version is required.");
  const date = new Date(`${input.transactionDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.transactionDate) throw new CustodialError("VALIDATION", "Invalid transaction date.");
  const { correlationId: _correlationId, ...intent } = input;
  const intentFingerprint = createHash("sha256").update(JSON.stringify({ actorId: actor.id, ...intent, operationId: input.operationId.toLowerCase() })).digest("hex");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId.toLowerCase()}, 0))`);
    const [master] = await tx.select({ operationId: custodialMasterReplays.operationId }).from(custodialMasterReplays).where(eq(custodialMasterReplays.operationId, input.operationId));
    if (master) throw new CustodialError("CONFLICT", "Operation ID was used for a different action.");
    const [prior] = await tx.select().from(custodialOperations).where(eq(custodialOperations.operationId, input.operationId));
    if (prior) {
      if (prior.payloadFingerprint !== intentFingerprint || prior.actorId !== actor.id) throw new CustodialError("CONFLICT", "Operation ID was used for a different action.");
      // Recheck the current targets before disclosing a saved result. Future scope
      // grants must also be checked here when the custodian role is introduced.
      for (const id of [input.balanceId, ...(input.destinationBalanceId ? [input.destinationBalanceId] : [])].sort()) {
        const [target] = await tx.select({ active: custodialItems.active, lotId: custodialBalances.lotId }).from(custodialBalances)
          .innerJoin(custodialItems, eq(custodialBalances.itemId, custodialItems.id))
          .where(eq(custodialBalances.id, id));
        if (!target?.active) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
        if (target.lotId) {
          const [lot] = await tx.select({ active: custodialLots.active }).from(custodialLots).where(eq(custodialLots.id, target.lotId));
          if (!lot?.active) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
        }
      }
      return prior.result as Result;
    }
    if (["receipt", "issue", "return"].includes(input.type) && !input.counterparty?.trim()) throw new CustodialError("VALIDATION", "A source or receiving/returning office is required.");
    const ids = [input.balanceId, ...(input.destinationBalanceId ? [input.destinationBalanceId] : [])].sort();
    const balances = [];
    for (const id of ids) {
      const [row] = await tx.select().from(custodialBalances).where(eq(custodialBalances.id, id)).for("update");
      if (!row) throw new CustodialError("NOT_FOUND", "Balance is unavailable.");
      balances.push(row);
    }
    // Keep balance and item locks in stable, separate phases for transfers.
    for (const itemId of [...new Set(balances.map((row) => row.itemId))].sort()) {
      const [item] = await tx.select().from(custodialItems).where(eq(custodialItems.id, itemId)).for("update");
      if (!item?.active) throw new CustodialError("CONFLICT", "Item is inactive.");
    }
    for (const lotId of [...new Set(balances.map((row) => row.lotId).filter((id): id is string => id !== null))].sort()) {
      const [lot] = await tx.select().from(custodialLots).where(eq(custodialLots.id, lotId)).for("update");
      if (!lot?.active) throw new CustodialError("CONFLICT", "Lot is inactive.");
    }
    const source = balances.find((row) => row.id === input.balanceId)!;
    const destination = balances.find((row) => row.id === input.destinationBalanceId);
    if (destination && (destination.itemId !== source.itemId || destination.lotId !== source.lotId || destination.fundCluster !== source.fundCluster)) throw new CustodialError("VALIDATION", "Transfer must use the same item, lot and fund.");
    if (input.type === "adjustment" && source.version !== input.expectedVersion) throw new CustodialError("CONFLICT", "The balance changed; refresh and retry.");
    const delta = input.type === "issue" || input.type === "transfer" ? -input.quantity : input.type === "adjustment" ? input.quantity - source.quantity : input.quantity;
    if (delta === 0) throw new CustodialError("VALIDATION", "Adjustment does not change the balance.");
    const changes = [{ balance: source, delta }, ...(destination ? [{ balance: destination, delta: input.quantity }] : [])];
    const result: Result = { operationId: input.operationId, balances: changes.map(({ balance, delta: change }) => ({ id: balance.id, quantity: balance.quantity + change, version: balance.version + 1 })) };
    if (result.balances.some((row) => row.quantity < 0 || row.quantity > 2147483647)) throw new CustodialError("INSUFFICIENT_STOCK", "The resulting balance is invalid.");
    const [operation] = await tx.insert(custodialOperations).values({ operationId: input.operationId, actorId: actor.id, operationType: input.type, transactionDate: input.transactionDate, reference: input.reference.trim(), reason: input.reason.trim(), counterparty: input.counterparty?.trim() || null, payloadFingerprint: intentFingerprint, result }).returning();
    if (!operation) throw new CustodialError("CONFLICT", "Operation could not be recorded.");
    const histories: PreviewHistory[] = [];
    for (const { balance, delta: change } of changes) {
      const history = await tx.select({ id: custodialTransactions.id, effectiveDate: custodialOperations.transactionDate, sequence: custodialOperations.sequence, delta: custodialTransactions.delta }).from(custodialTransactions).innerJoin(custodialOperations, eq(custodialTransactions.operationId, custodialOperations.id)).where(eq(custodialTransactions.balanceId, balance.id));
      if (input.type === "opening" && history.length > 0) throw new CustodialError("CONFLICT", "Opening balance has already been established.");
      try { projectCustodialLedger([...history, { id: operation.id, effectiveDate: input.transactionDate, sequence: operation.sequence, delta: change }]); } catch { throw new CustodialError("INSUFFICIENT_STOCK", "The chronological balance would be invalid."); }
      histories.push({ balance, delta: change, history });
    }
    if (histories.some(({ history }) => history.some((row) => row.effectiveDate > input.transactionDate)) && (!input.confirmBackdated || input.backdatedPreviewHash !== backdatedPlanHash(input, histories))) throw new CustodialError("CONFLICT", "Review and confirm the current impact of the back-dated operation.");
    for (const { balance, delta: change } of changes) {
      await tx.update(custodialBalances).set({ quantity: balance.quantity + change, version: balance.version + 1 }).where(and(eq(custodialBalances.id, balance.id), eq(custodialBalances.version, balance.version)));
      await tx.insert(custodialTransactions).values({ operationId: operation.id, balanceId: balance.id, delta: change, balanceBefore: balance.quantity, balanceAfter: balance.quantity + change, daysToConsume: input.type === "issue" ? input.daysToConsume : null });
    }
    await writeAuditEntry(tx, { actorId: actor.id, action: `custodial.${input.type}`, targetType: "custodial_operation", targetId: operation.id, after: { reference: input.reference.trim(), transactionDate: input.transactionDate, balances: result.balances }, correlationId: input.correlationId });
    return result;
  });
}

let reportJobs = 0;
const reportLimit = 16 * 1024 * 1024;
function reportPayloadHash(family: "stock_card" | "rpcsp" | "rpcppe", payload: unknown) {
  if (family === "stock_card") return fingerprint(payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CustodialError("CONFLICT", "The report snapshot is invalid.");
  const { dataHash: stored, ...body } = payload as Record<string, unknown>;
  const hash = fingerprint(body);
  if (stored !== hash) throw new CustodialError("CONFLICT", "The finalized report snapshot failed verification.");
  return hash;
}
async function renderReport(family: "stock_card" | "rpcsp" | "rpcppe", payload: unknown) {
  const renderer = await import("./custodial-workbook");
  const bytes = family === "stock_card" ? await renderer.renderCustodialStockCardWorkbook(payload) : await renderer.renderCustodialCountWorkbook(payload);
  if (!bytes.length || bytes.length > reportLimit) throw new CustodialError("VALIDATION", "The generated workbook exceeds the supported size.");
  return bytes;
}
function reportFilename(family: string, code: string, asOfDate: string) {
  const safe = code.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "inventory";
  return `${family}-${safe}-${asOfDate}.xlsx`;
}

/** An audited preview of the immutable count data; no artifact is created. */
export async function previewCustodialCountReport(db: Database, actor: Actor, input: { countId: string; correlationId: string }) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("share");
    if (!count) throw new CustodialError("NOT_FOUND", "Count is unavailable.");
    if (count.status !== "finalized" || !count.finalPayload || count.family === "stock_card") throw new CustodialError("VALIDATION", "Finalize and review the count before generating a report.");
    const dataHash = reportPayloadHash(count.family, count.finalPayload);
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.report.preview", targetType: "custodial_count", targetId: count.id, after: { family: count.family, profileId: count.profileId, dataHash }, correlationId: input.correlationId });
    return { payload: count.finalPayload, dataHash, family: count.family, profileId: count.profileId };
  });
}

type StockReportScope = { itemId: string; profileId: string; fundCluster: string; office?: string | null; asOfDate: string; entity: string };
async function stockReportSnapshot(tx: AuditTransaction, actor: Actor, input: StockReportScope) {
  if (!z.iso.date().safeParse(input.asOfDate).success || !input.entity.trim() || input.entity.length > 240) throw new CustodialError("VALIDATION", "Valid card scope and entity are required.");
  const [profile] = await tx.select().from(custodialFormProfiles).where(eq(custodialFormProfiles.id, input.profileId));
  if (!profile || profile.family !== "stock_card" || profile.effectiveFrom > input.asOfDate) throw new CustodialError("VALIDATION", "A matching effective Stock Card profile is required.");
  const parsedDefinition = custodialProfileDefinition.safeParse(profile.definition);
  if (!parsedDefinition.success) throw new CustodialError("CONFLICT", "The Stock Card profile is invalid.");
  const card = await getCustodialStockCard(tx as unknown as Database, actor, { itemId: input.itemId, fundCluster: input.fundCluster, office: input.office || undefined, asOfDate: input.asOfDate });
  const payload = { entity: input.entity.trim(), fundCluster: card.fundCluster, office: card.office, asOfDate: input.asOfDate, item: { code: card.item.code, article: card.item.article, description: card.item.description, unit: card.item.unit, reorderPoint: card.item.reorderPoint }, profile: { id: profile.id, family: profile.family, version: profile.version, sourceHash: profile.sourceHash, definition: freezeProfileDefinition(parsedDefinition.data, "stock_card") }, entries: card.entries };
  return { card, profile, payload, dataHash: reportPayloadHash("stock_card", payload) };
}

export async function previewCustodialStockReport(db: Database, actor: Actor, input: StockReportScope & { correlationId: string }) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    await lockCustodialSources(tx, true);
    const snapshot = await stockReportSnapshot(tx, actor, input);
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.report.preview", targetType: "custodial_item", targetId: input.itemId, after: { family: "stock_card", profileId: snapshot.profile.id, dataHash: snapshot.dataHash, fundCluster: snapshot.card.fundCluster, office: snapshot.card.office, asOfDate: input.asOfDate, rowCount: snapshot.card.entries.length }, correlationId: input.correlationId });
    return { dataHash: snapshot.dataHash, card: snapshot.card, profileId: snapshot.profile.id };
  });
}

/** Freeze a count or dated card and save its workbook and audit together. */
export async function generateCustodialReport(db: Database, actor: Actor, input: { kind: "count"; countId: string; operationId: string; correlationId: string } | (StockReportScope & { kind: "stock_card"; expectedDataHash: string; operationId: string; correlationId: string })) {
  await authorize(db, actor);
  if (reportJobs >= 2) throw new CustodialError("RATE_LIMITED", "Report generation is busy; retry later.");
  reportJobs++;
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor);
      if (input.kind === "stock_card") await lockCustodialSources(tx, true);
      const { correlationId: _correlationId, ...intent } = input;
      const replay = await beginMaster(tx, actor, input.operationId, "report.generate", intent);
      if (replay.prior) {
        const [saved] = await tx.select({ id: custodialReportExports.id, checksum: custodialReportExports.checksum, filename: custodialReportExports.filename, dataHash: custodialReportExports.dataHash }).from(custodialReportExports).where(eq(custodialReportExports.id, replay.prior.targetId));
        if (!saved) throw new CustodialError("NOT_FOUND", "Report is unavailable.");
        return saved;
      }
      let family: "stock_card" | "rpcsp" | "rpcppe", profileId: string, asOfDate: string, fundCluster: string, office: string | null, itemId: string | null, countId: string | null, payload: unknown, code: string, rowCount: number;
      if (input.kind === "count") {
        const [count] = await tx.select().from(custodialCounts).where(eq(custodialCounts.id, input.countId)).for("share");
        if (!count || count.family === "stock_card") throw new CustodialError("NOT_FOUND", "Count is unavailable.");
        if (count.status !== "finalized" || !count.finalPayload) throw new CustodialError("VALIDATION", "Finalize the count before generating a report.");
        family = count.family; profileId = count.profileId; asOfDate = count.asOfDate; fundCluster = count.fundCluster; office = count.office; countId = count.id; itemId = null; payload = count.finalPayload; code = count.code;
        const lines = z.object({ lines: z.array(z.object({ status: z.string() })) }).safeParse(payload);
        if (!lines.success) throw new CustodialError("CONFLICT", "The report snapshot is invalid.");
        rowCount = lines.data.lines.filter((line) => line.status === "counted").length;
      } else {
        if (!/^[0-9a-f]{64}$/.test(input.expectedDataHash)) throw new CustodialError("VALIDATION", "Review the current Stock Card before generating a report.");
        const { card, profile, payload: snapshot, dataHash: currentHash } = await stockReportSnapshot(tx, actor, input);
        if (currentHash !== input.expectedDataHash) throw new CustodialError("CONFLICT", "Stock Card data changed; preview it again.");
        family = "stock_card"; profileId = profile.id; asOfDate = input.asOfDate; fundCluster = card.fundCluster; office = card.office; itemId = card.item.id; countId = null; code = card.item.code; rowCount = card.entries.length;
        payload = snapshot;
      }
      const dataHash = reportPayloadHash(family, payload);
      const bytes = await renderReport(family, payload);
      const checksum = createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
      const filename = reportFilename(family, code, asOfDate);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [entry] = await tx.insert(custodialReportExports).values({ family, countId, itemId, profileId, asOfDate, fundCluster, office, payload, dataHash, checksum, filename, rowCount, artifactBase64: bytes.toString("base64"), expiresAt, createdBy: actor.id }).returning({ id: custodialReportExports.id });
      if (!entry) throw new CustodialError("CONFLICT", "The report could not be saved.");
      await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.report.generate", targetType: "custodial_report_export", targetId: entry.id, after: { family, countId, itemId, profileId, dataHash, checksum, rowCount, expiresAt: expiresAt.toISOString() }, correlationId: input.correlationId });
      const result = { id: entry.id, checksum, filename, dataHash };
      await saveMaster(tx, actor, input.operationId, "report.generate", replay.hash, entry.id, result);
      return result;
    });
  } finally { reportJobs--; }
}

export async function listCustodialReportExports(db: Database, actor: Actor, input: { page: number; pageSize: number }) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new CustodialError("VALIDATION", "Invalid page.");
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const rows = await tx.select({ id: custodialReportExports.id, family: custodialReportExports.family, countId: custodialReportExports.countId, itemId: custodialReportExports.itemId, profileId: custodialReportExports.profileId, asOfDate: custodialReportExports.asOfDate, fundCluster: custodialReportExports.fundCluster, office: custodialReportExports.office, dataHash: custodialReportExports.dataHash, checksum: custodialReportExports.checksum, filename: custodialReportExports.filename, rowCount: custodialReportExports.rowCount, expiresAt: custodialReportExports.expiresAt, createdAt: custodialReportExports.createdAt }).from(custodialReportExports).orderBy(desc(custodialReportExports.createdAt), desc(custodialReportExports.id)).limit(input.pageSize + 1).offset((input.page - 1) * input.pageSize);
    return { rows: rows.slice(0, input.pageSize), page: input.page, hasNext: rows.length > input.pageSize };
  });
}

export async function getCustodialReportExport(db: Database, actor: Actor, exportId: string, correlationId: string) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const [entry] = await tx.select().from(custodialReportExports).where(eq(custodialReportExports.id, exportId)).for("share");
    if (!entry) throw new CustodialError("NOT_FOUND", "Report is unavailable.");
    if (reportPayloadHash(entry.family, entry.payload) !== entry.dataHash) throw new CustodialError("CONFLICT", "The report snapshot failed verification.");
    await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.report.preview", targetType: "custodial_report_export", targetId: entry.id, after: { family: entry.family, profileId: entry.profileId, dataHash: entry.dataHash }, correlationId });
    return { id: entry.id, family: entry.family, filename: entry.filename, dataHash: entry.dataHash, checksum: entry.checksum, payload: entry.payload, expiresAt: entry.expiresAt };
  });
}

export async function downloadCustodialReport(db: Database, actor: Actor, exportId: string, correlationId: string) {
  await authorize(db, actor);
  if (reportJobs >= 2) throw new CustodialError("RATE_LIMITED", "Report generation is busy; retry later.");
  reportJobs++;
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor);
      const [entry] = await tx.select().from(custodialReportExports).where(eq(custodialReportExports.id, exportId)).for("share");
      if (!entry) throw new CustodialError("NOT_FOUND", "Report is unavailable.");
      if (reportPayloadHash(entry.family, entry.payload) !== entry.dataHash) throw new CustodialError("CONFLICT", "The report snapshot failed verification.");
      const retained = Boolean(entry.artifactBase64 && entry.expiresAt > new Date());
      const bytes = retained ? Buffer.from(entry.artifactBase64!, "base64") : await renderReport(entry.family, entry.payload);
      const checksum = createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
      if (retained && checksum !== entry.checksum) throw new CustodialError("CONFLICT", "The retained workbook failed verification.");
      await writeAuditEntry(tx, { actorId: actor.id, action: "custodial.report.download", targetType: "custodial_report_export", targetId: entry.id, after: { family: entry.family, profileId: entry.profileId, checksum, regenerated: !retained }, correlationId });
      return { bytes, filename: entry.filename, checksum, regenerated: !retained };
    });
  } finally { reportJobs--; }
}

export async function purgeExpiredCustodialReports(db: Database) {
  return db.transaction(async (tx) => {
    const expired = await tx.select({ id: custodialReportExports.id }).from(custodialReportExports).where(and(lte(custodialReportExports.expiresAt, new Date()), isNotNull(custodialReportExports.artifactBase64))).limit(100).for("update", { skipLocked: true });
    for (const entry of expired) await tx.update(custodialReportExports).set({ artifactBase64: null }).where(eq(custodialReportExports.id, entry.id));
    return expired.length;
  });
}
