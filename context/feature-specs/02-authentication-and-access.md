# 02 — Authentication and Access

**Status:** Implemented, including inherited grants, consistent template visibility and audited Admin-configurable session limits. Password/reset, revocation, last-Admin, idle/absolute expiry, renewal cookies and browser QR continuation checks pass (2026-10-28). Assisted recovery is used while no email provider is configured.

**Source:** PRD §5, FR-01, §§9–11; AC-01, AC-02, AC-03, AC-18.

**Dependencies:** 00 and 01; grant target constraints integrate with archive tables in 03.

## Outcome and scope

Only active school accounts can access MATMS, and every procedure enforces role capabilities plus inherited record visibility. Admin provisions accounts; public signup is disabled.

## Data and service behavior

- Use Better Auth for email/password, sessions, password changes and recovery. Extend identity with application profile/role/active/must-change-password fields; do not duplicate password handling.
- Bootstrap the first Admin through a controlled one-time procedure with no committed default password. Prevent removal, deactivation, or demotion of the last active Admin, including concurrent attempts.
- Target PRD v1.3 roles are Admin, Property Custodian (`property_custodian`), Staff and Viewer. The three-role baseline is implemented; the fourth role and capability integration below remain planned. Deactivation revokes sessions and preserves actor references in historical records.
- Enforce generic login failures, throttling, secure cookies, trusted origins and applicable CSRF protection. Initial session targets are 30 minutes idle and 12 hours maximum. Administrators can save the school's approved limits (5–120 idle minutes, 1–24 maximum hours, idle no greater than maximum); validate/audit changes and enforce both before server-side renewal. Server-rendered reads do not renew a cookie the browser cannot receive.
- Support recovery email when configured. Otherwise use controlled Admin-assisted reset without revealing existing passwords and require password change at next login.
- Grants target exactly one box, folder, or document with a unique active grant per user/target. Admin has schoolwide access. Non-Admins must satisfy all restricted ancestors and any independently restricted target.
- Reevaluate current scope on every procedure, including operation retries. Apply authorization before pagination/counts. Inaccessible IDs use the same generic unavailable response as absent records.
- Role/grant changes and account changes are audited transactionally. Staff cannot downgrade confidentiality or administer grants.

## UI and routes

Use `/login` and Admin user/access screens under `/admin/*`. Build forms and confirmations from 01. Preserve failed input, show safe errors, and disable duplicate submissions. Hide disallowed actions without treating visibility as enforcement.

A QR or protected-page visit may carry a validated local return path. After successful sign-in, continue to that route and recheck object access. Reject external or malformed redirect destinations.

## Verification

- Direct Viewer mutation calls fail with no writes, even if UI controls are bypassed (AC-02).
- An ungranted Staff user cannot discover restricted titles, related history, search suggestions, counts, exports, print data, or guessed IDs (AC-03).
- A restricted parent plus independently restricted child requires both grants; a child-only grant never bypasses the parent. Revocation takes effect on subsequent calls.
- Deactivated sessions stop working while historical actor attribution remains readable (AC-18).
- QR sign-in continuation succeeds only for an authorized target and never redirects off-site (AC-01).
- Password reset/change, expiry, last-Admin protection, and failed audit rollback have meaningful service/integration tests.

## Planned Property Custodian and assignment extension

- Add the role through a reviewed enum/profile migration and typed contracts, Admin provision/change UI, authenticated context and role-aware shell. Preserve existing users, historical actors, last-Admin protection and active-account/password-change policies.
- Implement the exact PRD §5 matrix across current archive/document/template/request/loan/CSV/label services. Property Custodian receives permitted operational capabilities, never Admin settings/grants or automatic restricted-archive visibility.
- New custodial master/posting/adjustment, import, finalize/amend and official export require Admin/Property Custodian. General Staff report/CSV permission cannot generate official forms. Only Admin configures form profiles, thresholds, sections and default signatories.
- Staff draft/count entry requires a persisted assignment and current authorization for the precise session/line; server-owned snapshot/valuation fields are read-only. Draft access does not grant posting, adjustment, import, finalization or artifact generation. Revoke role/assignment access immediately on subsequent saves/downloads/replays.
- Apply school/record/assignment scope before counts, search, pagination, batch evidence and export history/downloads; use generic unavailable errors for inaccessible IDs.
- Verify direct calls and guessed/replayed IDs for all four roles, revocation/deactivation and cross-domain role regressions. AC-35 is mandatory; baseline checks above do not establish this extension is implemented.
