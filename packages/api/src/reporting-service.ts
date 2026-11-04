import { writeAuditEntry } from "@matms/db";
import type { AuditTransaction, Database } from "@matms/db";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ArchiveActor } from "./archive-service";
import { MatmsError } from "./errors";

export const EXPORT_ROW_LIMIT = 5000;
export const reportKinds = ["box_folders", "documents", "balances", "ledger", "loans", "requests", "movements"] as const;
export type ReportKind = (typeof reportKinds)[number];
export type ReportFilters = {
  query?: string;
  kind?: "box" | "folder" | "document" | "inventory" | "template";
  categoryId?: string;
  shelfId?: string;
  lifecycle?: "active" | "archived" | "retired";
  recordLifecycle?: "active" | "archived" | "retired";
  folderLifecycle?: "active" | "archived" | "retired";
  confidentiality?: "internal" | "restricted";
  stockStatus?: "out" | "low" | "in";
  revisionStatus?: "active" | "superseded" | "retired";
  requestStatus?: "draft" | "submitted" | "approved" | "rejected" | "cancelled" | "in_progress" | "completed";
  loanStatus?: "active" | "overdue" | "closed";
  from?: string;
  to?: string;
};
export type ReportRow = {
  id: string; kind: string; code: string; title: string; location: string; status: string;
  occurred_at: string | Date | null; details: Record<string, unknown>;
};

type QueryDb = Pick<Database, "execute">;

/** Every downstream query starts from the same authorized hierarchy. */
function scopedCtes(actor: ArchiveActor): SQL {
  const boxAccess = actor.role === "admin" ? sql`TRUE` : sql`(b.confidentiality = 'internal' OR EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = ${actor.id} AND g.active AND g.box_id = b.id))`;
  const folderAccess = actor.role === "admin" ? sql`TRUE` : sql`(f.confidentiality = 'internal' OR EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = ${actor.id} AND g.active AND g.folder_id = f.id))`;
  const documentAccess = actor.role === "admin" ? sql`TRUE` : sql`(d.confidentiality = 'internal' OR EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = ${actor.id} AND g.active AND g.document_id = d.id))`;
  return sql`WITH visible_boxes AS NOT MATERIALIZED (
    SELECT b.*, s.label AS shelf_label, c.name AS category_name FROM boxes b
    JOIN shelf_locations s ON s.id = b.shelf_location_id JOIN categories c ON c.id = b.category_id WHERE ${boxAccess}
  ), visible_folders AS NOT MATERIALIZED (
    SELECT f.*, b.code AS box_code, b.lifecycle AS box_lifecycle, b.category_id, b.shelf_location_id, b.shelf_label, b.category_name,
      CASE WHEN b.confidentiality = 'restricted' OR f.confidentiality = 'restricted' THEN 'restricted' ELSE 'internal' END AS effective_confidentiality
    FROM folders f JOIN visible_boxes b ON b.id = f.box_id WHERE ${folderAccess}
  ), visible_documents AS NOT MATERIALIZED (
    SELECT d.*, f.code AS folder_code, f.name AS folder_name, f.lifecycle AS folder_lifecycle, f.box_id, f.box_code, f.box_lifecycle, f.category_id, f.shelf_location_id, f.shelf_label, f.category_name,
      CASE WHEN f.effective_confidentiality = 'restricted' OR d.confidentiality = 'restricted' THEN 'restricted' ELSE 'internal' END AS effective_confidentiality,
      CASE WHEN EXISTS (SELECT 1 FROM document_checkouts co WHERE co.document_id = d.id AND (co.returned_at IS NULL OR (co.resolved_at IS NULL AND co.exception IS NOT NULL))) THEN 'unavailable' ELSE 'available' END AS availability
    FROM documents d JOIN visible_folders f ON f.id = d.folder_id WHERE ${documentAccess}
  ), visible_inventory AS NOT MATERIALIZED (
    SELECT i.*, t.code AS template_code, t.name AS template_name, t.status AS revision_status,
      f.code AS folder_code, f.name AS folder_name, f.lifecycle AS folder_lifecycle, f.box_id, f.box_code, f.box_lifecycle, f.category_id, f.shelf_location_id, f.shelf_label, f.effective_confidentiality AS folder_confidentiality,
      CASE WHEN i.count = 0 THEN 'out' WHEN i.count <= i.threshold THEN 'low' ELSE 'in' END AS stock_status
    FROM template_inventory i JOIN templates t ON t.id = i.template_id JOIN visible_folders f ON f.id = i.folder_id
  ), visible_requests AS NOT MATERIALIZED (
    SELECT r.* FROM document_requests r WHERE EXISTS (SELECT 1 FROM request_items x WHERE x.request_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM request_items x WHERE x.request_id = r.id AND NOT EXISTS (SELECT 1 FROM visible_documents d WHERE d.id = x.document_id))
  ), visible_loans AS NOT MATERIALIZED (
    SELECT co.*, d.code AS document_code, d.title AS document_title, d.folder_code, d.box_code, d.box_lifecycle, d.category_id, d.shelf_location_id, d.shelf_label, d.effective_confidentiality AS document_confidentiality, r.status AS request_status
    FROM document_checkouts co JOIN visible_documents d ON d.id = co.document_id
    JOIN request_items ri ON ri.id = co.request_item_id JOIN visible_requests r ON r.id = ri.request_id
  )`;
}

function filtersSql(filters: ReportFilters): SQL {
  const parts: SQL[] = [];
  if (filters.query?.trim()) {
    const escaped = filters.query.trim().replace(/[\\%_]/g, "\\$&");
    parts.push(sql`r.search_text ILIKE ${`%${escaped}%`}`);
  }
  if (filters.kind) parts.push(sql`r.kind = ${filters.kind}`);
  if (filters.categoryId) parts.push(sql`r.category_id = ${filters.categoryId}::uuid`);
  if (filters.shelfId) parts.push(sql`r.shelf_location_id = ${filters.shelfId}::uuid`);
  if (filters.lifecycle) parts.push(sql`(r.box_lifecycle = ${filters.lifecycle} OR (r.kind = 'template' AND ${filters.lifecycle} = 'active' AND r.status = 'active'))`);
  if (filters.recordLifecycle) parts.push(sql`CASE WHEN r.kind = 'document' THEN r.details->>'lifecycle' WHEN r.kind = 'inventory' THEN r.details->>'folderLifecycle' WHEN r.kind IN ('folder', 'box') THEN r.status ELSE NULL END = ${filters.recordLifecycle}`);
  if (filters.folderLifecycle) parts.push(sql`r.details->>'folderLifecycle' = ${filters.folderLifecycle}`);
  if (filters.confidentiality) parts.push(sql`r.confidentiality = ${filters.confidentiality}`);
  if (filters.stockStatus) parts.push(sql`r.stock_status = ${filters.stockStatus}`);
  if (filters.revisionStatus) parts.push(sql`r.revision_status = ${filters.revisionStatus}`);
  if (filters.requestStatus) parts.push(sql`r.request_status = ${filters.requestStatus}`);
  if (filters.loanStatus) parts.push(sql`r.kind = 'loan' AND r.status = ${filters.loanStatus}`);
  if (filters.from) parts.push(sql`r.occurred_at >= ${`${filters.from}T00:00:00+08:00`}::timestamptz`);
  if (filters.to) parts.push(sql`r.occurred_at < (${`${filters.to}T00:00:00+08:00`}::timestamptz + interval '1 day')`);
  return parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

function reportRows(kind: ReportKind | "search" | "box_only" | "folder_only", actor: ArchiveActor, documentId?: SQL, templateCatalog = false): SQL {
  const noFields = sql`NULL::text AS stock_status, NULL::text AS revision_status, NULL::text AS request_status`;
  const boxRows = sql`SELECT b.id::text AS id, 'box'::text AS kind, b.code, b.category_name AS title, b.shelf_label AS location, b.lifecycle::text AS status,
      b.created_at AS occurred_at, b.category_id, b.shelf_location_id, b.lifecycle::text AS box_lifecycle, b.confidentiality::text AS confidentiality,
      ${noFields}, concat_ws(' ', b.code, b.category_name, b.shelf_label) AS search_text, '{}'::jsonb AS details FROM visible_boxes b ${documentId ? sql`WHERE b.id = ${documentId}` : sql``}`;
  const folderRows = sql`SELECT f.id::text AS id, 'folder'::text AS kind, f.code, f.name AS title, concat_ws(' / ', f.shelf_label, f.box_code) AS location, f.lifecycle::text AS status,
      f.created_at AS occurred_at, f.category_id, f.shelf_location_id, f.box_lifecycle::text, f.effective_confidentiality::text AS confidentiality, ${noFields},
      concat_ws(' ', f.code, f.name, f.box_code) AS search_text, '{}'::jsonb AS details FROM visible_folders f ${documentId ? sql`WHERE f.id = ${documentId}` : sql``}`;
  const documentRows = sql`SELECT d.id::text AS id, 'document'::text AS kind, d.code, d.title, concat_ws(' / ', d.shelf_label, d.box_code, d.folder_code) AS location, d.availability AS status,
      CASE WHEN pg_input_is_valid(d.document_date, 'date') THEN d.document_date::date::timestamptz ELSE d.created_at END AS occurred_at, d.category_id, d.shelf_location_id, d.box_lifecycle::text, d.effective_confidentiality::text AS confidentiality, ${noFields},
      concat_ws(' ', d.code, d.title, d.folder_name, d.folder_code, d.keywords) AS search_text, jsonb_build_object('lifecycle', d.lifecycle, 'folderLifecycle', d.folder_lifecycle, 'date', d.document_date) AS details FROM visible_documents d ${documentId ? sql`WHERE d.id = ${documentId}` : sql``}`;
  const balanceRows = sql`SELECT i.id::text AS id, 'inventory'::text AS kind, i.template_code AS code, i.template_name AS title, concat_ws(' / ', i.shelf_label, i.box_code, i.folder_code) AS location, i.stock_status AS status,
      i.created_at AS occurred_at, i.category_id, i.shelf_location_id, i.box_lifecycle::text, i.folder_confidentiality::text AS confidentiality, i.stock_status, i.revision_status::text, NULL::text AS request_status,
      concat_ws(' ', i.template_code, i.template_name, i.folder_name, i.folder_code) AS search_text, jsonb_build_object('count', i.count, 'threshold', i.threshold, 'revisionStatus', i.revision_status, 'templateId', i.template_id, 'folderLifecycle', i.folder_lifecycle) AS details FROM visible_inventory i ${documentId ? sql`WHERE i.id = ${documentId}` : sql``}`;
  const unstockedTemplates = actor.role === "admin" || templateCatalog ? sql`UNION ALL SELECT t.id::text AS id, 'template'::text AS kind, t.code, t.name AS title, ''::text AS location, t.status::text AS status,
      t.created_at AS occurred_at, t.category_id, NULL::uuid AS shelf_location_id, NULL::text AS box_lifecycle, NULL::text AS confidentiality, NULL::text AS stock_status, t.status::text AS revision_status, NULL::text AS request_status,
      concat_ws(' ', t.code, t.name, t.family_code) AS search_text, '{}'::jsonb AS details FROM templates t WHERE ${templateCatalog ? actor.role === "admin" ? sql`TRUE` : sql`EXISTS (SELECT 1 FROM visible_inventory i WHERE i.template_id = t.id)` : sql`NOT EXISTS (SELECT 1 FROM template_inventory i WHERE i.template_id = t.id)`}` : sql``;
  if (kind === "search") return sql`${boxRows} UNION ALL ${folderRows} UNION ALL ${documentRows} UNION ALL ${balanceRows} ${unstockedTemplates}`;
  if (kind === "box_folders") return sql`${boxRows} UNION ALL ${folderRows}`;
  if (kind === "box_only") return boxRows;
  if (kind === "folder_only") return folderRows;
  if (kind === "documents") return documentRows;
  if (kind === "balances") return balanceRows;
  if (kind === "ledger") return sql`SELECT st.id::text AS id, 'ledger'::text AS kind, i.template_code AS code, i.template_name AS title, concat_ws(' / ', i.shelf_label, i.box_code, i.folder_code) AS location, op.operation_type::text AS status,
      st.created_at AS occurred_at, i.category_id, i.shelf_location_id, i.box_lifecycle::text, i.folder_confidentiality::text AS confidentiality, i.stock_status, i.revision_status::text, NULL::text AS request_status,
      concat_ws(' ', i.template_code, i.template_name, i.folder_code) AS search_text, jsonb_build_object('delta', st.delta, 'before', st.balance_before, 'after', st.balance_after, 'actor', u.name, 'reason', op.reason, 'reference', op.reference, 'operationId', op.operation_id) AS details
    FROM stock_transactions st JOIN stock_operations op ON op.id = st.stock_operation_id JOIN visible_inventory i ON i.id = st.inventory_id JOIN "user" u ON u.id = op.actor_id`;
  if (kind === "loans") return sql`SELECT l.id::text AS id, 'loan'::text AS kind, l.document_code AS code, l.document_title AS title, concat_ws(' / ', l.shelf_label, l.box_code, l.folder_code) AS location,
      CASE WHEN l.resolved_at IS NULL AND (l.returned_at IS NULL OR l.exception IS NOT NULL) AND l.due_at < now() THEN 'overdue' WHEN l.resolved_at IS NULL AND (l.returned_at IS NULL OR l.exception IS NOT NULL) THEN 'active' ELSE 'closed' END AS status,
      l.released_at AS occurred_at, l.category_id, l.shelf_location_id, l.box_lifecycle::text, l.document_confidentiality::text AS confidentiality, NULL::text AS stock_status, NULL::text AS revision_status, l.request_status::text,
      concat_ws(' ', l.document_code, l.document_title) AS search_text, jsonb_build_object('recipient', l.recipient, 'dueAt', l.due_at, 'returnedAt', l.returned_at, 'exception', l.exception) AS details FROM visible_loans l`;
  if (kind === "requests") return sql`SELECT ri.id::text AS id, 'request'::text AS kind, q.code, q.requester_name AS title, concat_ws(' / ', d.shelf_label, d.box_code, d.folder_code) AS location, q.status::text AS status,
      q.created_at AS occurred_at, d.category_id, d.shelf_location_id, d.box_lifecycle::text, d.effective_confidentiality::text AS confidentiality, NULL::text AS stock_status, NULL::text AS revision_status, q.status::text AS request_status,
      concat_ws(' ', q.code, q.requester_name, q.purpose, d.code, d.title) AS search_text, jsonb_build_object('kind', q.kind, 'purpose', q.purpose, 'documentCode', d.code, 'lineStatus', ri.status) AS details
      FROM visible_requests q JOIN request_items ri ON ri.request_id = q.id JOIN visible_documents d ON d.id = ri.document_id`;
  return sql`SELECT m.id::text AS id, 'movement'::text AS kind, COALESCE(d.code, f.code, b.code) AS code, COALESCE(d.title, f.name, b.category_name) AS title,
      COALESCE(d.shelf_label, f.shelf_label, b.shelf_label) AS location, 'moved'::text AS status, m.occurred_at,
      COALESCE(d.category_id, f.category_id, b.category_id) AS category_id, COALESCE(d.shelf_location_id, f.shelf_location_id, b.shelf_location_id) AS shelf_location_id,
      COALESCE(d.box_lifecycle::text, f.box_lifecycle::text, b.lifecycle::text) AS box_lifecycle, COALESCE(d.effective_confidentiality::text, f.effective_confidentiality::text, b.confidentiality::text) AS confidentiality,
      ${noFields}, concat_ws(' ', d.code, d.title, f.code, f.name, b.code) AS search_text,
      CASE WHEN ${actor.role === "admin" ? sql`TRUE` : sql`(NOT (m.source ? 'folderId') OR EXISTS (SELECT 1 FROM visible_folders sf WHERE sf.id::text = m.source->>'folderId')) AND (NOT (m.destination ? 'folderId') OR EXISTS (SELECT 1 FROM visible_folders df WHERE df.id::text = m.destination->>'folderId')) AND (NOT (m.source ? 'boxId') OR EXISTS (SELECT 1 FROM visible_boxes sb WHERE sb.id::text = m.source->>'boxId')) AND (NOT (m.destination ? 'boxId') OR EXISTS (SELECT 1 FROM visible_boxes db WHERE db.id::text = m.destination->>'boxId'))`}
      THEN jsonb_build_object('source', m.source, 'destination', m.destination, 'reason', m.reason, 'actor', mu.name)
      ELSE jsonb_build_object('actor', mu.name, 'reason', 'Movement recorded; related location unavailable') END AS details
    FROM movement_events m JOIN "user" mu ON mu.id = m.actor_id LEFT JOIN visible_documents d ON d.id = m.document_id LEFT JOIN visible_folders f ON f.id = m.folder_id LEFT JOIN visible_boxes b ON b.id = m.box_id
    WHERE d.id IS NOT NULL OR f.id IS NOT NULL OR b.id IS NOT NULL`;
}

export function buildReportQuery(actor: ArchiveActor, kind: ReportKind | "search", filters: ReportFilters, page = 1, pageSize = 25, includeScope = true): SQL {
  if (actor.role === "viewer" && kind !== "search" && kind !== "box_folders" && kind !== "documents" && kind !== "balances") throw new MatmsError("FORBIDDEN", "This report is unavailable.").toORPCError();
  if (kind === "search" && !filters.kind) {
    const branches = (["box", "folder", "document", "inventory", "template"] as const).map((recordKind) => sql`(${buildReportQuery(actor, "search", { ...filters, kind: recordKind }, 1, page * pageSize, false)})`);
    return sql`${scopedCtes(actor)} SELECT r.* FROM (${sql.join(branches, sql` UNION ALL `)}) r ORDER BY lower(r.code) COLLATE "C", r.kind, r.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;
  }
  // Select a domain branch before building the search union. In particular,
  // document-only queries must not plan every operational report branch.
  const rows = reportRows(kind === "search" && filters.kind === "document" ? "documents" : kind === "search" && filters.kind === "inventory" ? "balances" : kind === "search" && (filters.kind === "box" || filters.kind === "folder") ? "box_folders" : kind, actor, undefined, filters.kind === "template");
  const where = filtersSql(filters);
  const prefix = includeScope ? sql`${scopedCtes(actor)},` : sql`WITH`;
  if (kind === "search" && filters.kind === "inventory") {
    return sql`${prefix} candidate_page AS MATERIALIZED (
      SELECT ordered.id, t.code FROM templates t CROSS JOIN LATERAL (
        SELECT ordered_inventory.id FROM template_inventory ordered_inventory WHERE ordered_inventory.template_id = t.id
        AND EXISTS (SELECT 1 FROM (${reportRows("balances", actor, sql`ordered_inventory.id`)} OFFSET 0) r ${where})
        ORDER BY ordered_inventory.id::text LIMIT ${page * pageSize + 1}
      ) ordered ORDER BY lower(t.code) COLLATE "C", ordered.id::text LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}
    ) SELECT r.id, r.kind, r.code, r.title, r.location, r.status, r.occurred_at, r.details
      FROM candidate_page p CROSS JOIN LATERAL (${reportRows("balances", actor, sql`p.id`)} OFFSET 0) r
      ORDER BY lower(r.code) COLLATE "C", r.kind, r.id`;
  }
  if (kind === "search" && (filters.kind === "document" || filters.kind === "box" || filters.kind === "folder")) {
    const table = filters.kind === "document" ? sql`documents` : filters.kind === "box" ? sql`boxes` : sql`folders`;
    const domain = filters.kind === "document" ? "documents" : filters.kind === "box" ? "box_only" : "folder_only";
    // Walk the code-order index, checking complete scope and filters for each
    // candidate before LIMIT. OFFSET 0 retains the correlated PK lookup and
    // avoids a join/sort of every matching document for a broad search term.
    return sql`${prefix} candidate_page AS MATERIALIZED (
      SELECT ordered.id, ordered.code FROM ${table} ordered
      WHERE EXISTS (SELECT 1 FROM (${reportRows(domain, actor, sql`ordered.id`)} OFFSET 0) r ${where})
      ORDER BY lower(ordered.code) COLLATE "C", ordered.id::text LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}
    ) SELECT r.id, r.kind, r.code, r.title, r.location, r.status, r.occurred_at, r.details
      FROM candidate_page p CROSS JOIN LATERAL (${reportRows(domain, actor, sql`p.id`)} OFFSET 0) r ${filters.kind === "document" ? sql`` : sql`WHERE r.kind = ${filters.kind}`}
      ORDER BY lower(r.code) COLLATE "C", r.kind, r.id`;
  }
  return sql`${prefix} report_rows AS (${rows})
    SELECT r.id, r.kind, r.code, r.title, r.location, r.status, r.occurred_at, r.details FROM report_rows r ${where}
    ORDER BY lower(r.code) COLLATE "C", r.kind, r.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;
}

export async function queryReport(db: QueryDb, actor: ArchiveActor, kind: ReportKind | "search", filters: ReportFilters, page = 1, pageSize = 25) {
  const result = await db.execute<ReportRow>(buildReportQuery(actor, kind, filters, page, pageSize));
  return { rows: result.rows.slice(0, pageSize), hasMore: result.rows.length > pageSize };
}

export async function dashboard(db: QueryDb, actor: ArchiveActor) {
  const result = await db.execute<{ boxes: string; folders: string; documents: string; low: string; out: string; requests: string; loans: string; overdue: string }>(sql`${scopedCtes(actor)}
    SELECT (SELECT count(*) FROM visible_boxes WHERE lifecycle = 'active')::text AS boxes,
      (SELECT count(*) FROM visible_folders WHERE lifecycle = 'active' AND box_lifecycle = 'active')::text AS folders,
      (SELECT count(*) FROM visible_documents WHERE lifecycle = 'active' AND folder_lifecycle = 'active' AND box_lifecycle = 'active')::text AS documents,
      (SELECT count(*) FROM visible_inventory WHERE stock_status = 'low' AND folder_lifecycle = 'active' AND box_lifecycle = 'active')::text AS low,
      (SELECT count(*) FROM visible_inventory WHERE stock_status = 'out' AND folder_lifecycle = 'active' AND box_lifecycle = 'active')::text AS out,
      ${actor.role === "viewer" ? sql`'0'` : sql`(SELECT count(*)::text FROM visible_requests WHERE status = 'submitted')`} AS requests,
      ${actor.role === "viewer" ? sql`'0'` : sql`(SELECT count(*)::text FROM visible_loans WHERE resolved_at IS NULL AND (returned_at IS NULL OR exception IS NOT NULL))`} AS loans,
      ${actor.role === "viewer" ? sql`'0'` : sql`(SELECT count(*)::text FROM visible_loans WHERE resolved_at IS NULL AND (returned_at IS NULL OR exception IS NOT NULL) AND due_at < now())`} AS overdue`);
  const row = result.rows[0];
  if (!row) throw new MatmsError("INTERNAL_ERROR", "Dashboard is unavailable.").toORPCError();
  const counts = { boxes: Number(row.boxes), folders: Number(row.folders), documents: Number(row.documents), low: Number(row.low), out: Number(row.out) };
  if (actor.role === "viewer") return { counts, operations: null, recent: [] as ReportRow[] };
  const activity = await db.execute<ReportRow>(sql`${scopedCtes(actor)}, report_rows AS (${reportRows("movements", actor)} UNION ALL ${reportRows("ledger", actor)} UNION ALL ${reportRows("loans", actor)}) SELECT r.id, r.kind, r.code, r.title, r.location, r.status, r.occurred_at, r.details FROM report_rows r ORDER BY r.occurred_at DESC, r.kind, r.id DESC LIMIT 5`);
  return { counts, operations: { requests: Number(row.requests), loans: Number(row.loans), overdue: Number(row.overdue) }, recent: activity.rows };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let cell = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && (/^[\t\r\n]/.test(cell) || /^[\s]*[=+\-@]/.test(cell))) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

export async function exportReport(db: Database, actor: ArchiveActor, kind: ReportKind, filters: ReportFilters, correlationId: string) {
  if (actor.role === "viewer") throw new MatmsError("FORBIDDEN", "Export is unavailable.").toORPCError();
  await db.transaction(async (tx: AuditTransaction) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`report-export:${actor.id}`}, 0))`);
    const rate = await tx.execute<{ total: string }>(sql`SELECT count(*)::text AS total FROM audit_logs WHERE actor_id = ${actor.id} AND action = 'report.export_attempt' AND created_at > now() - interval '1 minute'`);
    if (Number(rate.rows[0]?.total ?? 0) >= 5) throw new MatmsError("RATE_LIMITED", "Too many exports. Please wait a minute and try again.").toORPCError();
    await writeAuditEntry(tx, { actorId: actor.id, action: "report.export_attempt", targetType: "report", targetId: kind, correlationId });
  });
  return db.transaction(async (tx: AuditTransaction) => {
    const rows = reportRows(kind, actor);
    const result = await tx.execute<ReportRow>(sql`${scopedCtes(actor)}, report_rows AS (${rows})
      SELECT r.id, r.kind, r.code, r.title, r.location, r.status, r.occurred_at, r.details FROM report_rows r ${filtersSql(filters)}
      ORDER BY lower(r.code) COLLATE "C", r.kind, r.id LIMIT ${EXPORT_ROW_LIMIT + 1}`);
    if (result.rows.length > EXPORT_ROW_LIMIT) throw new MatmsError("VALIDATION_ERROR", `Export exceeds ${EXPORT_ROW_LIMIT} rows. Narrow the filters and try again.`).toORPCError();
    const generatedAt = new Date().toISOString();
    const headers = ["type", "code", "title", "location", "status", "date", "details"];
    const csv = [
      ["Generated at (UTC)", generatedAt].map(csvCell).join(","),
      ["Report", kind, "Filters", JSON.stringify(filters)].map(csvCell).join(","),
      headers.map(csvCell).join(","),
      ...result.rows.map((row) => [row.kind, row.code, row.title, row.location, row.status, row.occurred_at, row.details].map(csvCell).join(",")),
    ].join("\r\n") + "\r\n";
    await writeAuditEntry(tx, { actorId: actor.id, action: "report.exported", targetType: "report", targetId: kind, correlationId, after: { report: kind, rowCount: result.rows.length, filters: JSON.stringify({ ...filters, query: filters.query ? "[search applied]" : undefined }) } });
    return { csv, generatedAt, rowCount: result.rows.length, limit: EXPORT_ROW_LIMIT };
  });
}
