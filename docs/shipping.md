# Shipping (steps 12–14)

**Status:** Implemented (create shipper only). Printing is out of scope for now.

**SQL source of truth:** [`references/job_entry_write_sequence.md`](../references/job_entry_write_sequence.md) §5 (Shipping) and the step table at the end of that file. Use that document whenever column names, `SystemID` concurrency, `SSMA_TimeStamp` updates, or the loop over releases are unclear. Also see [`references/table_schema.md`](../references/table_schema.md) (`SystemID`, `JobShipMaster`, `JobShip`, `JobRelease`) and the ship phase in [`references/shopkeeper_job_entry_outline.md`](../references/shopkeeper_job_entry_outline.md).

**Database:** ShopKeeper `SHOPKEEPER_EXPECTED_DATABASE` only (`SkData_Test` until we switch). Never write shipping rows into `BritechJobEntry` except the shipper number we display.

## Goal

When every line on a PO has a created ShopKeeper job (`jobs_complete`), the reviewer can create **one shipper for the whole PO**. That shipper includes **every job / PO line** on that PO. The dashboard then shows the ShopKeeper ship number on that PO’s row.

This is ShopKeeper steps **12–14** only (reserve ship number, insert `JobShipMaster`, attach each job’s `JobShip` release). Do **not** set `Jsm_ShipperPrinted`. Do **not** call Access. Do **not** generate a PDF yet.

## UI

**Where:** Purchase Orders dashboard, on each PO row (desktop table and the phone list).

**Create shipper button**

- Visible and enabled only when `jobs_complete` is true **and** this PO has no shipper number yet.
- Hidden or disabled while jobs are incomplete (including any skipped line — skipped means not created, so the PO stays Incomplete).
- Clicking the button must **not** open the review page (stop the row’s navigation).
- Confirm copy along the lines of: create one shipper for all jobs on this PO?
- While it runs, disable the button. On success, show the new ship number on that row. On failure, show the error and leave the button available to retry.

**Shipper # column (or cell on the phone list)**

- Empty (`—`) until a shipper exists.
- After success, show the ShopKeeper ship number (monospace), same idea as job # on the review page.
- Store that number on the PO in **this** app’s database so the dashboard can load it without querying ShopKeeper for every row.

**Idempotent:** one shipper per PO. If the PO already has a shipper number, do not create another. If a previous attempt wrote ShopKeeper but the save here failed, recover by looking up existing `JobShip.Sh_Ship_Num` for those job numbers (same idea as job-create recover).

## What “all jobs on this PO” means

Use the created ShopKeeper job numbers on the PO’s line items (`erp_job_number`), in line-number order.

For each job, ship **release 1** (this app always creates one release per job). Attach that job’s `JobShip` row to the new `Jsm_Ship_Num`. Quantity shipped = the line’s ordered qty (`Jb_Qty_Order` / `Sh_Qty_Due`).

Do not include lines that are not `created`. The button is not offered unless every line is created, so the set should be the full PO.

## SQL sequence (one transaction after the number is reserved)

Follow `references/job_entry_write_sequence.md` §5 exactly for the `SystemID` match (NULL-safe Prefix/Format/Suffix), the `JobShipMaster` insert before any `Sh_Ship_Num` FK, and the per-release `JobRelease` then `JobShip` updates with timestamp checks.

Keep ship-number reserve **outside** the rest of the transaction and commit it immediately (same rule as job numbers). Then, in one transaction:

1. **Step 12 — `SystemID`**
   `Code = 'ShipNum'`. Read `[Next Number]`, Prefix, Format, Suffix. Update `[Next Number] = @Next + 1` matching those columns, using `IS NULL` safe compares. Format the ship number as Prefix + (zero-pad to Format length when Format is zeros) + Suffix. Retry a few times if two people reserve at once.

2. **Step 13 — `JobShipMaster` INSERT**
   Required: `Jsm_Ship_Num`. Set `Jsm_ShipVia` from the ShopKeeper customer `shipped_via` already stored on the lines. Set `Jsm_ShipBy` from `salesman`.
   `Jsm_Status = 'S'`. `Jsm_ShipperPrinted = 0`.

3. **Step 14 — for each job on the PO**
   Re-read `SSMA_TimeStamp` on `JobRelease` and `JobShip` immediately before each update.
   - `JobRelease`: `Jr_Complete = 1`, `Jr_CloseDate = @ShipDate` for `(Jr_JobNum, Jr_ReleaseNum = 1)`.
   - `JobShip`: `Sh_Ship_Date`, `Sh_Qty_Shipped`, `Sh_Ship_Num`, `Sh_Status = 'S'`.
   `@ShipDate` = today (date only), same convention as job due dates.

4. **This app:** save `shipper_number` on `po_request`. Audit the write (`erp_write_audit`: action `create_shipper`).

5. **Step 15 — skip.** Do not set `Jsm_ShipperPrinted`.

**LockInfo:** `Lk_Form = 'Jobs'`, `Lk_ID` = ship number, `Lk_Initials = 'AUTO'`, `Lk_Comment = 'Shipper via Automation'`.

## Gates

**This app (must enforce)**

- PO extracted and confirmed.
- `jobs_complete` (every line `erp_status = created` with a job number).
- No shipper number on the PO yet (unless recovering a half-finished write).
- Same ShopKeeper database check as job create (`DB_NAME()` must match `SHOPKEEPER_EXPECTED_DATABASE`).

**ShopKeeper holds (do not block v1)**
The real ShopKeeper ship screen checks quality/FA/ship/credit holds, incomplete operations, and open RMA. v1 **does not** require routing to be complete and **does not** block on those holds. The button means “all jobs for this PO were created in Job Entry.”

## Failure

If step 13/14 fails after a ship number was reserved, leave that number unused (acceptable, same as skipped job numbers). Do not write a `JobShipMaster` without attaching every job. If some jobs were updated and others were not, fail loudly and do not save a shipper number on the PO — operator retries or fixes in ShopKeeper.

Never edit or delete an existing ShopKeeper shipper from this app.

## Tests

Fake ShopKeeper: given a PO with two created jobs, create-shipper reserves one ship number, inserts one master, updates both jobs’ ship lines, stores the number on the PO. Second click is rejected. Incomplete PO (one line not created) is rejected. Tests do not call Access or build a PDF.

## Out of scope

- Traveler print (steps 10–11)
- Routing / `OpStatus` (steps 7–9)
- Editing or voiding shipments
- Creating customers or parts
- Live ShopKeeper database until `SHOPKEEPER_EXPECTED_DATABASE` is changed on purpose

<!--
## Printing (later — not this phase)

Rebuild a packing-slip PDF from a ShopKeeper Print-to-PDF or scan, filled from
Jobs / Customers / JobShip / JobShipMaster. After the PDF is written, set
Jsm_ShipperPrinted = 1 (step 15). Do not use Access COM (compiled front-end).

Until this section is implemented, shipper documents are produced in ShopKeeper
by a person if the floor still needs paper.
-->
