# MATMS user guide

This guide walks through the current MATMS web interface using fictional examples. Screen access depends on your account role and restricted-record grants. Representative Chromium workflows and automated accessibility checks pass; actual school printers/cameras, assistive technology and device performance still need pilot verification. See the [progress tracker](../context/progress-tracker.md) for evidence and limits.

## Getting started

Open the address supplied by your school or operator and sign in using your provisioned account. For a local development setup, follow the [README](../README.md#development-foundation); the usual web address is `http://localhost:3001`. Contact an Administrator if you need an account or password reset. Use fictional records while evaluating the local preview.

The sidebar includes Dashboard, Boxes, Documents, Search, Scan box, Print labels, Templates, Property inventory, Leave, Bookings, Requests, Loans, and Reports as allowed by your role. Administrators also see Users, Archive setup, Access, Audit, Settings and Leave setup. Inventory is reachable from Templates.

| Role | Typical capabilities |
| --- | --- |
| Administrator | Manage users, access, archive setup and lifecycle, template revisions and stock corrections; process requests and loans; review audit and settings. |
| Property Custodian | Manage property inventory and stock operations, physical counts, controlled imports, and official inventory forms. |
| Staff | Work with permitted documents, stock, requests, loans, reports, and box labels. Restricted records require the necessary grants. |
| Viewer | Read and search permitted records and scan boxes; no business writes, label printing, or CSV export. |

A restricted box, folder, or document may require its own grant. A grant to a child does not bypass a restricted parent. Only Administrators can manage grants. Classroom labels such as “Administrative Officer” do not themselves determine permissions: your MATMS account role does.

## Leave requests, teachers and personnel

Teachers do **not** need MATMS login accounts. Admin maintains their directory records as **SHS — Senior High School** or **JHS — Junior High School**. Admin and active linked personnel accounts can file leave for teachers, other personnel or themselves. Only Admin approves or rejects leave.

Admin opens **Leave setup** (`/admin/scheduling`):

1. Set **SHS teachers away per day**, **JHS teachers away per day** and **Personnel away per day** to the school’s agreed limits. Blank means unlimited; zero closes that category. **All teachers combined per day** is an optional additional ceiling and retains any previous combined teacher limit until you change it. These are scheduling limits, not leave entitlements or balances.
2. Under **Teacher & personnel directory**, enter a unique directory code, name and category, leave the person active, and select **Add directory person**. Teachers have no account link. For personnel who will file leave, first create their login in **Administration → Users**, then choose **Personnel / Administrator** in the directory and link that active non-Viewer account. Linking does not change archive permissions. An Admin choosing **Myself** can create their own personnel directory identity as part of their first leave request.
3. Check **Open leave booking** and save. Enable **Publish approved leave names & dates** only when ready to show approved beneficiary names, categories and dates to anyone with the public calendar link. Reasons, filing-account details, decision notes and pending names remain private.
4. Use **Close or reopen a date** to close a school date to new leave. Resolve active requests on that date first. Reopening remains subject to category limits.

To file on behalf of someone, open **Leave** (`/leave`), search the directory and choose **Request for**, or keep **Myself**. Check the name/category/code carefully. Select the start and inclusive end date, enter the private leave reason, and select **Submit request**. For one day, use the same date twice. A range can cover up to 366 days and must start today or later in Asia/Manila. Every included date must have capacity. The same beneficiary cannot have overlapping active leave even when different personnel file the requests.

Pending requests hold their dates. Admin uses the **Approval register**, enters a decision note, reviews and confirms approval, rejection or cancellation. Personnel see requests they filed or that concern their linked directory identity and can edit/cancel those requests; they cannot approve leave or read everyone’s private register. Rejection/cancellation releases capacity after the server confirms success.

To edit future Pending or Approved leave, select **Edit request**, change dates/private reason, enter **Reason for this change**, then **Review changes → Confirm update**. The beneficiary stays fixed. Availability is rechecked with the existing hold excluded; a successful edit returns the request to Pending and removes its approved public listing until Admin approves again. Errors retain entered changes and the original saved dates/approval. To change the beneficiary or category, cancel and file a new request. Past, rejected and cancelled entries remain history.

Admin edits or retires people through the directory register. Resolve active future leave before changing category, and future leave/reservations before retirement. Account links cannot be reassigned to a different identity. Migrated teachers whose SHS/JHS division was unknown are marked **Teacher (legacy, classify before new leave)**; old holds remain conservative in both division limits. Resolve their active future leave before assigning the correct division. Do not guess divisions or delete historical requests.

### Let a teacher request dates without signing in

1. Admin opens **Leave setup → Temporary public request links**, chooses **Leave — one named teacher**, selects the correct SHS/JHS teacher and a lifetime of 1 hour, 24 hours, 3 days or 7 days.
2. Select **Create request link**, then **Copy link**. Share the complete link, including everything after `#token=`. MATMS does not send email or messages. The full URL is shown only at creation; if it is lost, revoke it and create another.
3. The teacher opens the link without signing in. The page identifies that teacher and shows available, reserved, full, closed and past dates. This limited invitation calendar works even when the ordinary public leave calendar is unpublished; it does not reveal other people’s private requests.
4. The teacher selects the date/range, enters a private reason and selects **Submit request**. They receive a receipt, and the request enters the Admin approval register as Pending. The link is now used; it cannot file a second request.

Failed validation or unavailable dates do not use the link. A retry after a lost response cannot create a duplicate. Expired/revoked links require a new link from Admin. **Revoking or expiring a link does not cancel a request already filed**; decide/cancel that request in the private register. An invitation does not grant permission to edit/cancel/approve or create an account. Updating the bound teacher identity or removing the issuing Admin’s eligibility also makes the link unavailable.

The ordinary `/leave-calendar` remains a separate planning page, showing approved names and SHS/JHS/personnel availability only after Admin enables publication. Ask Admin/personnel to file leave or use an Admin-issued teacher link; teachers do not sign in to request leave.

## Equipment and facility reservations

**Bookings** (`/bookings`) is linked from Property Inventory. Reservations hold dates; they do not post stock, move inventory, reduce balances or record physical release/return. Continue the required inventory/custody transactions separately.

Only Admin opens **Manage resources** (`/bookings/resources`) to create/edit/publish resources:

1. Register each distinct bookable unit or facility with a clear name. Equipment links an existing active semi-expendable/PPE lot; facilities have no inventory lot. If a lot represents several units, give each bookable unit a distinct resource name.
2. Add a public-safe description and enable **Publish on resource calendar** only when the resource should appear in public choices. Publishing starts off.
3. Resolve active future reservations before retiring a resource. An equipment source cannot be retired while an active bookable unit still links to it.

Admin files an internal reservation by choosing **Request for** (teacher/personnel or **Myself**), one resource, a start/inclusive end date and a private purpose. Pending/approved reservations cannot overlap for the same resource, including partial overlaps in a longer range. Another resource can be reserved on the same dates. Admin reviews public/internal requests, verifies the beneficiary and purpose, then approves/rejects/cancels with a note. Future edits require review/confirmation and approval again; past/terminal records remain history. Personnel, Property Custodians and Viewers can check public availability but cannot create/manage internal reservations.

### Let a student, teacher or other visitor request a resource

Admin creates **Equipment or facility — published choices** under **Temporary public request links**, selects expiry and shares the full copied URL. The visitor needs no credentials. They choose an active published resource, review unavailable dates, enter their name, requester category (including **Student**), date range and private purpose, and submit once. The resulting Pending request holds dates and appears in Admin’s approval register with **Submitted through a public link — identity requires Admin review**. A claimed name is not a verified identity; review it before approval. Each visitor needs their own unused link. No student/teacher account is created.

Share `/availability` as the ordinary equipment/facility planning page. It contains published names/descriptions and available/reserved dates, without beneficiary names, purposes, inventory identifiers or values. It directs visitors to obtain an Admin-issued request link. `/leave-calendar` remains separate. Both calendars and the temporary-link form work on mobile and support keyboard operation.

## Example 1: File a Grade 10 SF10 record

MATMS describes where a physical record belongs. One document record represents one physical item; use distinct codes for distinct items. The normal hierarchy is **shelf location → box → folder → document**. A category classifies the box.

1. As an Administrator, open **Archive setup**. Under **Category**, create code `STUDENT-RECORDS` and name `Student Records`.
2. Under **Shelf location**, create code `RR-A-03-01`, room `Records Room`, shelf `A`, rack `03`, position `01`, and label `Records Room / Shelf A / Rack 03 / Position 01`. Use the real physical location once verified.
3. Open **Boxes**, fill in code `SF10-G10-2026-01`, choose the category and shelf location, choose **Restricted**, and select **Create box**. The code identifies the box, not a student.
4. Select the box code in the register. Under **Create folder**, enter code `SF10-G10-2026`, name `Grade 10 SF10 — 2026`, a color, and the appropriate confidentiality. Leave **Folder holds blank template stock** unchecked for completed student records. Select **Create folder**, then use **Open created folder** to continue.
5. Open **Documents** and scroll to **Create document record**. Use **Search folder** to find the full shelf/box/folder path, select that folder and enter a unique code such as `SF10-2026-0001`, title `Student SF10 record`, the applicable date and covered period, and **Restricted** where required. Expand **Optional document details** for dates, keywords, description or an approved HTTPS link; closing the section retains entered values. Add a link only if appropriate. Select **Create document**, then **Open created document**.
6. Find the document in **Documents** or **Search**. Its folder and box identify the physical filing location. The system stores metadata and approved links; it does not upload or store the scanned file.

Use only necessary personal information in names, keywords, and descriptions. A folder or document marked restricted independently of its ancestors needs its own grant for non-Admins. Check actual school confidentiality policy before using real records.

For another school year, repeat the process with new unique codes, for example `SF10-G10-2027-01` and `SF10-G10-2027`. If a box holds multiple folders, create the additional folder from that box instead of creating a separate box automatically.

### Correct or move an archive record

Under **Archive setup → Categories and locations**, an Administrator can edit, activate, or deactivate existing entries. Changing a location's label changes the shared location details shown for its current boxes; previous movement snapshots remain historical.

To record that a physical box moved to a different shelf, first create the destination location, then open the box and use **Move box** with the new location and a reason. Use **Change box code** to rename the code; the QR target uses the box's stable ID. **Edit box details** changes its category, confidentiality, or notes. Lifecycle controls on box, folder, and document detail pages allow an Administrator to review status changes. Retirement keeps history and can be blocked by active descendants, unresolved requests or loans, or stock.

On a folder detail page, Administrators can edit its code, name, color, urgency, notes, confidentiality, and template designation. A folder with inventory history must keep its template designation. Admin and Staff can use **Move folder** with a destination box and a reason. On a document detail page, Admin and Staff can edit permitted metadata and use **Refile document** with a destination folder and a reason. Staff cannot reduce a restricted document's confidentiality. Return checked-out documents and resolve outstanding exceptions before refiling.

The detail pages show current home-location breadcrumbs and permitted movement history. A history location may be shown as unavailable if the operator no longer has access to it. On folder details, use **Include retired documents** to inspect retained records. Registers provide search, status filtering and pagination; choose retired status to find retained records. Records with history are retired rather than normally hard-deleted.

## Example 2: Leave-form template and printed stock

A template is a blank form and its approved external master link. A completed leave form is a separate document record if the school files it as an archive item.

1. Under **Archive setup**, create category code `HR-FORMS` and name `Human Resources Forms`.
2. Under **Templates → Create revision**, enter revision code `LEAVE-2026`, family code `LEAVE`, name `Employee Leave Form`, category `Human Resources Forms`, and revision label `2026 Edition`. Add the revision date if known and an approved HTTPS link to the actual blank master. The example link `https://example.org/forms/leave` is illustrative and is not a real school document. Select **Create revision**.
3. To edit the external form, select **Open master** and use the file provider's application and access permissions. MATMS does not edit or upload the master file.
4. Create a physical box for blank forms, then create a folder inside it with **Folder holds blank template stock** checked. For example, box `HR-FORMS-01`, folder `LEAVE-BLANKS-01`.
5. On **Templates**, select **View and manage template stock**. As an Administrator, use **Set up template stock** to select `LEAVE-2026`, the template folder, and a low-stock threshold such as `5`. A new line starts at zero.
6. In **Stock operation**, select **Receive**, select the new line, enter quantity `20`, and provide a reason such as `Verified opening count`. Select **Review stock operation**, check the source folder, quantity, resulting balance and reason, then **Confirm operation**. The confirmed balance should show `20`.
7. When five blank forms are issued, select **Issue**, the line, quantity `5`, and a purpose. Review and confirm the issue; the balance is then `15`. A zero balance is **Out of stock**; a nonzero balance at or below its threshold is **Low stock**.

Use **Transfer** for the same revision between two distinct template-folder stock lines. The destination selector appears only for a transfer and offers matching revisions. Each full stock operation has an explicit review/confirmation step; cancelling review does not post stock. Correction requires **Confirm correction**. A failed confirmation retains its error and can be retried with the same intent, or cancelled before changing the inputs. An Administrator may use **Correct balance** with a reason after verifying the count. Wait for confirmation; if an operation fails, read the message and check the authoritative balance before retrying. Opening stock is recorded as a receive operation, not assumed.

Select a template name to see its per-folder stock. An Administrator can correct the name, description, and approved master link there and review a status change. Revision code, family, category, revision label and date can be corrected before stock activity or supersession fixes the revision identity. To replace a revision, create a new revision in the same family and select **Supersedes revision**; the previous active revision becomes superseded while its printed stock stays attached to it. Superseded stock needs an Administrator decision for issuance; retirement requires zero stock.

Under **Inventory → Quick actions and thresholds**, expand a stock line. Enter a reason before selecting **Receive +1** or **Issue −1**. An Administrator can change the line's low-stock threshold there. A full balance correction requires review and confirmation. Stock ledger reporting is available through Reports.

## Property Inventory module

**Property inventory** tracks supplies and property by fund cluster and office. It has its own balances and ledger; the printed blank-form stock described in Example 2 is separate. Start with fictional data when learning the workflow. Before using real records, the school must approve its classifications, form profiles, report sections, opening balances and relevant policies.

| Account role | Property Inventory access |
| --- | --- |
| Administrator | Manage inventory, counts, imports and reports; record form profiles, report sections, classification policies and property-number exceptions. |
| Property Custodian | Manage inventory and stock operations, create and finalize counts, review imports and generate official-form workbooks. |
| Staff | View the register and Stock Cards and enter observations for assigned draft counts. Assignment does not permit stock posting, imports, finalization or official exports. |
| Viewer | View the property inventory register and item details; Stock Card history, counts, imports and official exports are unavailable. |

The module includes **Help with inventory terms** for explanations of items, acquisition lots, office balances, fund clusters, form profiles and variance. On an item, **Set up this item** shows saved setup progress. Select a step or **Go to next step** to open the relevant section. Ordinary supplies can skip lot creation and use an office balance without a lot. Stock activity is marked as recorded only after the server saves an operation; a zero quantity alone does not establish that an opening count was verified.

### Find or set up an item

1. Open **Property inventory** from the sidebar. Expand **Search and filters** to find items by code, description, class, fund, office, condition, year, reorder status or data-quality status. Select **Apply filters**; use **Clear filters** to start again.
2. An Administrator or Property Custodian can expand **Create item**. For a fictional example, enter code `TEST-PAPER-01`, article `Copy paper`, description `Fictional sample paper`, unit `ream` and reorder point `5`. Expand **Optional stock and report settings** to enter the reorder point and default report section when applicable, then select **Create item**. Select **Continue item setup** to open the newly saved item.
3. Open the item. For property tracked by acquisition lot, expand **Create lot** and enter the class, property number if available, fund cluster, office and other known details. Expand **Optional acquisition details** for supplier, acquisition dates, officer, remarks or an approved property-number exception. Collapsing this section retains entered values. Leave **Unit value in PHP** blank when unknown; enter `0` only when the verified value is zero. A duplicate property number needs an approved exception; ask an Administrator rather than inventing one.
4. Expand **Create office balance**. Select the applicable lot, or **Stock card without lot** when appropriate, and enter the fund and office. **Create zero balance** creates a balance of zero; it does not assume stock is on hand. Use matching fund and office details for the selected lot.
5. To establish verified stock, expand **Record stock operation**, select **Verified opening balance** and the balance, enter the verified quantity, date, reference and reason, then select **Review operation** and confirm. For the example, a verified opening of `20` gives a balance of 20 reams. A verified zero opening may also be recorded.

Administrators and Property Custodians can review changes under **Edit item** or **Edit lot**, enter a reason and confirm them. Item codes remain reserved after replacement, and the unit cannot be changed after a lot or balance exists. Missing property numbers, condition and valuation should be reviewed before a count is finalized.

### Record stock movements and review a Stock Card

On an item's page, use **Record stock operation** for a **Receipt**, **Issue**, **Return**, **Transfer** or **Correct balance**. Select the appropriate balance, enter the date, reference and reason, and review the proposed operation before confirming. Transfer destination is shown when **Transfer** is selected; issue-only days-to-consume is shown when **Issue** is selected. For a transfer, choose the destination balance as well. For **Correct balance**, enter the verified new balance, not the amount of the difference. A backdated operation may change later balances: review its impact and reconfirm; if the source changes, request a fresh preview.

Select **View stock card** to inspect transactions in chronological order, filtered by fund, office and as-of date. Administrators and Property Custodians can enter the entity and an effective Stock Card profile, review the report scope, then generate the workbook. Confirm that the running balance agrees with the supporting records. A failed operation should be investigated before retrying; do not add a second movement merely because confirmation is delayed.

### Carry out a physical count

**Count progress** shows saved entry/review progress and points to the next task. It is guidance, and the server still validates all finalization requirements. Assigned Staff see progress only for their visible scope.

1. Open **Property inventory → Physical counts**. An Administrator or Property Custodian selects **Create count session**, gives it a unique code, chooses RPCSP for semi-expendable property or RPCPPE for property, plant and equipment, and selects an effective matching form profile.
2. Enter the as-of date, fund cluster, optional office and required entity, accountability and signatory details. **Apply profile signatories** replaces the corresponding entered names with saved defaults; review them afterward. Leave all report sections unchecked for the full scope, or select sections for a partial count. Select **Create count session**.
3. Open the session. A manager can use **Assign Staff** to authorize a Staff member for the whole draft session or a specific count line. Assigned Staff enter observations only within their assignment.
4. For each applicable line, enter the actual **Physical quantity**, condition and any remarks, then **Save count**. If condition is **mixed**, enter the separate condition quantities so they add up to the physical quantity. Record an observation of zero as `0`; do not use it to mean unknown.
5. A manager reviews the observations and uses **Record review**. For lines that cannot be counted or should not be included, choose the appropriate **Resolution** and provide a reason. Review the displayed count summary and signed differences: variance quantity is physical count minus the frozen card balance; variance value uses the frozen unit value when known.
6. If source items, balances or report sections change, use **Refresh count sources → Preview changes**. Review changed and unavailable lines, decide whether to include or exclude additions with a reason, and select **Apply reviewed changes**. Recheck affected observations and reviews.
7. After reviewing every required sheet and resolving outstanding lines, a manager selects **Review finalization** and confirms **Finalize count**. Finalization freezes the count snapshot and its membership. It does not post an inventory adjustment. To correct a finalized count, use **Create linked amendment** with a new code and reason, then review and finalize the amendment separately.

### Generate and retrieve official forms

An Administrator must first use **Physical counts → Record approved form profile** to record a reviewed profile for each required family. **Load reference starting point** supplies a starting layout; the school must review the definition and record its visual approval before relying on it. Default signatories are optional and still need review for each count. Administrators can also manage the effective report sections on the physical-counts page. Changing sections may require draft counts to be refreshed; finalized snapshots stay frozen.

For a finalized count, open **Finalized workbook**, select **Review report scope**, check the frozen data and exclusions, then select **Generate Excel workbook**. The generated RPCSP or RPCPPE workbook contains the form family's sheets. Use **Download** or **Preview and print**. For an Appendix 58 Stock Card, generate the workbook from the item's Stock Card page. Previously generated reports are available under **Property inventory → Report history**; expired workbook files are regenerated from their saved report snapshots.

Check the resulting columns, totals, signatories, pagination and printed output against the school's approved forms. The reference-based starting points are not themselves school approval; Excel and physical-printer acceptance remain open.

### Import an existing workbook

An Administrator or Property Custodian can use **Property inventory → Controlled imports** for supported Appendix 58 Stock Cards, Annex A.8 RPCSP and Appendix 73 RPCPPE files (`.xls` or `.xlsx`). Staging inspects the workbook and saves review evidence; it does not itself post stock. An Administrator must record the school-approved classification policy before staging an RPCSP workbook.

**Import progress** shows staged, resolved and committed work. **Review intended effect** explains whether the selected outcome changes stock. Resolve or exclude every source row before reviewing a commit.

1. Under **Stage workbook**, choose the file and applicable classification policy, then select **Stage for review**. If an earlier matching batch is listed, inspect it before proceeding to avoid duplicate work.
2. Open the batch. Review **Source metadata and signature evidence**, workbook warnings and the optional **Download error report**. Use **Find existing mapping targets** to search for existing items, lots and balances; the row selectors use the current target page.
3. Expand each source row. Map it to the correct existing lot or ledger balance, or **Exclude with reason**. Supply the requested physical quantity, verification, mismatch and warning resolutions. Historical Stock Card rows need their transaction details and verified running balances. Save each row resolution; inspect proposed continuation rows and duplicate-number candidates against the source.
4. Under **Review intended effect**, choose the intended outcome. Count workbooks can produce a **Draft physical count only**, **Verified openings only**, or **Verified openings and draft count**. Stock Cards use **Historical Stock Card ledger**. Complete the requested details, acknowledge exclusions and warnings, select **Review commit**, and confirm only after checking the summary.
5. A committed count remains a draft and never silently adjusts stock. Opening or historical-ledger effects post only after the explicit reviewed commit. Confirm the resulting draft or ledger and reconcile it with the original records. Retain the original workbook unchanged.


## Example 3: Request and borrow an archived document

Requests are entered by an Admin or Staff member on behalf of the requester. The required document must already exist and be visible to the operator.

1. Open **Requests → New request**. Enter code `REQ-2026-0001`, a fictional requester, office/contact as needed, and purpose `Review student record`. Select **Borrow**, use **Find documents** to search authorized records, and tick the required documents. Review **Selected documents**; choices are retained while searching or paging and can be removed there. Select **Create draft**.
2. On the resulting request page, use **Request progress** to see the next task and select **Submit request**. For each pending line, choose a decision and select **Record decision**. A rejection requires a reason. Restricted records require Administrator approval.
3. For an approved borrow line, enter the recipient and due date/time in Manila time, check **Recipient acknowledged**, select **Release original**, and confirm. The original is now tracked in **Loans**.
4. Under **Loans**, select **Active** or **Overdue** to find it. When returned, choose the condition and return location; add a reason if returning to a different folder. Select **Record return** and confirm.
5. If lost or damaged, expand **Report lost or damaged original** and record the exception and notes. An Administrator records a disposition and supporting notes to resolve the exception. Physical return and administrative resolution are separate facts; a missing original must not be assumed returned.

For **Inspect** or **Copy**, approve the request and use **Record fulfillment** rather than releasing an original. If the document list is empty, first create the record and check access to every restricted ancestor. Do not substitute a blank template inventory line for an archived document request.

## Search, dashboard, and reports

The **Dashboard** shows permitted counts and links to operational lists. **Search** filters by record type, code/title/keyword, category, shelf, confidentiality, and status. Select a result to open its available detail page.

In **Reports**, choose a report such as Box and folder register, Document register, Template balances, Stock ledger, Loan history, Request history, or Relocation history. Keep the common filters visible and expand **Advanced filters** for dates, statuses and confidentiality. **Active filters** summarizes the current scope, and the date help explains which event date the chosen report uses. Saved URL filters reopen Advanced filters when needed. Admin and Staff can select **Export filtered CSV**; exports are limited to 5,000 authorized rows, so narrow filters if necessary. Viewer report access is limited and export is unavailable. Results, counts, and exports use the signed-in account's access scope.

## Print and scan box labels

Labels are for boxes. An Administrator must configure a valid canonical HTTPS origin in **Settings**, or the deployment must supply one. This is the real address the QR code will open, such as the school's approved HTTPS domain; `http://localhost:3001` is not a valid canonical QR origin. A change of origin requires a documented redirect/reprint plan.

1. Open **Print labels**, select one or more permitted boxes, and choose **A4 sheet** or **Single label per page**.
2. Set width between 40–190 mm and height between 30–150 mm. A preview appears for the selected boxes.
3. Select **Print labels** and print at actual size/100% in the browser. If no printer is connected, use the browser's **Save to PDF** option if available.
4. Test the printed size and scan on the intended school device before applying labels. Open **Scan box**, allow camera access on a supported secure connection, or enter the box code and select **Find box**. Scanning still requires sign-in and record access.

If printing is disabled, check that an HTTPS origin is configured, boxes are selected, the list has loaded, and dimensions are in range. A printer is not required to enable the web button. QR labels do not reveal document titles.

## Administration

- **Users:** provision an account, assign Admin/Property Custodian/Staff/Viewer, activate or deactivate it, and provide an assisted reset. **Reset password** opens a masked dialog identifying the account; enter and confirm a temporary password of at least 12 characters. Cancellation leaves the account unchanged, and failed resets retain their error in the dialog. Deactivation and reset revoke active sessions; the last active Administrator is protected.
- **Access:** search for an account and record, then inspect **Access preview**. It shows the selected record’s ancestry, existing grants and missing restricted parents. **Review grant for …** switches to a missing parent without granting automatically. Select **Review grant** and confirm the intended account/record. Existing grants can be revoked. Review restricted parent and child grants separately.
- **Audit:** choose an action, actor and record type to filter the read-only history. Events use readable descriptions; expand **Action code**, **Record ID**, **Support reference** or **View changes** for technical details and redacted changes. Business changes and their audit records are committed together.
- **Settings:** use **School identity**, **Sign-in and session policy** and **QR label website address** to configure the school name, sign-in limits and public HTTPS address printed in QR codes. Changing an origin requires a redirect/reprint plan so previously printed labels can continue to reach their box records.

Administrators can also set the school-approved idle session timeout and maximum session lifetime in Settings. Defaults are 30 minutes idle and 12 hours maximum. Reducing the limits can require existing users to sign in again. Do not change these values merely to work around a browser error.

## Reproducible fictional development data

The development seed only accepts database names ending in `_dev` or `_test`. Create a separate development database, apply migrations, and bootstrap an Administrator using the [README setup commands](../README.md#development-foundation) with that database URL. Then run:

```bash
DATABASE_URL='postgresql://postgres:YOUR_LOCAL_PASSWORD@127.0.0.1:55432/matms_dev' \
SEED_ADMIN_EMAIL='your-development-admin@example.test' \
pnpm run seed:dev
```

Use the actual PostgreSQL port and an existing active Administrator email. Point the local backend at the same database to view the records. The script adds the five baseline categories, a fictional shelf/box/template folder/document, a fictional leave-form revision, and a zero-balance stock line. Its master link points to the example domain, not a real form. Rerunning preserves existing entries and balances. It creates no default Administrator or production password.

For automated browser checks, use a disposable database seeded this way, a running web/backend pair, and a test HTTPS canonical origin for label preview. Run `pnpm exec playwright install chromium` once, then:

```bash
MATMS_BROWSER_URL='http://localhost:3101' \
MATMS_BROWSER_EMAIL='your-development-admin@example.test' \
MATMS_BROWSER_PASSWORD='YOUR_DISPOSABLE_TEST_PASSWORD' \
pnpm run test:browser
```

The browser tests modify fictional stock and create request/loan history, so run them only against disposable fixtures. Optional Staff and Viewer walkthroughs use `MATMS_BROWSER_STAFF_EMAIL` and `MATMS_BROWSER_VIEWER_EMAIL` with the same supplied test password. The seed can provision these fictional accounts only when `SEED_STAFF_EMAIL`, `SEED_VIEWER_EMAIL`, and `SEED_DEMO_PASSWORD` are explicitly provided. It does not overwrite existing account credentials.

## Troubleshooting

- **No categories or locations when creating a box:** an Administrator must create and activate them in Archive setup.
- **No folder for a document:** an Administrator must open the box and create a folder; verify your access if it is restricted.
- **No stock to select:** an Administrator must create a template revision, mark a folder for template stock, and create its stock line. Receive stock to establish a confirmed balance.
- **Record unavailable:** check account status, role, and grants for every independently restricted level. A missing and an inaccessible record may show the same unavailable message.
- **A retirement is blocked:** check active descendants, outstanding requests or loans, and remaining stock; resolve them before retrying.
- **Label or scanner unavailable:** check the canonical HTTPS origin, box selection, and browser camera permissions. Use manual box lookup if the camera cannot be used.
- **Forgot password:** contact an Administrator for an assisted reset.

Production use still requires the school's approved policies, security review, backup/restore rehearsal, and pilot sign-off. See the [progress tracker](../context/progress-tracker.md) for open work and verification results.

## Appendix 59 — Inventory Custodian Slip (ICS)

Admin and Property Custodian accounts open **Property Inventory → Reports → Appendix 59**. First create the equipment item and a semi-expendable acquisition lot with its inventory item number and unit value. Create the office balance, record verified opening stock and post an Issue to the receiving office/recipient.

In the ICS section, select the recorded issues for the same fund and recipient. The server assigns a number such as `2026-11-001` when the slip is saved, using the current Manila year/month and the next monthly sequence. Enter the entity, Received from/by printed names, positions/offices, dates and estimated useful life for each selected issue. Select **Review ICS**, check quantities and costs, then **Confirm and export Excel (.xlsx)**. Quantities and costs come from the server; generation does not issue stock again or record a signed acknowledgement.

Saved ICS slips have **Download Excel**, **Edit**, **Versions** and **Delete** actions. Edit pre-fills the saved metadata, selected issues, descriptions and useful lives; enter a reason, review and save a new version under the same ICS number. Quantities and costs already saved on the slip remain frozen; newly added issues use reviewed inventory values. Descriptions can be corrected for the printed slip without changing the inventory item.

**Versions** downloads earlier saved copies. **Delete** moves a slip to **Deleted slips**; use **Restore** to return it to active history. Deleting does not cancel an issue or change stock, and deleted numbers are reserved. Existing slip numbers are retained.

The latest layout follows `ICS-2025-11-001.xlsx`, with the reference fonts/sizes and long bond paper (8.5 × 13 inches). Print at the workbook's saved settings, one page wide and as many pages tall as needed. Long descriptions continue without reducing font size; headings repeat and signatures stay together. Complete wet signatures on the printed form. ICS workbook import is not supported.

The print-spacing correction expands the cost headings and signature rows so their labels are fully visible. For a slip saved before this correction, use **Edit**, enter a reason such as “Update print spacing”, review and save/export the new version. This keeps the same ICS number and preserves the old version. Select long bond/Folio (8.5 × 13 inches) in the printer's paper settings and use the workbook's one-page-wide scaling; avoid fitting the whole workbook onto one page tall.

New and edited slips print both signature dates as **MM-DD-YYYY**, for example **11-12-2026**. Dates remain stored as ISO dates. To update an older slip, save an edit with a reason such as “Update printed date format”; the ICS number and earlier copies are retained.
