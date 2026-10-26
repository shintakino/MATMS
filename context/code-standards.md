# Code Standards

## General and TypeScript

- Keep modules small and responsibility-focused; follow [architecture-context.md](architecture-context.md).
- Use strict TypeScript. Avoid `any`; validate unknown input at boundaries. Prefer explicit object contracts and infer types from validated schemas where appropriate.
- Use generated workspace aliases, scripts, environment validation, and package boundaries. Do not create duplicate auth, database, UI, or utility packages.
- Pin toolchain/dependency versions and commit the pnpm lockfile. Verify actual scaffold behavior before copying setup commands.

## Next.js and client state

- Read the relevant installed `node_modules/next/dist/docs/` guides before coding; do not assume familiar APIs or routing conventions.
- Default to Server Components; use client components for forms, interactive tables, scanner access, and other browser behavior.
- Keep business logic and database access in the Hono/domain boundary. Server rendering must use authorized service calls.
- Use the typed oRPC client and the scaffold's compatible cache integration. Invalidate affected lists, details, dashboards, and ledgers after mutations; do not establish a second uncoordinated cache.
- Persist list filters in the URL. Use deterministic server sorting, default page size 25, maximum 100, and roughly 300 ms search debounce.

## UI and styling

- Use shadcn/ui primitives and shared Tailwind semantic tokens from [ui-context.md](ui-context.md).
- Add primitives to the configured directory using the supported CLI. Reuse the existing `cn()` helper; create it only if missing, using the scaffold-compatible class-merging utilities.
- Compose app-specific behavior in feature components. Keep primitives free of business rules; prefer theme tokens and wrappers to one-off generated component edits.
- Provide labels, keyboard access, visible focus, associated errors, and loading/empty/error states. Include text with semantic colors.
- Preserve failed form input and disable duplicate pending submissions. Stock balances and success feedback require server confirmation.

## API and security

- Validate procedure inputs and outputs. Derive actor identity from the verified session, never from a client field.
- Enforce active-account, role, and inherited record-scope checks on every procedure, including reads, aggregates, print data, and exports.
- Apply authorization before pagination/aggregation. Use generic unavailable responses for inaccessible IDs; avoid leaking related record names through history and request payloads.
- Use typed errors from PRD §9 and safe user messages with correlation IDs. Never expose raw database errors or sensitive data.
- Honor trusted origins, cookie/session protections, and rate limits. Preserve only validated local post-login return paths.
- Validate approved HTTPS file URLs without fetching arbitrary addresses. Scanner navigation accepts only recognized application-origin box URLs.

## Database and domain rules

- Use Drizzle with parameterized queries and reviewed migrations; no production schema push. Match foreign-key types to the generated Better Auth adapter.
- Enforce nonnegative stock/thresholds, unique normalized codes, revision/folder uniqueness, exactly-one grant/movement targets, chronology, and unique unresolved loans in the database.
- Execute balance changes, ledger entries, related request/custody updates, and audit in the applicable database transaction. Audit failure must roll back the business change.
- Use conditional updates/locks and expected versions where required. Transfers must commit both sides or neither.
- Implement idempotency for stock, transfer, release, and return operations. Store operation intent/fingerprint and result durably; reject mismatched reuse and reauthorize retries. Do not issue a new ID merely because a response timed out.
- Use UTC event timestamps and Asia/Manila presentation; keep date-only fields timezone-independent. Compute overdue status.
- Retire records instead of normal UI hard deletion; restrict history foreign-key deletion. Preserve actor references after deactivation and do not reuse retired codes.
- Keep fixtures fictional. No real student/personnel data, default production passwords, secrets, or session values in code, logs, or seed files.

## Reports and operational code

- Export only authorized filtered rows; escape CSV correctly and neutralize spreadsheet formulas in text cells. Audit actor, scope, and row count. Document export limits and narrowing guidance.
- Do not expose secrets through public environment variables, bundles, health endpoints, or Docker layers.
- Use bounded retries, timeouts, health checks, and redacted structured logs. Treat backup/restore and migration procedures as release deliverables.

## Verification

Run the generated project's relevant type, lint, test, and build scripts once available. Prioritize meaningful checks for permission inheritance, state transitions, concurrent stock writes, transfer rollback, duplicate operation retries, open-loan uniqueness, and audit rollback. Use browser tests for login/QR continuation, stock issuance, request/return workflows, and accessibility. Documentation-only updates require consistency and link checks, not claims of passing application tests.
