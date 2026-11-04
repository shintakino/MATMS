import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDb(env: DatabaseConfig) {
  // MATMS serves short, paged operational queries. JIT compilation can cost
  // much more than execution for the authorization-heavy search plans.
  const pool = new Pool({ connectionString: env.DATABASE_URL, options: "-c jit=off" });
  return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;

export { runWithAudit, redactAuditPayload, writeAuditEntry } from "./audit";
export type { AuditEntry, AuditTransaction } from "./audit";
