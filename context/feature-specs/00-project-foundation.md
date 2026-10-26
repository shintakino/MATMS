# 00 — Project Foundation

**Status:** Implemented; production-build/Docker-image verification remains open.

**Source:** PRD §§3–4, 8–9, 12.

**Dependencies:** Repository/context review.

## Outcome and scope

Create a reproducible Better T Stack workspace that preserves the existing MATMS documentation and establishes one authorized backend boundary. This unit does not implement the domain screens.

## Implementation requirements

1. Use the PRD §3 bootstrap configuration: Next.js, Hono, Bun API runtime, oRPC, Better Auth, PostgreSQL, Drizzle, pnpm, Turborepo, and Docker deployment targets. Preserve docs when bringing generated files into this existing repository; use a staging directory if necessary.
2. Record the CLI version, actual generated layout, runtime versions, scripts, and adapter choices. Pin dependencies/toolchains and commit the lockfile. Inspect actual Docker output and Next.js local guides before code changes.
3. Map the generated workspace to the responsibilities in `context/architecture-context.md`; reuse existing packages rather than duplicating infrastructure.
4. Establish environment validation with secret-free examples. Route auth and RPC through Hono; use a typed frontend client. Prefer one public origin with explicit trusted origins.
5. Establish reviewed Drizzle migration and fictional seed workflows. Preserve generated Better Auth schema/ID compatibility; domain schema is added incrementally by subsequent specs.
6. Establish session context, typed safe errors, correlation IDs, and transaction-scoped audit persistence before domain mutations. Audit payloads exclude credentials, session tokens, and unnecessary record content.
7. Select a durable operation-replay storage design for stock, release, and return: unique operation IDs, payload fingerprints, authenticated actor/scope, and saved result. Stock uses the PRD's stock operation model; document the chosen custody replay schema before adding it. Avoid an in-memory deduplication cache.
8. Provide development database persistence, liveness/readiness, and applicable type/lint/build/test scripts. Production hardening and restore rehearsal are completed in 09.

## Verification

- A clean checkout installs from the lockfile and runs the documented development workflow.
- Web calls Hono through the chosen API contract; no browser credentials or direct frontend database connection.
- Migrations apply to an empty test database; auth and application foreign-key types agree.
- A transaction fixture proves that audit failure rolls back its accompanying write.
- Environment validation rejects missing required configuration without exposing secrets.
- Documentation records actual setup and commands; the tracker distinguishes scaffold completion from functional domain completion.
