# Operations, traveler, certification, job page, and part editor

**Status:** Implemented. Traveler and certification PDFs follow the ShopKeeper samples in [`references/`](../references/) (SK066 traveler, SK064 COC). Schema checked on `SkData_Test` (2026-10-06). Product answers locked 2026-10-06.

**SQL source of truth:** this file for table names and links that were verified live; [`references/job_entry_write_sequence.md`](../references/job_entry_write_sequence.md) §3 step 7 and §4 steps 10–11; [`references/table_schema.md`](../references/table_schema.md) for `OpStatus` / `JobRelease` / `LockInfo` write rules.

**Database:** ShopKeeper `SHOPKEEPER_EXPECTED_DATABASE` only (`SkData_Test` until we switch). Parts, routing, templates, pictures, certs, and holds live in ShopKeeper. Do not copy those rows into `BritechJobEntry`. Picture **files** live on the PartPhotos share (see Pictures).

**Do not** call Access COM. **Do not** use the compiled ShopKeeper front-end to print.

This app still **does not create new customers**. **New parts** are created from the Parts tab (`INSERT dbo.PartMaster`, `Pm_MasterType = 'Production'`). The part editor also updates an existing part (`Pm_LinkID`).

---

## Locked decisions

1. **One button on the PO line: Create job and print.** There is no separate Create job. Clicking it always creates the ShopKeeper job (steps 1–7). It prints only when the **job** has operations and (if cert is required) the **part** has a linked certification. Printing a blank traveler or a cert-required job with no cert is a waste of paper.
2. **No job operations after create → warning popup → job page.** The job is still created. Continue opens `/jobs/:jobNumber`. Add steps manually or **replace** routing from an in-house template. Print stays off until there is at least one `OpStatus` row.
3. **Cert required but no certification on the part → warning popup → part editor.** The job is still created. Nothing is printed. Continue opens `/parts/:pmLinkId` so the reviewer can link a certification (and fix picture, part ops, or quality hold). Print stays off until a certification is linked (or cert is not required).
4. **Template copy on a job replaces that job’s routing.** Copying a service template replaces that job’s `OpStatus` rows. It does not append. It does **not** change Part Master `OpMaster`. The next job for that part will warn again until someone edits the part’s operations (by hand on the part editor).
5. **Rebuild PDFs in this app** and open the **browser print dialog** so the reviewer can choose a printer, copies, and other print details. After the print PDF is generated, set ShopKeeper steps 10–11. No Access. Print does **not** require `WAREHOUSE_PRINTER_NAME`.
6. **Print traveler and certification** when cert is required and a certification is linked on the part. The PO line **Cert** checkbox (`Jb_Cert_Required`) only means a cert **must** print. The wording comes from `CertificationText` via `CertificationItems`.
7. **Full part editor:** part number, rev (default `-`), customer code, description, pictures, **part** operations (`OpMaster`), certification links, and quality hold. Available from the **Parts** tab (search / new / edit), **before** job create (link next to **Use part** on review/manual), **and** after create (job page / cert-missing popup). Price matrix is a placeholder.
8. **After a skipped print, they click Print on the job page.** Do not auto-print when ops/cert later become valid. No Print button on the part editor.
9. **Work center on add/edit op** is a dropdown of ShopKeeper work centers (EP, PASN, QC, …), not free text.
10. Print layouts follow the ShopKeeper samples in [`references/`](../references/): traveler **SK066 Rev C**, certification **SK064 Rev B**.

If **both** job operations and certification are missing after create: job is still created; popup lists both; go to the **job page** first. Print stays disabled until both are fixed. The job page links to the part editor when cert is missing.

**Assumed unless you change them:** print all linked certs in `CItm_OrderNum` order; print all pictures with `Pmp_PrintOnTrav = 1`; quality hold is a banner only (does not block create or print); the job/part screens show op notes as **plain text**. ShopKeeper still stores `Om_Note` / `Os_Note` as HTML (`<div><font face="Arial">…</font></div>`), and traveler print renders that HTML.

---

## Verified ShopKeeper layout (`SkData_Test`)

### Part Master — how a part is stored

`PartMaster` PK is `Pm_LinkID` (identity). Business unique key is `(Pm_PartNum, Pm_PartRev, Pm_MasterType)` index `PartMaster$Pm_PartRevIdx`.

Live snapshot: **29,297** parts, **every** row `Pm_MasterType = 'Production'`. No duplicate `(PartNum, Rev)` with a second master type. Missing revision on the PO is stored as rev **`-`** in ShopKeeper (common). Lookup in this app already uses part + rev; that is enough in this database.

This app already stores `resolved_pm_linkid` = `Pm_LinkID` and writes it to `JobRelease.Jr_PartMasterLink`. All part child tables hang off `Pm_LinkID`.

Relevant child tables (FK to `Pm_LinkID`):

| Table | Role for this feature |
|---|---|
| `OpMaster` | Standard routing copied onto **new jobs** |
| `PartMasterPics` | Traveler pictures (`Pmp_PictureName` UNC path) |
| `CertificationItems` | Links this part to `CertificationText` |
| `PartMasterPriceMatrix` | Price lookup (already used) — not edited here |
| BOM / raw / tube / sheet / process-planning tables | Out of scope |

Holds on the part row: `Pm_QualityHold` (23 rows set), `Pm_FAHold` (1), `Pm_ShipHold` (0), `Pm_Locked` (0). Also `Pm_QualityHoldNote`. v1 **edits quality hold** only; show FA/ship as read-only.

Active parts **without** any `OpMaster` rows: **~2,795 of ~29,296**. The empty-routing warning is a real path.

### Two kinds of operations (do not mix)

| Where | Table | Meaning |
|---|---|---|
| **Part editor** | `OpMaster` (`Om_PmLinkID` = `Pm_LinkID`) | Standard routing for this part. **Create job and print** copies these onto a **new** job. Editing here does **not** change jobs already created. |
| **Job page** | `OpStatus` (`Os_JobNum`, `Os_ReleaseNum = 1`) | This job’s routing. Manual edit or replace from a service template. Does **not** write back to `OpMaster`. |
| **Service templates** | `OpMasterMasters` + `OpMasterMasterOps` | In-house recipes (EP, passivate, LAM cleans, …). Copy onto a **job** only in v1. |

`OpStatus.Os_OMLink` is **not** an FK. Part copy sets it to `OpMaster.Om_LinkID`. Template copy may set it to `OpMasterMasterOps.Om_LinkID`.

### Part routing — `OpMaster` → `OpStatus` on create (step 7)

`OpMaster.Om_PmLinkID` → `PartMaster.Pm_LinkID` (FK). `Om_LinkID` is identity. Typical part has **4–8** ops (~23,772 active parts).

Copy in the same transaction as steps 2–6 (job-number reserve still outside), release `1`, `Os_QtyToMake` = ordered qty:

```sql
INSERT INTO dbo.OpStatus (
    Os_OMLink, Os_JobNum, Os_ReleaseNum, Os_SeqNum, Os_WCCode,
    Os_Description, Os_RunTime, Os_SetupTime, Os_Subcontract,
    Os_ProcessCode, Os_Process, Os_FA, Os_Note, Os_Qty, Os_SchedDays, Os_QtyToMake
)
SELECT Om_LinkID, @JobNum, 1, Om_SeqNum, Om_WCCode,
       Om_Description, Om_RunTime, Om_SetupTime, Om_Subcontract,
       Om_ProcessCode, Om_Process, Om_FA, Om_Note, Om_Qty, Om_SchedDays, @StartQty
FROM   dbo.OpMaster
WHERE  Om_PmLinkID = @PartMasterID
ORDER  BY Om_SeqNum;
```

`SetJr_HasOSP` fires if any copied op is subcontracted. If the SELECT copies **zero** rows, the job create still succeeds (empty-routing path).

`Om_Note` / `Os_Note` are often HTML (`<div>…</div>`). The API strips tags for the job/part screens so the table shows plain text. On save, Job Entry wraps notes in ShopKeeper-style HTML for storage and traveler print.

### Service templates — verified, usable as specified

| Table | PK | Live count |
|---|---|---|
| `OpMasterMasters` | `Omm_ID` identity | **26** headers |
| `OpMasterMasterOps` | `Om_LinkID` identity | **136** steps |

FK: `OpMasterMasterOps.Om_MmLinkID` → `OpMasterMasters.Omm_ID`. Every template has **2–10** steps (none empty).

Examples: `Electropolish` (ASTM B912, 7 steps: MATL Check → EP → Rinse → PASN → Rinse → QC → PKG), `EP-ID-OD`, several ASTM/AMS passivate methods, LAM `74-106348` methods, AMAT `0250-*`, Chem-Clean, O2 Clean.

Step columns match `OpMaster` closely enough to copy onto `OpStatus`:

`Om_SeqNum`, `Om_WCCode`, `Om_Description`, `Om_RunTime`, `Om_SetupTime`, `Om_Subcontract`, `Om_ProcessCode`, `Om_Process`, `Om_FA`, `Om_Note`, `Om_Qty`, `Om_Highlight`, `Om_SchedDays`.

Work centers on templates include `EP`, `PASN`, `CITR`, `Rinse`, `QC`, `PKG`, `CHEM`, `MATL Check`, etc.

**Yes — we can use these tables the way the spec describes:** list `OpMasterMasters` on the job page, and on confirm replace that job’s `OpStatus` from `OpMasterMasterOps WHERE Om_MmLinkID = @Omm_ID`. **Never write** the template tables.

Replace only when the job has no shop-floor children that would block delete (`ScheduledOps`, `TimeCard`, `TimeClock`, `QcInspectLog` FK to `OpStatus`). A job created seconds earlier will be empty of those.

### Pictures — not a git `docs/` folder

`PartMasterPics.Pmp_PmLinkID` → `Pm_LinkID`. `Pmp_PictureName` is a **UNC path**, not a filename-only key.

Dominant roots on `SkData_Test`:

- `\\192.168.7.68\PartPhotos\…` (~11.5k)
- `\\DISKSTATION\PartPhotos\…` (~1.3k, newer)
- plus old `temp-part-pics` and a few local `C:\` paths

Most rows have `Pmp_PrintOnTrav = 1`. `PictureRawData` is only three tiny placeholders (`blank.png`, `file-not-found.png`, `no-image.png`) — not the part photo store.

**Link a picture:** pick a file that is **already** on the PartPhotos share (configurable, default `\\DISKSTATION\PartPhotos`). Do **not** copy or rename it. INSERT `PartMasterPics` with `Pmp_PictureName` = that existing UNC path and `Pmp_PrintOnTrav = 1`. Match ShopKeeper, not the git `docs/` tree.

Do not store image blobs in SQLite / `BritechJobEntry`.

### Certification — linked on the part, not the job

| Table | Role |
|---|---|
| `CertificationText` | Library of cert wording. PK `CTxt_ID` nvarchar(30), e.g. `EP B912-13`. Body `CTxt_Text` (HTML). **41** texts. |
| `CertificationItems` | Join: `CItm_PMLinkID` → `Pm_LinkID`, `CItm_LinkID` → `CTxt_ID`, `CItm_OrderNum`. **2,053** links; **2,042** active parts have at least one; almost always **one** cert per part (10 parts have two). |
| `CertificationMasters` | 6 sparse rows (spec codes). Not the link table for v1. |
| `CertificationTypeList` | Trace types (heat treat #, material trace). Not part COC text. |
| `JobCertifications` | Rare scanned files on a job (`Jct_Filename` UNC). **Not** how we link COC wording. Out of scope for v1 print unless examples show otherwise. |

**Link a cert in the part editor:** INSERT `CertificationItems` (`CItm_PMLinkID`, `CItm_LinkID` = chosen `CTxt_ID`, `CItm_OrderNum`). Unlink: DELETE that items row. Do not rewrite `CertificationText` in v1 (pick from the 41 existing texts).

**Has certification** for print: cert required is false, **or** `CertificationItems` has a row for this `Pm_LinkID`.

Active parts **without** a cert link: **~27,254**. The cert-missing popup is the common case when the line **Cert** box is on.

---

## Create job and print (PO line)

Enabled when today’s Create job would be enabled.

**Always, on click:** create the job (steps 1–7), including `OpMaster` copy when rows exist. Then inspect `OpStatus` count and part cert links.

| Result | Print? | UI |
|---|---|---|
| ≥ 1 job op, and (cert not required **or** cert linked) | Yes: traveler PDF and, if cert required, certification PDF, saved printer, then steps 10–11 | Stay on the PO |
| 0 job ops | No | Popup → `/jobs/:jobNumber` |
| ≥ 1 job op, cert required, no `CertificationItems` | No | Popup → `/parts/:pmLinkId` |
| 0 job ops **and** cert required with none linked | No | Popup lists both → job page first |

Print failure after create: keep the job; do **not** set `Jr_TravelerPrinted`. Retry from the job page.

After the line is **created**, do not show **Create job and print** again. Show the job number as a link to `/jobs/:jobNumber`. **Print** lives on the job page when gates pass (they click it; it does not run automatically).

---

## Job page

**Route:** `/jobs/:jobNumber`

Header: **Job #** and **Ship #** read-only on a blue bar. Two-column form: Customer, PO#, Line#, Date (`Jb_Order_Date`); Part# + Rev, Desc., Qty / Price / Unit, Certification checkbox (`Jb_Cert_Required`) + read-only **Total** (Each = qty × price, Lot = price). **Job Notes** (`Jb_Note`) is full width and prints on the traveler. A **Part image** card sits to the right: traveler picture from `PartMasterPics` when the file can be served; the stored path if the file cannot be displayed; a “no image available” placeholder when none is linked. Due date is not on this form; save leaves `Sh_Due_Date` / `Jr_FirstDueDate` unchanged. Writes `Jobs` + `JobShip` + `JobRelease` with `SSMA_TimeStamp` checks; LockInfo `AUTO` / `Job update via Automation`. Customer and part must already exist in ShopKeeper. If `JobShip.Sh_Ship_Num` is already set, confirm before save; on confirm also set `Sh_Qty_Shipped` (and `Sh_Qty_Due`) to the new qty. Cert linked stays a read-only status (link/unlink certs on the part editor). Quality hold if set.

**Operations:** spreadsheet of `OpStatus` release 1, order `Os_SeqNum`. Columns: seq, work center (**dropdown** from ShopKeeper work centers), description, **notes (plain text; HTML only in ShopKeeper / print)**, run, setup, OSP, FA. Add / edit / delete. `SSMA_TimeStamp` on save. Never set `Os_Status = 'C'`.

**Copy instructions:** copies this part’s `OpMaster` rows onto the job (`Os_OMLink` = `Om_LinkID`). Confirm replace. Same delete/insert as template copy. Errors if the job has no `Jr_PartMasterLink` or the part has no operations. Does **not** change `OpMaster`.

**Copy from template:** list `OpMasterMasters` (`Omm_Code`, `Omm_Description`, sort `Omm_Sort`). Confirm replace. Delete this job’s release-1 `OpStatus`, then INSERT from `OpMasterMasterOps` where `Om_MmLinkID = Omm_ID`. One transaction.

**Print:** button on this page only. Same gates as a successful create-and-print. Returns a combined traveler (and certification, if required) PDF and opens the browser print dialog, then steps 10–11. Disabled until those gates pass.

**Office only — delete job:** **Delete ShopKeeper job** runs ShopKeeper’s traced Delete Job: refuse if locked, kitted, shipped qty, on a shipper (`Sh_Ship_Num` set — this app does not unlink), time clock/card, scheduled ops, QC inspect, PO line items, printed traveler, or serials; then `DELETE OpStatus` → `DELETE JobRelease` → `DELETE Jobs` (JobShip rides the Jobs cascade; if SQL 547, `DELETE JobShip` then Jobs); `LockInfo` after commit (`Lk_Form='Jobs'`, `Lk_Initials='AUTO'`, `Lk_Comment='Delete Job'`). Do not reuse `SkMaster` job numbers. After SK delete, this app’s line is cleared the same way as **Clear job from this app** (`reset_erp`). **Clear job from this app** still exists and does **not** write ShopKeeper.

---

## Part editor

**Route:** `/parts/:pmLinkId`

Opened from: **Use part** / matched part on review and manual entry (**before** create), cert-missing popup, and the job page. Same editor either way. Saving part ops does not rewrite jobs that already exist.

Header: part # and rev **read-only**. If `Pm_Locked`, show and refuse writes.

### Picture

Show current `PartMasterPics` (file from the UNC path). **Link picture:** pick a file already on the configured PartPhotos share and INSERT `PartMasterPics` with that path (`Pmp_PrintOnTrav` default on). Do not copy the file. Unlink: delete the pics row (do not require deleting the file in v1). Traveler uses `Pmp_PrintOnTrav = 1`.

### Operations (part standard routing)

Edit `OpMaster` for this `Pm_LinkID`. Add / edit / delete. This is what the **next** Create job and print copies. Banner: saving part ops does **not** rewrite existing jobs. Fix those on the job page.

### Certificates

Choose a certification from a dropdown of `CertificationText`. Linked certs show with Unlink. Writes `CertificationItems`. Show whether the current job would be allowed to print a cert.

### Quality check hold

Toggle `Pm_QualityHold` (optional note `Pm_QualityHoldNote`). `SSMA_TimeStamp` on `PartMaster`. Show `Pm_FAHold` / `Pm_ShipHold` read-only.

---

## Print

Rebuild PDFs here. Layouts match [`references/travelerexample.pdf`](../references/travelerexample.pdf) (SK066) and [`references/COCexample.pdf`](../references/COCexample.pdf) (SK064). Shipper print is still out of scope (`docs/shipping.md`).

**Traveler:** SK066 header (job #, rel 1, start/shop due, make-to-order qty, PO/part/rev, **customer code** for Customer and Ship To, deliveries without Total Shipped / Balance). Job notes print in **(S1) Int Note**. Ops use seq, work center, description, Code 39 barcode of the job number, and an empty qty grid (no start-by dates). `PartMasterPics` with `Pmp_PrintOnTrav` in the top-right picture box.

**Certification:** SK064 letterhead and “This is to Certify…” block. Linked certs print `CertificationText.CTxt_Text` (HTML stripped, no checkbox); customer ship-to address from ShopKeeper `Customers`.

**Print dialog:** in-app box (Print traveler, Print certification, Print preview or Print). Traveler and certification are separate PDFs / print jobs so duplex stays traveler front-and-back. Traveler is padded to an even page count. Preview does not mark the traveler printed. Print uses the browser print dialog (no leftover tab).

**SQL after printing the traveler (not preview):** `Jr_TravelerPrinted = 1` (timestamp check); `LockInfo` `Lk_Form = 'Jobs'`, `Lk_ID` = job number, `Lk_Initials = 'AUTO'`, `Lk_Comment = 'Rel# 1 - Printing Traveler'`.

Do not set the printed flag if the traveler did not print. Do not print when job ops = 0 or when cert is required and none is linked.

---

## Gates

**Create half** — same as today’s Create job, plus `resolved_pm_linkid` required.

**Print half** — job exists; ≥ 1 `OpStatus` row; if cert required, ≥ 1 `CertificationItems` for the part; saved printer configured.

**Part editor** — part exists; same SK database check; `Pm_Locked` blocks writes.

**Job template replace** — job exists; UI confirm; template has ≥ 1 step; no blocking `OpStatus` children.

---

## Failure

Step 7 failure after 2–6 in the same transaction: roll back 2–6.

Template replace / part-`OpMaster` rewrite: one transaction; no mixed old/new steps.

Picture copy failure: do not insert `PartMasterPics`. Print failure: leave `Jr_TravelerPrinted` unchanged.

Never write `OpMasterMasters` / `OpMasterMasterOps`. INSERT `PartMaster` only from the Parts tab create (unique `(Pm_PartNum, Pm_PartRev, Pm_MasterType)`; rev default `-`; `Pm_LeadTime = 0`). Never rewrite `CertificationText` in v1.

---

## Tests (fake ShopKeeper)

- Part with `OpMaster` rows: create copies N job ops; print if cert OK.
- Part with no `OpMaster`: job created, zero ops, **no print**, UI goes to job page.
- Cert required, no `CertificationItems`, ops present: job created, **no print**, UI goes to part editor.
- Both missing: job created, no print, both reasons, job page first.
- Job page: GET job; PUT header (price/qty/cert/part/customer/PO/date/notes); PUT ops; template replace from fake `OpMasterMasters`; empty template no-op; office **Delete ShopKeeper job** (`DELETE /api/jobs/{job}`) and **Clear job from this app** (`reset-erp`).
- Part editor: list/search Parts tab; create Production `PartMaster`; edit header (number/rev/customer/description); toggle `Pm_QualityHold`; edit `OpMaster`; link an existing PartPhotos file (no copy); link/unlink `CertificationItems`. Existing job `OpStatus` unchanged when `OpMaster` changes. Duplicate part+rev is 409.
- Print with ops (and cert when required): fake printer; `Jr_TravelerPrinted` + LockInfo. Zero ops or missing cert: no print.
- Delete ShopKeeper job: after create, job and ops are gone, line is `ready`, LockInfo `Delete Job`. Refuse if on a shipper or traveler printed. `reset_erp` still does not write ShopKeeper.

---

## Out of scope (first cut)

- Steps 8–9 scheduling
- Completing job ops / Taco Board / `ScheduledOps`
- Creating new customers
- Editing template **definitions** (`OpMasterMasters` / `OpMasterMasterOps`)
- Editing `Pm_FAHold` / `Pm_ShipHold`
- `JobCertifications` file attachments
- Access COM
- Shipper PDF (`docs/shipping.md`)
- Pixel-perfect Crystal Reports clones (week-code table, planner, Access print user)
- Blocking **Create shipper** on `Pm_QualityHold`

---

## Suggested implementation order

1. Step 7 on create; single **Create job and print** that does not print when job ops = 0 or cert is missing; API returns those reasons.
2. Job page: `OpStatus` edit, links, popup redirect.
3. Copy-replace from `OpMasterMasters` / `OpMasterMasterOps`.
4. Part editor: quality hold, `OpMaster`, PartPhotos link + `PartMasterPics`, `CertificationItems` link.
5. Traveler + cert PDFs from shop examples; saved printer; steps 10–11. **Done** for traveler (SK066) and COC (SK064). Shipper print still waits on packing-slip work.
