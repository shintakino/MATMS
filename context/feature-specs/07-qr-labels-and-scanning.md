# 07 — QR Labels and Scanning

**Status:** Planned.

**Source:** PRD FR-09, §§4, 10–11; AC-01, AC-04, AC-16, AC-19.

**Dependencies:** 00–03 and an agreed canonical application origin.

## Outcome and scope

Allow authorized users to find box contents from a stable printed QR label, with a usable manual lookup fallback.

## Generation and printing

- Payload is the configured canonical HTTPS application URL plus `/boxes/{uuid}`. Include no credentials or confidential document metadata.
- A box code edit never changes the UUID target. Codes are references, not access tokens.
- Admin/Staff can select permitted boxes and print through `/labels`; Viewers cannot print labels. Enforce this server-side on label data.
- Offer A4 and single-label layouts showing box code, category, shelf label, QR, and printed date. Make printer calibration configurable.
- Dedicated print styling hides navigation, controls, and notifications. Labels contain no confidential document titles.
- Select QR generation/scanner libraries during implementation after compatibility inspection; no package is assumed installed.
- A canonical-origin change requires a redirect/reprint plan for existing labels.

## Scanning

At `/scan`, request camera access in a secure HTTPS context. Handle permission denial, missing camera, invalid QR, unsupported browser, and retry. Manual box-code entry remains usable in every camera failure state.

Validate scanned URLs before automatic navigation: exact recognized application origin and valid box route/identifier. Reject unrelated origins and malformed payloads. Scope-filter manual code lookup as well.

Anonymous QR opening leads to login with a validated local return path. After login, enforce box/descendant access; unauthorized targets reveal no record existence or preview. A public URL does not mean public box data.

## Verification

- Authorized sign-in returns to the originally scanned box; unauthorized targets remain unavailable (AC-01).
- Old labels continue working after code renaming (AC-04).
- Denied camera access still permits manual lookup; external/invalid QR URLs never auto-navigate (AC-16).
- Printed A4 and single-label samples scan on the school's actual devices (AC-19).
- Direct label-data calls respect role and object scope; print output contains only the allowed fields.
