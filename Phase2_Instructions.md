# Phase 2 Requirements — ShopKeeper Job Creation (Steps 1–6)

**Version:** 1.0 (9/23/26). This consolidates the Cursor plan, the ChatGPT
revision, and two review passes.
**References:** `references/job_entry_write_sequence.md` (write order, rules,
test log), `references/table_schema.md` (columns, keys, triggers),
`references/job_write_test` (working pyodbc script, tested on `SkData_Test`).

---

## 1. Overview

Phase 2 takes a **confirmed** Phase 1 PO (`review_state = confirmed`) and
creates **one ShopKeeper job per PO line** through write steps 1–6 only, using
the single-job entry path. It does not use Multi Job Entry.

```text
Confirmed PO
    ↓
Customer resolution (reviewer-approved, stored)
    ↓
Part + revision resolution (reviewer-approved, stored)
    ↓
Per line: write-time checks → reserve job number → write steps 2–6
    ↓
Store job number + audit record
    ↓
Human opens the job in ShopKeeper and completes it
```

Phase 2 stops there. A person finishes routing, scheduling, the traveler, and
shipping in ShopKeeper. That manual pass is **intentional**: it is the second
check on every automated job.

**Already tested on `SkData_Test` (9/22/26):**
- The steps 1–6 script created a job that opened normally in Job Control.
- ShopKeeper pulled the operations from `PartMaster`/`OpMaster` when the job
  was completed manually.
- ShopKeeper recalculates `Jr_StartDate` when operations are copied. This is
  expected (see §7, step 6).

---

## 2. Implementation todos

| id | Task |
|---|---|
| `phase1.5-lookups` | Read-only customer and part lookups, reviewer resolution UI, stored resolutions. No price lookup. |
| `phase2-writer` | ShopKeeper writer for steps 1–6 (§7), with write-time checks (§5.5) and the duplicate-line check (§5.4). |
| `phase2-app-handoff` | Per-line create-job action, ERP status tracking, idempotency (§6), audit log. |
| `phase2-config` | Config-based connection string and expected database name; credentials kept out of the repo (§8). |
| `phase2-prod-login` | Create a minimal-permission SQL login for production, separate from `po_app_writer` (§8). |
| `phase2-reference-diff` | Field-by-field comparison of a script-created job against a manually entered job; resolve `Jb_Status` and the non-tax code (§11). |
| `phase2-acceptance` | Run the acceptance tests in §10 on `SkData_Test`. |

---

## 3. What Phase 2 is (and isn't)

For each confirmed PO line, Phase 2 writes:

1. Reserve job number (`SkMaster` UPDATE)
2. Insert `LockInfo`
3. Insert `Jobs`
4. Insert `JobShip`
5. Insert `JobRelease`
6. Update `JobRelease` scheduling fields

Each line becomes its own standalone job. All jobs from one PO share the
**customer** and **PO number**. Each job has its own **part, revision,
quantity, due date, unit price and PO line number**.

- Reserve **one** job number per job, never a batch.
- Do not use Multi Job Entry, its lock comment, or its interleaved scheduling.
- Do not automate steps 7–15 (`OpStatus`, traveler, ship numbers,
  `JobShipMaster`, close/ship). They stay documented for a future phase.

---

## 4. Stored data (application database)

### 4.1 Per PO line — resolution fields (set during review)

| Field | Used for |
|---|---|
| `resolved_customer_code` | `Jb_Cust_Code` and `Jb_Shipto_Code` |
| `resolved_part_number` | `Jb_Part_Num` |
| `resolved_part_revision` | `Jb_Part_Rev` |
| `resolved_pm_linkid` | `Jr_PartMasterLink` |
| `po_line_number` | `JobShip.Sh_PO_Line` (also the duplicate-check key) |
| `unit_price` (reviewed, **per each**) | `Jb_Price` |
| `quantity` | `Jb_Qty_Order`, `Sh_Qty_Due`, `Jr_StartQty`, `Jr_MinDueQty` |
| `due_date` | `Sh_Due_Date`, `Sh_DockDate`, `Sh_OrigDate`, `Jr_FirstDueDate`, `Jr_ShopDueDate` |

The writer uses these stored values. It **never re-runs matching** at write
time, so an approved match can't silently change later.

### 4.2 Per PO line — ERP status fields

| Field | Notes |
|---|---|
| `erp_status` | `pending` · `ready` · `creating` · `created` · `failed` · `skipped` |
| `erp_job_number` | Set when the job is created, or recovered (§6) |
| `erp_created_at` | |
| `erp_failure_reason` | Human-readable reason for `failed` or `skipped` |
| `erp_database` | `DB_NAME()` at write time |

Status meanings:
- `pending`: not yet resolved.
- `ready`: customer and part resolved and approved, and the PO is confirmed.
- `creating`: set **before** step 1; a write attempt is in progress or was
  interrupted.
- `created`: ShopKeeper job exists and its number is stored.
- `failed`: the attempt failed and was rolled back. Retry is allowed after
  the §6 recovery check.
- `skipped`: the reviewer chose not to create a job for this line.

`erp_status` is the application's source of truth for integration progress.

### 4.3 Audit table: `erp_write_audit`

```text
id, po_id, line_item_id, job_number, action, status,
database_name, app_version, request_json, result_json,
error_message, created_at
```

Record every attempt: inputs, the reserved job number, success or failure,
and any recovered job number. The table has to answer *why was this job
created, when, from what data, against which database, and what failed?* Do
not rely on ShopKeeper tables (`LockInfo`) for application audit history.

---

## 5. Preconditions before any write

Phase 2 must never invent a customer, part, or revision.

### 5.1 Customer resolution

- **Preferred:** exact match on `[Customer Number]` (the primary key). Over
  time, store a mapping from the extracted PO customer to a `Customer Number`
  so reviewers only confirm it once.
- **Alternative:** exact match on `Company`.
- **Always filter:** `[Customer Record Type] IN ('Both', 'Bill To')`. A
  ship-to row can share the same `Company` text as its bill-to row.
- **Require exactly one match.** Zero or multiple matches go to the reviewer
  with every candidate shown (`Customer Number`, `Company`, record type,
  `Bill To Customer Number`). Never auto-select.
- **Bill-to = ship-to** (shop decision): write the resolved code to both
  `Jb_Cust_Code` and `Jb_Shipto_Code`.
- Rows with a NULL record type are excluded. Add `OR [Customer Record Type]
  IS NULL` only if an older customer actually turns up as "found 0."

Customer status rules:

| Condition | Behavior |
|---|---|
| `[Active] = 0` | **Block**. Reviewer must resolve it in ShopKeeper first. NULL counts as active. |
| `[CreditHold] = 1` | **Warn.** The reviewer must explicitly confirm before the line becomes `ready`. |

Never create customers.

### 5.2 Part resolution

- Look up `(Pm_PartNum, Pm_PartRev)` together, with
  `COALESCE(Pm_InActive, 0) = 0`. This is `PartMaster`'s composite key.
- Require exactly one row.
- The revision comes from the extracted PO. A missing or unmatched revision
  goes to the reviewer. Never guess and never auto-select among revisions.
- Store `Pm_LinkID` as `resolved_pm_linkid`.

Never create parts.

### 5.3 Price

Price lookup is out of scope. Do **not** query `CustomerContractPrices` or
`PartMasterPriceMatrix`.

Write the reviewed PO unit price to `Jobs.Jb_Price`. It must be a **per-each**
price, because `Jb_Unit = 'Each'`. If a PO shows a lot or extended price, the
reviewer converts it before confirming.

### 5.4 Duplicate check (PO number + PO line)

Multiple jobs sharing one PO number is expected, so check PO **and line**:

```sql
SELECT j.Jb_Job_Num
FROM   dbo.Jobs j
JOIN   dbo.JobShip s ON s.Sh_Job_Num = j.Jb_Job_Num
WHERE  j.Jb_PO_Num = @PONum AND s.Sh_PO_Line = @POLine;
```

- **During review:** if this finds a job, show it to the reviewer. The line
  can't become `ready` unless the reviewer marks it `skipped` or confirms it's
  a genuine new order.
- **At write time:** this is the recovery check in §6.

### 5.5 Write-time checks (no re-matching)

Immediately before step 1, the writer confirms the **stored** values are
still valid:

- `resolved_customer_code` exists, has record type `Both`/`Bill To`, and is
  not inactive. Credit hold, if newly set, fails the line back to review.
- `(resolved_part_number, resolved_part_revision)` exists and is active.
- The quantity is a positive integer, the due date is present, and the unit
  price is present and ≥ 0.

If any check fails, set `failed` with a clear reason. Write nothing, and don't
try to re-resolve.

---

## 6. Idempotency — a line never creates two jobs

The dangerous case is: *job committed in ShopKeeper → network timeout or
crash → app never records `created` → user clicks Create again.* A status
check alone doesn't catch it, so the create action does this:

```text
1. If erp_status == created or erp_job_number is set  → reject.
2. If erp_status in (creating, failed):
       run the §5.4 PO + line check against ShopKeeper
       if a job is found → store its number, set created, audit "recovered", stop.
3. Set erp_status = creating (committed to the app DB) and audit "attempt".
4. Run the write-time checks (§5.5), then steps 1–6 (§7).
5. On success → store erp_job_number, set created, audit "created".
   On failure → set failed with the reason, audit "failed".
```

Only one create action per line may run at a time. Use a row lock or a
conditional status update in the app DB. A `created` line can only become
eligible again through an explicit **admin reset**, which is also audited.
Use it, for example, when someone deleted the job in ShopKeeper.

---

## 7. Write sequence and field mapping

### Step 1 — Reserve job number (own commit)

```sql
SELECT SK_MasterDummy, SK_NextJobNumber, Sk_NextJobNumberPrefix, SSMA_TimeStamp
FROM   dbo.SkMaster;

UPDATE dbo.SkMaster SET SK_NextJobNumber = @Counter + 1
WHERE  SK_MasterDummy = @Dummy AND SSMA_TimeStamp = @TS;
```

- `rowcount == 1` means the number is reserved; commit immediately.
  `rowcount == 0` means a conflict; re-read and retry (up to 5 times, then
  fail).
- Job number = `prefix + counter`, using the counter value **before** the
  increment. This is what the tested script does; still an open question.
- Reserve outside the job transaction. An unused number is simply skipped,
  never returned.
- Store the reserved number in the audit record before step 2.

### Steps 2–6 — one transaction

On any failure, roll back all of steps 2–6. The reserved number stays
consumed.

**Step 2 — `LockInfo` INSERT**

| Column | Value |
|---|---|
| `Lk_Form` | `'Jobs'` |
| `Lk_ID` | job number |
| `Lk_Date` | now (see the timezone open question) |
| `Lk_Initials` | `'AUTO'` (confirm it doesn't collide with a real user) |
| `Lk_Comment` | `'New Job Input via Automation'` |

**Step 3 — `Jobs` INSERT**

| Column | Value |
|---|---|
| `Jb_Job_Num` | job number |
| `Jb_Cust_Code`, `Jb_Shipto_Code` | `resolved_customer_code` |
| `Jb_PO_Num` | PO number |
| `Jb_Part_Num`, `Jb_Part_Rev` | resolved part + rev |
| `Jb_Part_Desc` | `PartMaster.Pm_PartDesc` |
| `Jb_Order_Date` | today (date only) |
| `Jb_Qty_Order` | line quantity |
| `Jb_Price` | reviewed unit price (per each) |
| `Jb_Unit` | `'Each'` |
| `Jb_Cert_Required` | `COALESCE(Customers.Cus_CertDefault, 0)` |
| `Jb_Taxable` | `COALESCE(Customers.Cus_TaxableDefault, 0)` |
| `Jb_TaxCode` | `Customers.Cus_TaxCodeDefault`; if NULL/blank, config `SHOPKEEPER_NON_TAX_CODE` |
| `Jb_Status` | config `SHOPKEEPER_NEW_JOB_STATUS`, currently `'NA'` (schema default; **open**) |
| `Jb_SalesPerson` | `LEFT(Customers.Salesman, 20)` |
| `Jb_Terms` | `Customers.[Payment Terms]` |
| `Jb_ShipVia` | `Customers.[Shipped Via]` |
| `Jb_NeedPOConfirm`, `Jb_Locked`, `Jb_Facility` | `0` |

Tax notes:
- Use `Cus_TaxCodeDefault` (`nvarchar(3)`), **not** `[Sales Tax Code]`
  (`nvarchar(31)`), because `Jb_TaxCode` is `nvarchar(3)`.
- Set `SHOPKEEPER_NON_TAX_CODE` to whatever a manually entered non-taxable
  job has in `Jb_TaxCode`. Don't leave it as "code or blank."
- The work is generally treated as a service, so non-taxable is the expected
  fallback.

**Step 4 — `JobShip` INSERT**

| Column | Value |
|---|---|
| `Sh_Job_Num` | job number |
| `Sh_Release_Num`, `Sh_ReleaseInt` | `1` in **both** (tested; which one ShopKeeper actually reads is open) |
| `Sh_PO_Line` | `po_line_number` |
| `Sh_Due_Date` (NOT NULL), `Sh_DockDate`, `Sh_OrigDate` | line due date |
| `Sh_Qty_Due` | line quantity |
| `Sh_ShipType` | `'MTO'` |

**Step 5 — `JobRelease` INSERT**

| Column | Value |
|---|---|
| `Jr_JobNum` | job number |
| `Jr_ReleaseNum` | `1` |
| `Jr_FirstDueDate`, `Jr_ShopDueDate` | line due date |
| `Jr_MasterType` | `COALESCE(Pm_MasterType, 'Production')` |
| `Jr_PartMasterLink` | `resolved_pm_linkid` |

Don't write `Jr_HasOSP`; the `SetJr_HasOSP` trigger owns it. Leave the other
columns at their defaults (`Jr_RejectQty` is NOT NULL and defaults to 0).

**Step 6 — `JobRelease` UPDATE (timestamp-checked)**

Re-read `SSMA_TimeStamp`, then set `Jr_StartDate` = today,
`Jr_StartQty` = quantity, and `Jr_MinDueQty` = quantity. `rowcount == 0` is a
conflict and fails the transaction.

`Jr_StartDate` is a **placeholder**. When the operations are copied in
ShopKeeper, ShopKeeper recalculates it by working back from the due date
through the routing, skipping holidays. That recalculated date is the one
that counts. The due dates must **not** change (see §10).

---

## 8. Connection and credentials

- Use **pyodbc** with ODBC Driver 18 (`TrustServerCertificate=yes`, SQL
  login), the same form as the tested script.
- Read these from configuration. Never hardcode them in source:
  - `SHOPKEEPER_CONNECTION_STRING`
  - `SHOPKEEPER_EXPECTED_DATABASE` (e.g. `SkData_Test`)
  - `SHOPKEEPER_NON_TAX_CODE`, `SHOPKEEPER_NEW_JOB_STATUS`
- Keep credentials out of the repo: use environment variables or an
  uncommitted config file.
- **Database check:** on connect, read `DB_NAME()`.
  - If it doesn't match `SHOPKEEPER_EXPECTED_DATABASE`, stop with a clear
    error. This catches a test config pointed at production, and the
    reverse.
  - Record it in `erp_database` and in every audit row.
- On a connection failure, catch it, set the line to `failed` with a
  readable reason, and show a clear error to the user.
- **Logins:** `Testing-User` exists write and read only on `SkData_Test` while it is read  only on `SkData`. Production needs
  its own login with write access limited to `SkMaster`, `LockInfo`, `Jobs`,
  `JobShip` and `JobRelease`, and read access to the lookup tables.

---

## 9. Write rules

- **Optimistic concurrency:** every UPDATE includes the row's current
  `SSMA_TimeStamp`. `rowcount == 0` means a conflict, not a SQL error; retry
  or fail explicitly.
- **Transaction design (our choice, not copied from ShopKeeper):** the
  reservation is committed on its own; steps 2–6 run in one transaction.
- **Insert order:** `Jobs` must come before `JobShip` and `JobRelease`; that
  much is required by FKs. `JobShip` before `JobRelease` follows the traced
  ShopKeeper order and isn't enforced.
- **Triggers:** never update `Jb_Job_Num` (`JobNumTrigger` blocks it). Never
  write `Jr_HasOSP`.
- **Validation is the application's job.** There are no CHECK constraints,
  so the database won't reject bad values.
- SQL stays inside the ShopKeeper service class, never in API routes. Keep a
  fake ERP implementation with the same interface for tests.

---

## 10. Acceptance tests (on `SkData_Test`)

1. A single-line PO creates a job that opens in Job Control. Operations copy
   from `OpMaster`, and the job completes normally.
2. A three-line PO creates three independent jobs with the same customer and
   PO number, and the correct `Sh_PO_Line` on each.
3. **Due dates survive:** after the job is completed in ShopKeeper,
   `Jr_ShopDueDate` and `Sh_Due_Date` still equal the PO due date.
   `Jr_StartDate` changing is expected.
4. `Jb_Cert_Required` matches the customer's `Cus_CertDefault`. Test one
   customer with it set to 1 and one with 0.
5. `Jb_Taxable` and `Jb_TaxCode` match the customer defaults. A customer
   without defaults gets 0 and the configured non-tax code.
6. A customer with bill-to and ship-to rows (e.g. Bay Advanced) resolves to
   the bill-to row only.
7. A part with several revisions requires an explicit revision; a missing
   rev blocks the line.
8. **Crash recovery:** simulate a failure after the commit and before the app
   saves `created`. The retry recovers the existing job number and creates no
   second job.
9. Clicking Create twice quickly creates exactly one job.
10. Forcing a failure in step 4 or 5 rolls back steps 2–6. No partial rows
    remain, and the reserved number is skipped.
11. A mismatched `SHOPKEEPER_EXPECTED_DATABASE` stops the write before step 1.
12. Field-by-field comparison with a manually entered job shows no
    unexplained differences.

---

## 11. Open questions

**Must be resolved before production:**
- Job number prefix handling, and whether the number is the counter before or
  after the increment. The current code uses the value before.
- `Jb_Status` value for new jobs (currently the placeholder `'NA'`).
- The shop's non-tax code for `Jb_TaxCode`.
- Field-by-field comparison with a manually entered job (acceptance test 12).
- A production SQL login with minimal permissions.

**Can stay open; the current behavior works:**
- `JobShip` release columns: writing both `Sh_Release_Num` and
  `Sh_ReleaseInt` has been tested and accepted by ShopKeeper.
- Whether ShopKeeper uses `Customers.[Tax Exempt]` when filling in tax.
- `Lk_Initials = 'AUTO'`: confirm with the shop.

---

## 12. Manual correction policy

Phase 2 **creates** ShopKeeper jobs. It never edits or deletes them.

- A created job with wrong data is corrected by a person in ShopKeeper.
- No automatic rollback, delete, or edit of committed jobs.
- If a job is deleted in ShopKeeper and needs to be re-created, an admin
  resets the line (audited), and it goes back to `ready`.

---

## 13. Out of scope for Phase 2

- Price lookup, contract pricing, price matrices
- Multi Job Entry and batch reservation
- Routing / `OpStatus` creation, holiday and lead-time scheduling
- Traveler printing, report printing, UI automation
- Shipping, ship numbers (`SystemID`), `JobShipMaster`
- Creating customers or parts
- BOM and kit jobs (`Jb_JobMasterLink`), until a separate trace exists