# 05 — Requests, Fulfillment and Loans

**Status:** Planned.

**Source:** PRD FR-07, §§6, 8–10; AC-08, AC-11–AC-13.

**Dependencies:** 00–03; shared idempotency and audit infrastructure.

## Outcome and scope

Track authorized record requests from entry and approval through fulfillment, custody, return, or documented exception resolution. Admin/Staff enter requests on behalf of requesters; no public requester portal.

## Request behavior

- Capture requester name, optional office/contact, purpose, type (`inspect`, `borrow`, `copy`), one or more unique document lines, and notes. Collect only necessary personal data.
- Follow PRD lifecycle: draft → submitted → approved/rejected/cancelled; first fulfillment makes an approved request in progress; complete it only when all required lines are resolved and loans returned/resolved.
- Track decisions and fulfillment per line. Partial requests remain active until remaining lines are resolved. Cancellation applies only to unfulfilled lines; do not erase completed actions.
- Ordinary approvals may be made by authorized Admin/Staff. Restricted-record requests require Admin approval and a releaser with current record access.
- Approval is separate from release. Rejections require reasons. Revalidate line eligibility and current permissions at each transition.
- Before implementing aggregate-state logic, document the mixed approval/rejection/cancellation transition table consistently with the PRD; unresolved state combinations are tracked as an open question, not guessed.

## Fulfillment and custody

- Inspect/copy fulfillment records actor and timestamp without a loan. If the original leaves custody, use Borrow.
- Borrow records recipient acknowledgement, releasing officer, released timestamp, and due date. Enforce at most one unresolved open checkout per document in PostgreSQL.
- Release requires an approved eligible request line. Commit checkout, fulfillment/request progress, and audit in one transaction.
- Return records receiver, time, condition, and home folder. An authorized alternative folder creates a relocation event in the same transaction.
- Prevent refile while checked out; allow existing loan returns to archived home boxes.
- Overdue is computed from an open loan and due timestamp. Display timestamps in Asia/Manila; verify release/due/return chronology.
- Repeated release/return uses durable operation IDs and payload matching; no duplicate loan or double close.
- Lost/damaged records remain unresolved exceptions until Admin records resolution and supporting notes. Preserve history and block retirement while unresolved. Resolve the exact exception dispositions with school policy before implementing any implied write-off.

## UI and routes

Use `/requests`, `/requests/[id]`, and `/loans`. Compose request forms, authorized RecordPicker, line tables, status badges, and release/return confirmations from 01. Show pending/approved/rejected/cancelled/fulfilled lines and loan state distinctly. Filters include active, overdue, returned, and exception loans.

Keep recipient, due date, and condition fields explicit. Failed submission retains input; pending buttons prevent duplicate clicks. Request summaries and related histories must not disclose inaccessible documents.

## Verification

- Two concurrent releases produce at most one open loan (AC-11).
- Partial fulfillment remains in progress until remaining lines and loans are resolved (AC-12).
- Return records receiver/condition and closes custody once while retaining history (AC-13).
- Lost-response retries do not duplicate release/return and mismatched operation reuse fails (AC-08).
- Restricted approval, unauthorized release, already fulfilled lines, invalid chronology, and unapproved lines fail safely.
- Alternative-location return commits custody, movement, and audit together; failure changes none.
