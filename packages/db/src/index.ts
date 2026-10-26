import { drizzle } from "drizzle-orm/node-postgres";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  return drizzle(env.DATABASE_URL, { relations });
}

export type Database = ReturnType<typeof createDb>;

export { runWithAudit, redactAuditPayload, writeAuditEntry } from "./audit";
export type { AuditEntry, AuditTransaction } from "./audit";
