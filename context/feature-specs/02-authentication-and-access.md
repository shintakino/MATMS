# 02 — Authentication and Access

**Status:** Implemented for accounts, roles, sessions, and Admin user management on 2026-10-26. Grant target storage and inherited record-scope enforcement remain coupled to the archive schema in 03.

**Source:** PRD §5, FR-01, §§9–11; AC-01, AC-02, AC-03, AC-18.

**Dependencies:** 00 and 01; grant target constraints integrate with archive tables in 03.

## Outcome and scope

Only active school accounts can access MATMS, and every procedure enforces role capabilities plus inherited record visibility. Admin provisions accounts; public signup is disabled.

## Data and service behavior

- Use Better Auth for email/password, sessions, password changes and recovery. Extend identity with application profile/role/active/must-change-password fields; do not duplicate password handling.
- Bootstrap the first Admin through a controlled one-time procedure with no committed default password. Prevent removal, deactivation, or demotion of the last active Admin, including concurrent attempts.
- Provision Admin, Staff, and Viewer accounts according to PRD §5. Deactivation revokes sessions and preserves actor references in historical records.
- Enforce generic login failures, throttling, secure cookies, trusted origins and applicable CSRF protection. Session targets are 30 minutes idle and 12 hours maximum, configured and enforced server-side.
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
