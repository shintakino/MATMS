#!/bin/sh
set -eu
cd /app/packages/db
bun node_modules/drizzle-kit/bin.cjs migrate
bun -e 'const { Pool } = require("pg"); const pool = new Pool({ connectionString: process.env.DATABASE_URL }); try { await pool.query("GRANT USAGE ON SCHEMA public TO matms_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO matms_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO matms_app; REVOKE UPDATE, DELETE ON audit_logs FROM matms_app;"); console.log("Application database privileges applied."); } finally { await pool.end(); }'
