# PROJECT_INSTRUCTIONS.md

## 1. Project Overview

Build a standalone web application that takes a scanned Purchase Order (PO) PDF, extracts the information needed to create a manufacturing job, allows a human reviewer to verify and edit the extracted information, and records the approved result.

This application is intentionally separate from the existing RFQ extraction application. It should have its own repository, deployment, database, API, and failure domain.

The project has two phases:

### Phase 1 — PO Extraction + Human Review

The application must:

1. Accept a PO PDF upload.
2. Process the PDF.
3. Use Claude vision to extract structured PO information.
4. Store the extracted information.
5. Allow a human to review and edit it.
6. Allow the reviewer to confirm the information.
7. Keep the original PDF and extraction history.

**Phase 1 must NOT write anything to ShopKeeper.**

### Phase 2 — ShopKeeper Integration

After Phase 1 is reliable, add the ability to take a confirmed PO/job and create the corresponding ShopKeeper records.

Do not implement Phase 2 while building Phase 1.

---

# 2. Intended User Workflow

The primary workflow is mobile-first:

1. User receives or has a paper PO.
2. User scans the PO using an existing scanning application such as Genius Scan, Adobe Scan, or Microsoft Lens.
3. The scanning application produces a PDF.
4. User opens this web application on their phone.
5. User uploads the PDF.
6. The application extracts the PO information automatically.
7. User reviews the extracted information.
8. User corrects anything that is wrong or missing.
9. User selects **Confirm Reviewed**.
10. The confirmed information is stored and becomes eligible for the future ShopKeeper integration.

The application does **not** need to:

* Control the phone camera.
* Implement its own document scanner.
* Be a native mobile application.
* Be a PWA.
* Implement a separate OCR system.

A normal responsive web application with a standard file upload is sufficient.

---

# 3. Technology Stack

## Frontend

Use:

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui

The frontend should be responsive and mobile-first while still providing a useful desktop interface.

## Backend

Use:

* Python
* FastAPI
* Pydantic
* SQLAlchemy
* Alembic

Keep API, business logic, database access, PDF processing, and AI extraction logically separated.

## AI

Use:

* Anthropic Python SDK
* A vision-capable Claude model

Create a small provider abstraction around the extraction service.

The abstraction is primarily for **testing and isolation**. It should allow the application to run against a mocked/fake extraction provider during automated tests without making real AI calls.

Do not build unnecessary infrastructure for switching between multiple AI vendors.

Conceptually:

```text
ExtractionProvider
    ↓
ClaudeExtractionProvider
```

Tests should be able to use:

```text
FakeExtractionProvider
```

The fake provider should return predictable structured data without contacting an external AI service.

The provider abstraction exists primarily for **testability and clean separation of concerns**, not because the application needs a multi-provider AI architecture.

Keep the Anthropic-specific code isolated from the rest of the application.

### Anthropic Rate Limits

Anthropic API rate limits are associated with the organization/account usage pool, not simply with an individual API key.

If this application and the existing RFQ application (`britech_webapp`) use the same Anthropic organization, their API usage can contribute to the same organization-level rate limits even if they use separate API keys.

This application is expected to be relatively low-volume, so this does not require additional infrastructure now. The information is documented here so that increased usage can be diagnosed correctly if rate limiting becomes an issue.

---

# 4. PDF Processing

Use:

* PyMuPDF

PyMuPDF should be responsible for:

* Opening and validating PDFs.
* Determining page count.
* Extracting embedded PDF text when available.
* Rendering PDF pages to images for vision processing.

## No OCR subsystem

**Do not add Tesseract or another standalone OCR engine.**

For scanned PDFs, the rendered page images are the primary source of information and are sent to Claude vision.

If a PDF contains embedded text, that text can additionally be supplied to the extraction process.

There should not be a separate OCR stage.

---

# 5. Database and Deployment

## Database

Use:

* PostgreSQL

For local development:

* Docker Compose

For production:

* Render PostgreSQL

## Deployment

Use:

* Render
* GitHub
* `render.yaml`

The project should be deployable from GitHub with the required services and environment variables defined through Render.

---

# 6. PDF Storage

For the initial application, store small PO PDFs directly in PostgreSQL as binary data (`bytea`).

Typical POs are expected to be small, generally around 1–3 pages.

However, isolate PDF storage behind a storage service/interface so that object storage such as S3 can be introduced later without changing the rest of the application.

Do not introduce S3 or another object-storage service unless it becomes necessary.

---

# 7. Data Model

## `po_request`

Represents the PO and the current reviewer-facing extraction.

Suggested fields:

```text
id
created_at
updated_at

status
review_state
heartbeat_at

po_number
customer_name
customer_number
order_date
requested_ship_date

buyer_contact
buyer_notes

bill_to
ship_to

extraction_error
warnings
```

Do **not** store `raw_extraction_json` here.

### `status`

Use:

```text
pending
extracted
failed
```

### `review_state`

Use:

```text
unreviewed
confirmed
```

`po_request` represents the **current state** of the PO.

---

## `po_line_item`

Represents individual PO line items.

Suggested fields:

```text
id
po_request_id
line_number

customer_part_number
revision
description

quantity
unit_price
uom

due_date
notes

reviewer_edited
```

A PO may contain multiple line items.

Do not assume that every PO has exactly one part.

---

## `po_attachment`

Stores the original uploaded PDF.

Suggested fields:

```text
id
po_request_id

filename
content_type
pdf_bytes
page_count
```

The original PDF must be preserved even after re-extraction.

---

## `llm_call`

Represents **one individual AI extraction attempt**.

Suggested fields:

```text
id
po_request_id

model
call_type

input_tokens
output_tokens
cost_usd

raw_extraction_json

created_at
```

Every extraction and re-extraction must create a new `llm_call` record.

`raw_extraction_json` belongs here because each attempt must preserve exactly what the AI returned.

For example:

```text
PO uploaded
    ↓
llm_call #1
    raw_extraction_json = Claude's first response
    ↓
human reviews
    ↓
re-extract
    ↓
llm_call #2
    raw_extraction_json = Claude's second response
```

The current extracted values in `po_request` and `po_line_item` can be replaced by a re-extraction, but previous `llm_call` records must remain unchanged.

This provides a complete extraction/debugging history containing:

* Which model was used.
* What the model returned.
* How many tokens were used.
* What the extraction cost.
* When the attempt occurred.

---

# 8. Extraction Requirements

Extract the following header information when present:

* Customer name
* Customer number
* PO number
* Order date
* Requested ship date
* Buyer/contact
* Buyer notes
* Bill-to address
* Ship-to address

Extract the following information for every line item:

* Line number
* Customer part number
* Revision
* Description
* Quantity
* Unit price
* Unit of measure
* Due date
* Notes

If information is unavailable or genuinely ambiguous, return `null`.

**Never invent information.**

---

# 9. Manufacturing-Specific Extraction

The extraction process should be designed specifically for manufacturing purchase orders.

Pay particular attention to distinguishing:

* PO number vs. part number
* Part number vs. revision
* Quantity vs. unit price
* Unit price vs. total/extended price
* PO date vs. requested delivery date
* Line number vs. customer part number

Use document layout, labels, nearby text, tables, and visual relationships when interpreting the PO.

Do not rely solely on text order.

Different customers may format their POs differently, so the extraction logic should be tolerant of varying layouts.

---

# 10. Extraction Pipeline

The expected pipeline is:

```text
PDF upload
    ↓
Validate PDF
    ↓
Store original PDF
    ↓
Create po_request
    ↓
Background extraction
    ↓
Read embedded PDF text when available
    ↓
Render PDF pages to images
    ↓
Send page images + available text to Claude
    ↓
Receive structured extraction
    ↓
Validate with Pydantic
    ↓
Run application-level checks
    ↓
Store current extracted values
    ↓
Store raw AI response in llm_call
    ↓
Set status = extracted
    ↓
Human review
```

For scanned PDFs:

```text
PDF
 ↓
render page images
 ↓
Claude vision
```

There is no standalone OCR step.

---

# 11. Background Extraction

Extraction should run asynchronously so that uploading a PDF does not require the browser to remain blocked waiting for Claude.

The upload endpoint should:

1. Validate the PDF.
2. Store it.
3. Create the `po_request`.
4. Mark extraction as pending.
5. Dispatch the extraction work.
6. Return promptly.

The extraction worker should:

* Load the original PDF.
* Process the PDF.
* Call the extraction provider.
* Validate the response.
* Store the result.
* Update the status.

---

# 12. Retry and Recovery

Claude API rate-limit errors (`429`) should be retried.

Use:

* Exponential backoff.
* `Retry-After` when supplied.

Extraction jobs should maintain a heartbeat using `heartbeat_at`.

If the application restarts while extraction is occurring, stale jobs should be detectable and recoverable.

The stale threshold must be configurable using:

```text
HEARTBEAT_STALE_SECONDS
```

Do not hardcode the stale-job threshold in application logic.

If a job has not updated its heartbeat for longer than the configured threshold, it should be considered stale and eligible for recovery according to the worker's recovery logic.

Do not leave a PO permanently stuck in `pending` because a worker crashed.

Keep the original PDF so failed extraction can be retried.

---

# 13. Extraction Warnings

Warnings should be stored with the PO and displayed to the reviewer.

Examples:

* Missing PO number.
* Missing customer.
* Missing quantity.
* Missing due date.
* Partial line-item extraction.
* Poor document/image quality.
* Unreadable page.
* Conflicting values.
* Multiple possible PO numbers.
* Duplicate PO detected.

Do not create an OCR-quality warning because the application does not contain an OCR subsystem.

Warnings should generally be non-blocking unless the application cannot produce a meaningful extraction at all.

---

# 14. Multiple PO Number Detection

If the document appears to contain multiple distinct PO-number-like values, do not silently choose one.

Instead:

1. Extract the likely values.
2. Identify the ambiguity.
3. Add a warning.
4. Allow the reviewer to determine the correct value.

Do not silently merge multiple POs into one request.

---

# 15. Duplicate Detection

Duplicate detection should be based on:

```text
customer_number + po_number
```

Do not enforce uniqueness on PO number alone.

Customers may reuse PO numbers.

The application should perform a live query for matching existing POs.

Duplicate detection should initially be a non-blocking warning.

If the matching existing PO has already been confirmed, make the warning more prominent.

Do not add a `possible_duplicate_of` field unless it becomes necessary.

---

# 16. Review Interface

The application is mobile-first.

## Desktop

Use a two-panel layout where practical:

```text
┌──────────────────────┬─────────────────────────┐
│                      │                         │
│      PDF Viewer      │    Extracted Data       │
│                      │                         │
│                      │    PO Information       │
│                      │    Line Items            │
│                      │                         │
└──────────────────────┴─────────────────────────┘
```

## Mobile

Use a vertical layout:

```text
PO
↓
Warnings
↓
PDF
↓
PO Information
↓
Line Items
↓
Save Draft
↓
Confirm Reviewed
```

Requirements:

* No horizontal scrolling.
* Large touch targets.
* Inputs must be easy to edit on a phone.
* Buttons must be easy to tap.
* Tables should become mobile-friendly cards or stacked fields when necessary.

---

# 17. PDF Viewer

The reviewer must be able to inspect the original PO while reviewing the extracted data.

Support:

* Multiple pages.
* Page navigation.
* Zoom.
* Mobile viewing.
* Page thumbnails where practical.

Provide backend endpoints for retrieving the original attachment and/or rendered pages.

Do not build a bounding-box editor or crop editor.

The user can use their original scanning application if they need to rescan a document.

---

# 18. Editing

Every extracted field should be editable.

The reviewer should be able to:

* Change header values.
* Change part number.
* Change revision.
* Change description.
* Change quantity.
* Change price.
* Change UOM.
* Change dates.
* Change notes.
* Add line items.
* Delete line items.

When a reviewer changes an extracted value:

```text
reviewer_edited = true
```

The original AI extraction history must not be modified.

## Editing a Confirmed PO

A confirmed PO represents a human-reviewed version of the **current data**.

Therefore, if a PO currently has:

```text
review_state = confirmed
```

and the user changes any PO or line-item data, the application must immediately change it to:

```text
review_state = unreviewed
```

The user must review and confirm the modified data again.

This rule applies to any edit that changes the stored PO data, including:

* Header fields.
* Line-item fields.
* Adding a line item.
* Deleting a line item.
* Changing an existing line item.

Do not allow a confirmed PO to remain `confirmed` after its underlying data has been modified.

Editing a PO that is already `unreviewed` does not require any additional state transition.

---

# 19. Save Draft vs. Confirm Reviewed

Provide two separate actions.

## Save Draft

Saves the reviewer's changes but leaves:

```text
review_state = unreviewed
```

## Confirm Reviewed

Saves the changes and sets:

```text
review_state = confirmed
```

A confirmation means that a human has reviewed the **exact current stored data**.

If the data is subsequently changed, the confirmation is no longer valid and `review_state` must return to `unreviewed`.

In Phase 1, confirmation has **no effect on ShopKeeper**.

---

# 20. Re-extraction

Allow the reviewer to request a new extraction using the original stored PDF.

When re-extraction occurs:

1. Keep the original PDF.
2. Create a new `llm_call`.
3. Store the new raw AI response in that `llm_call`.
4. Preserve all previous `llm_call` records.
5. Replace the current extracted `po_request` fields.
6. Replace the current extracted line items.
7. Set:

```text
review_state = unreviewed
```

8. Clearly tell the reviewer that re-extraction replaced the current extracted values.

Re-extraction must always reset a PO to `unreviewed`, including when the PO had previously been confirmed.

The reasoning is that a confirmed PO means a human reviewed **the exact current data**. Re-extraction changes that data, so the result must be reviewed again.

The UI should warn that manual edits may be overwritten by re-extraction.

---

# 21. REST API

Implement endpoints approximately along these lines:

```text
POST   /upload
GET    /po
GET    /po/{id}
PUT    /po/{id}
POST   /po/{id}/reextract
POST   /po/{id}/review
DELETE /po/{id}

GET    /po/{id}/attachment
GET    /po/{id}/attachment/page/{page_number}
```

Keep API schemas separate from database models.

---

# 22. Upload Handling

The upload endpoint should use multipart form data.

Validate:

* File type.
* Actual PDF validity.
* Maximum file size.
* Maximum page count.

Make limits configurable through environment variables.

For example:

```text
MAX_UPLOAD_SIZE_MB
MAX_PDF_PAGES
```

The upload operation should persist the request and original PDF before starting extraction.

Do not make the user wait for the AI extraction inside the upload HTTP request.

---

# 23. Dashboard

Provide a dashboard/list of PO requests.

Show information such as:

* PO number.
* Customer.
* Upload date.
* Extraction status.
* Review status.
* Duplicate warning.

Provide:

* Search.
* Sorting.
* Pagination.

Show an indicator when an extraction job appears stale.

---

# 24. Error Handling

Errors should be understandable to the user.

Examples:

```text
"Unable to process this PDF."
"Extraction failed. Please try again."
"This PDF exceeds the maximum page count."
"Multiple possible PO numbers were found. Please review."
```

Do not expose stack traces to the user.

Log technical details on the backend.

Always preserve the original PDF when possible so the request can be retried.

---

# 25. Security

Implement basic application security:

* Validate uploaded files.
* Enforce size limits.
* Enforce page limits.
* Never execute uploaded files.
* Sanitize filenames.
* Keep API keys server-side.
* Do not expose database credentials to the frontend.
* Do not provide raw database access through the API.

The frontend should communicate with the backend API only.

---

# 26. ShopKeeper Integration Boundary

**Phase 1 must not connect to ShopKeeper.**

Do not add a SQL Server connection merely to prepare for future integration.

It is acceptable to define a placeholder interface such as:

```text
ERPIntegrationService
    create_job(...)
```

but it must not perform any real ShopKeeper operations in Phase 1.

---

# 27. ShopKeeper Phase 2

Phase 1 must not implement this. When building Phase 2, **`Phase2_Instructions.md` is the source of truth.** Also read:

* `references/job_entry_write_sequence.md`
* `references/table_schema.md`
* `references/job_write_test`

Do not invent ShopKeeper write behavior from this section alone.

## Scope

After a PO is `review_state = confirmed`, Phase 2 creates **one ShopKeeper job per PO line** using the **single-job** path (not Multi Job Entry). Writes are **steps 1–6 only**:

1. Reserve job number (`SkMaster` UPDATE, `SSMA_TimeStamp` retry)
2. Insert `LockInfo`
3. Insert `Jobs`
4. Insert `JobShip`
5. Insert `JobRelease`
6. Update `JobRelease` scheduling fields

A person then opens the job in ShopKeeper and finishes routing, traveler, and shipping. That handoff is intentional.

Each line is its own job. Jobs from one PO share **customer** and **PO number**. Each job has its own part, revision, quantity, due date, unit price, and PO line number.

## Required before any write

* Reviewer-approved **customer** and **part + revision**, stored on the line. Do not re-run fuzzy matching at write time.
* Customer lookup uses bill-to / both rows only and must resolve to exactly one row. Bill-to and ship-to codes are the same customer number.
* Never guess a revision.
* Write the **reviewed PO unit price**. Do **not** look up contract or price-matrix prices in Phase 2.
* Tax (`Jb_Taxable`, `Jb_TaxCode`) comes from the customer when present; otherwise non-taxable / configured non-tax code (service work).
* Connection and expected database name come from configuration (`Phase2_Instructions.md` §8). On connect failure or database-name mismatch, stop and show a clear error. Keep credentials out of the repo.

## Out of scope

* Price lookup / matrices
* Multi Job Entry or batch job-number reservation
* Routing (`OpStatus`), traveler print, shipping, `SystemID` ship numbers, `JobShipMaster`
* Creating or editing customers, parts, or already-created ShopKeeper jobs

## Persistence (application DB)

Track per-line resolution and ERP status (`pending` / `ready` / `creating` / `created` / `failed` / `skipped`), store `erp_job_number`, and keep an `erp_write_audit` log. A line must never create two jobs. Details are in `Phase2_Instructions.md` §§4–6.

Database for production: `SkData`. Database for testing: `SkData_Test`. Job numbers come from `SkMaster.SK_NextJobNumber` with `SSMA_TimeStamp` optimistic concurrency — never `MAX(Jb_Job_Num) + 1`.

# 28. Suggested Project Structure

```text
po-extraction-app/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   ├── types/
│   │   └── ...
│   └── ...
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   │   ├── extraction/
│   │   │   ├── pdf/
│   │   │   └── storage/
│   │   ├── workers/
│   │   ├── database/
│   │   └── main.py
│   │
│   ├── tests/
│   └── ...
│
├── docker-compose.yml
├── render.yaml
├── .env.example
└── README.md
```

Do not split this into microservices.

---

# 29. Testing

Test at minimum:

## Upload

* Valid PDF.
* Invalid file.
* Oversized file.
* Too many pages.
* Scanned PDF.
* Digital/text PDF.
* Multi-page PDF.

## PDF Processing

* Page count.
* Embedded text extraction.
* Page rendering.
* Multiple pages.

## AI Extraction

* Valid response.
* Missing fields.
* `null` values.
* Multiple line items.
* Malformed AI response.
* Conflicting values.
* Multiple possible PO numbers.

Use the fake extraction provider for normal automated tests.

Real Claude calls should be limited to explicit integration-test configuration.

## Database

Test:

* PO creation.
* Line items.
* Attachments.
* `llm_call` history.
* Raw extraction history.
* Re-extraction history.
* Duplicate detection.
* Review edits.
* Confirmation.

Specifically verify that:

1. Re-extraction does **not** delete previous `llm_call.raw_extraction_json` records.
2. A confirmed PO becomes `unreviewed` when its data is edited.
3. Re-extraction always sets `review_state` to `unreviewed`.
4. A PO can be confirmed again after the modified data is reviewed.

## Failure Recovery

Test:

* AI failure.
* Rate limiting.
* Worker failure.
* Stale heartbeat.
* Retry behavior.
* Application restart.

---

# 30. Environment Variables

At minimum:

```text
DATABASE_URL
ANTHROPIC_API_KEY
ANTHROPIC_MODEL

MAX_UPLOAD_SIZE_MB
MAX_PDF_PAGES

HEARTBEAT_STALE_SECONDS
```

Use `.env.example` to document required variables without committing secrets.

`HEARTBEAT_STALE_SECONDS` controls how long an extraction job can go without updating its heartbeat before it is considered stale and eligible for recovery.

Do not hardcode the stale-job threshold in application logic.

Choose a sensible development/production default in `.env.example`, but allow it to be overridden through the environment.

---

# 31. Incremental Development Plan

Build the application incrementally.

## Step 1 — Foundation

Set up:

* React/Vite frontend.
* FastAPI backend.
* PostgreSQL.
* Docker Compose.
* SQLAlchemy.
* Alembic.
* Basic project structure.
* Health-check endpoint.

Do not add AI yet.

## Step 2 — Upload

Implement:

* Mobile-friendly upload.
* PDF validation.
* Database persistence.
* Attachment storage.
* PO request creation.

Test with an actual PDF from a phone.

## Step 3 — PDF Processing

Implement:

* Page counting.
* Embedded text extraction.
* Page rendering.

Test both scanned and digital PDFs.

Do not add OCR.

## Step 4 — AI Extraction

Implement:

* `ExtractionProvider`.
* Claude implementation.
* Fake test implementation.
* Structured Pydantic extraction schema.
* Vision processing.
* Background extraction.
* Retry handling.
* Heartbeat/recovery.
* Configurable stale threshold using `HEARTBEAT_STALE_SECONDS`.
* Warnings.
* `llm_call` history.
* Per-attempt `raw_extraction_json`.

Test with real PO PDFs.

## Step 5 — Review UI

Implement:

* PDF viewer.
* Extracted PO fields.
* Line items.
* Editing.
* Warnings.
* Duplicate banner.
* Save Draft.

Make the mobile workflow usable before optimizing the desktop experience.

## Step 6 — Confirmation

Implement:

* Confirm Reviewed.
* Review state.
* Confirmation behavior.
* Reset confirmed PO to `unreviewed` whenever its data is subsequently edited.

Still no ShopKeeper writes.

## Step 7 — Dashboard

Implement:

* PO list.
* Search.
* Sorting.
* Pagination.
* Status indicators.
* Duplicate indicators.
* Stale extraction indicators.

## Step 8 — Deployment

Deploy to Render.

Test the complete workflow:

```text
Phone
 ↓
Scan PDF
 ↓
Upload
 ↓
Extract
 ↓
Review
 ↓
Edit
 ↓
Confirm
 ↓
(Optional later) Edit confirmed PO
 ↓
Automatically becomes unreviewed
 ↓
Review again
 ↓
Confirm again
```

Test with real scanned manufacturing POs.

Only after this workflow is reliable should Phase 2 begin.

---

# 32. Definition of Done — Phase 1

Phase 1 is complete when the application can reliably:

* Accept scanned PDFs from a phone.
* Accept digital PDFs.
* Process multiple-page PDFs.
* Extract multiple PO line items.
* Extract manufacturing-relevant information.
* Handle missing information.
* Handle ambiguous information.
* Display warnings.
* Detect likely duplicates.
* Allow human editing.
* Save drafts.
* Confirm reviewed POs.
* Automatically invalidate confirmation when confirmed data is subsequently edited.
* Preserve original PDFs.
* Preserve every AI extraction attempt.
* Preserve raw AI responses per attempt.
* Record AI token/cost information.
* Re-extract from the original PDF.
* Reset re-extracted POs to `unreviewed`.
* Retry temporary AI failures.
* Recover stale extraction jobs.
* Survive application restarts without permanently losing work.
* Work well on mobile.
* Work on desktop.
* Deploy successfully to Render.

Most importantly:

**Phase 1 must contain no code that writes jobs, parts, operations, releases, or other records to ShopKeeper.**

---

# 33. General Cursor Development Instructions

When working on this project:

1. Read this document before making architectural decisions.
2. Follow the Phase 1/Phase 2 boundary strictly.
3. Do not add OCR.
4. Do not add unnecessary technologies.
5. Do not introduce microservices.
6. Do not connect to ShopKeeper during Phase 1.
7. Do not implement Phase 2 features prematurely.
8. Do not invent PO information during extraction.
9. Use `null` when information is genuinely unavailable.
10. Preserve warnings rather than silently hiding uncertainty.
11. Preserve extraction history.
12. Preserve raw AI responses for every extraction attempt.
13. Keep AI-specific code behind the extraction-provider abstraction.
14. Use the fake extraction provider for automated tests.
15. Keep the application mobile-first.
16. Keep business logic separate from API route handlers.
17. Keep database models separate from API schemas.
18. Use typed interfaces where practical.
19. Add tests for important behavior.
20. Update the README when setup or architecture changes.
21. Explain significant architectural changes before implementing them.
22. Do not rewrite working parts of the application unnecessarily.
23. Prefer simple, maintainable solutions over premature optimization.
24. Do not add infrastructure merely because it might be useful later.
25. Preserve the ShopKeeper reference information for Phase 2, but do not implement it during Phase 1.
26. Treat `review_state = confirmed` as meaning that a human has reviewed the exact current stored data.
27. Any modification to a confirmed PO must reset `review_state` to `unreviewed`.
28. Any re-extraction must reset `review_state` to `unreviewed`.
29. Do not hardcode configurable operational thresholds such as the stale heartbeat duration.
30. Remember that Anthropic rate limits may be shared across applications using the same Anthropic organization.
