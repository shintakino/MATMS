import { auditLogs } from "./schema/audit";
import type { Database } from "./index";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type AuditTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: JsonValue;
  after?: JsonValue;
  correlationId: string;
};

const sensitiveKey = /(?:authorization|cookie|password|secret|session|token)/i;

/** Removes credentials and session material before it can reach audit storage. */
export function redactAuditPayload(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditPayload(entry) ?? null);
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, entry]) => [key, redactAuditPayload(entry)]),
  ) as JsonValue;
}

export async function writeAuditEntry(tx: AuditTransaction, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: redactAuditPayload(entry.before),
    after: redactAuditPayload(entry.after),
    correlationId: entry.correlationId,
  });
}

/**
 * Commits a business mutation and its audit record in the same database
 * transaction. If the audit insert fails, the mutation is rolled back too.
 */
export async function runWithAudit<T>(
  db: Database,
  entry: AuditEntry,
  mutation: (tx: AuditTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await mutation(tx);

    await writeAuditEntry(tx, entry);

    return result;
  });
}
