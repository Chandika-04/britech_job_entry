# Britech Job Entry: User Guide

## What this app does

Job Entry turns a customer's purchase order (PO) into ShopKeeper jobs:

1. You upload a scanned or digital PO as a PDF, **or** you enter the PO by hand when there is no usable PDF.
2. For uploads, the app reads the PO and fills in the header fields and each line item.
3. You check the fields, fix anything wrong, and confirm it.
4. You match the PO to an existing ShopKeeper customer, and each line to an existing ShopKeeper part.
5. You create **one ShopKeeper job per PO line** with **Create job and print**. When the job has operations and, if needed, a linked certification, a print box lets you choose traveler, certification, and print preview or print. Traveler and certification print as separate jobs.

The app **never creates customers** in ShopKeeper. If a customer is missing, add it in ShopKeeper first. **New parts** are added on the **Parts** tab.

Open the app in a browser on the warehouse PC, or on a phone on the shop Wi-Fi, at `http://Shipping-Bri:8000`.

**Prepared by:** click **Set initials** in the top-right and enter your initials. This browser keeps them and uses them on every shipper you create until you change them. They are not a password.

---

## 1. Uploading a PO

1. Click **New PO**, then **Upload a PDF**.
2. Drag one or more PDFs into the box, or click the box to choose files. **Each file is a separate PO.**
3. Click **Upload and extract**.

**Tips**

- **Paper POs:** scan them with Genius Scan, Adobe Scan, or Microsoft Lens and save **one PDF per PO**.
- **Several POs at once:** select or drop all the PDFs together. Extraction runs in the background. After more than one uploads, the **Work list** opens so you can review them as they finish.
- **One PO:** after upload, that PO's review page opens.
- If a file fails, the ones that worked are kept. The failed names stay on the upload page so you can retry.
- **Limits:** PDF only, up to **15 MB** and **10 pages** per file.
- **Multi-page POs:** put all pages of the same PO in one PDF. If you upload only page 1 of a multi-page PO, the app warns you that lines may be missing.

A single upload usually takes a few seconds to appear, then 5 to 15 seconds to extract. The review page (or the list, for a batch) updates by itself when extraction is done.

---

## 2. Manual entry

Use this when there is no usable PDF (phone call, email, handwritten note).

1. Click **New PO**, then **Type it in**. A blank form opens. Nothing is saved yet.
2. **Match the ShopKeeper customer** at the top of PO information: type a customer number or company name. Matches that **start with** what you typed appear as you type. Press **Enter** to take the first match, or click the row. That fills customer name, bill-to, and ship-to, then moves to **PO #** (dates default to today).
3. On each **line**, type a part number (and rev if you want). Matching ShopKeeper parts that **start with** that number appear as you type. Press **Enter** to take the first match, or click the row. That fills part number, revision, and description, then moves to qty. Press **Enter** in any other field to keep what you typed and move to the next field. Unit price is stored as US dollars (`$0.00`). Click **Add line** for more — **Save** copies the ShopKeeper customer from the other lines.
4. Click **Save** when you want it on the work list. That also marks it checked so ready lines can **Create job**.
5. Optional **Look up a past price** after the customer and part are chosen. It shows contract and matrix prices, then a scrollable list of ShopKeeper jobs and proposals, **newest first**, each with a date. Click a price row, then **Save** again if you want to keep it.
6. Set **Cert** if needed (customer default, then per line or **Certs for all lines**).
7. **Create job and print** on each ready line. If the job has no operations, a warning opens the job page so you can add steps or copy a template. If a certificate is required but the part has none, the warning opens the part editor so you can pick a certification from the dropdown. Print from the job page after you fix it.

The same checks as PDF review apply: quantity above 0, a unit price, a due date, credit hold, and a duplicate ShopKeeper job for the same customer, PO number, and part. You can skip a line and come back. After every job is created, **Create shipper** on the work list works the same as for uploaded POs. If you add a line after that shipper exists, create the extra job, then use **Add to shipper**.

Manual entries show **Typed in** in the Status column. They have no PDF, so there is no Read PDF again.

---

## 3. The Work list tab

This tab lists every PO that has been uploaded or typed in **this app**. Unfinished work is listed first. It is not the list of all jobs in ShopKeeper.

| Column | Meaning |
|---|---|
| **PO #** | The customer's PO number. Click the row to open the PO. |
| **Customer** | The customer name read from the PO. |
| **Entered** | When the PO was uploaded or first saved. |
| **Pages** | Number of pages in the PDF. |
| **Status** | **Reading PDF**: still extracting. **Ready to check**: fields are filled. **Couldn't read**: open it to retry. **Typed in**: entered by hand, no PDF. |
| **Check** | **Needs check**: someone still needs to verify it. **Checked**: marked correct. |
| **Jobs** | **Jobs done**: every line has a ShopKeeper job. **Jobs open**: at least one line doesn't, including skipped lines. The number shows jobs created out of total lines, for example `4/6`. |
| **Shipper** | Empty until every job is created. Then **Create shipper** makes one ShopKeeper shipper for all jobs on that PO and shows the ship number. Set **Prepared by** (your initials) in the top-right first; this browser keeps them for later shippers until you change them. If you create another job on that PO later, **Add to shipper** turns blue until that job is on the same shipper. Clicking the button does not open the PO. |
| **Flags** | **Duplicate**: this PO number was already entered for the same ShopKeeper customer. **Stuck**: extraction seems stuck. **N warnings**: the number of review warnings. |

**Search and sort:** type a PO number or customer name and press **Enter** (or click **Search**). The default sort is **Needs attention first**. You can also sort by date, PO number, or customer.

The list updates by itself every few seconds while this tab is in front. If you switch away and come back, it refreshes immediately. It does not keep requesting in the background.

---

## 4. The ShopKeeper jobs tab

This tab lists **jobs already in ShopKeeper**. It is not the work list of PDFs uploaded in this app.

1. Open **ShopKeeper jobs**. The newest jobs appear first.
2. Choose what to search by: **PO #** (default), **Part number**, **Job number**, or **Customer**.
3. Type the value and press **Enter** (or click **Search**).
4. Optional: click **Group by PO** to list one row per customer and PO number instead of individual jobs. Searching still finds matching jobs, then shows the whole PO those jobs belong to.
5. Click a **PO #** to open a summary of every job on that purchase order for that customer. Click a **Job #** to open that ShopKeeper job. **Job #** and **Ship #** are on the blue bar. The part image sits to the right of the job details. If the part has no picture, the placeholder is shown; if a picture is linked but cannot be opened, the saved file path is shown instead. Edit customer, PO, line, date (when the job was entered), part, qty, price, unit, **Certification**, and **Job Notes**, then **Save job details**. **Total** is qty × price for Each, or just the price for Lot. Job notes save to ShopKeeper and print on the traveler. If a shipper already exists, the app asks you to confirm; confirming also updates that shipper’s quantity to match. Print, **Copy instructions** (from the part master), templates, and the operations table are below. Step notes show as plain text; ShopKeeper still stores them as HTML for the traveler.
6. Use **Previous** / **Next** at the bottom of the page to move 300 jobs (or purchase orders) at a time.

The number in the header is the job count, or the purchase-order count when **Group by PO** is on. **Status** is the ShopKeeper ship-line status (`S` shipped, `I` invoiced). Blank means it has not shipped yet. A **Shipper** number opens that shipper. Jobs without a PO number are grouped together for that customer as **(no PO number)**.

---

## 5. The Shippers tab

This tab lists **shippers already in ShopKeeper**. It is not the work list, and it does not create shippers. Create and add jobs to a shipper from the **Work list** after the PO’s jobs exist.

1. Open **Shippers**. The newest shipper numbers appear first.
2. Choose what to search by: **Shipper #** (default), **PO #**, **Job number**, or **Customer**.
3. Type the value and press **Enter** (or click **Search**).
4. Click a **Shipper #** to see the jobs on that shipper. **Prepared by** is the initials stored on the shipper in ShopKeeper (`Jsm_ShipBy`). Click a **Job #** to open the job. If a shipper is **invoiced** (`I`), a warning says it cannot be unlinked or deleted here.
5. Use **Previous** / **Next** to move 300 shippers at a time.

**Status:** `S` = shipped, `I` = invoiced.

---

## 6. The Parts tab

This tab is the ShopKeeper **part master**. Search existing parts, open one to edit it, or create a new Production part.

1. Open **Parts**. The newest parts appear first.
2. Choose what to search by: **Part number** (default), **Customer**, or **Description**.
3. Type the value and press **Enter** (or click **Search**).
4. Click a **Part #** to open the part editor. Edit part number, rev (blank saves as `-`), customer code, and description, then **Save part details**. Below that: **operations** (copied onto new jobs), **traveler picture**, **certification** link, and **quality hold**. Price matrix is shown as a placeholder until pricing is standardized.
5. Click **New part** to create a part. Part number and customer code are required. Rev defaults to `-`. Description defaults to the part number if you leave it blank. After create, the editor opens so you can add operations, a picture, and a cert.
6. Use **Previous** / **Next** to move 300 parts at a time.

A part number plus revision can only exist once as a Production part. If that pair already exists, the app refuses to create or rename onto it.

---

## 7. Reviewing a PO

The review page shows the **original PDF** on the left and the **fields the app read** on the right, so you can compare them side by side.

### The PDF viewer

- Use the arrows to change pages, or click a page thumbnail.
- Use **zoom out / zoom in** to change the size, and the circular arrow to reset it.
- The arrow-out-of-box icon opens the original PDF in a new browser tab.

### Warnings

If a shipper already exists for this PO, a green **Shipper created** box appears above the warnings and shows the ShopKeeper shipper number.

A yellow **Review warnings** box lists anything the app is unsure about. Examples are missing pages, handwriting it couldn't read, a missing quantity, or notes from the extraction such as "no unit price shown on this PO". Read these warnings before confirming.

### PO information

The header fields are grouped into **Order**, **Customer**, and **Addresses & notes**. Check each field against the PDF and correct anything that's wrong.

### Line items

Each line of the PO is one row in the table: line number, part number, revision, description, quantity, unit, unit price and due date.

- Click any cell to edit it. Press **Enter** to keep the value and move to the next field.
- Click the speech-bubble icon on a row to add or view **notes** for that line.
- Click the trash icon to delete a line that the app added by mistake.
- Click **Add line** to add a line the app missed. **Save** copies the ShopKeeper customer (and cert default) from the other lines, so you do not match the customer again. You still need **PO is correct**, then **Use** the part on the new line, then **Create job**.
- Under each line, type a ShopKeeper part number. Matches that **start with** what you typed appear as you type (you can still click **Find part**). Press **Enter** or click a match row to fill **Part #**, **Rev**, and **Description** from ShopKeeper. You can still edit those fields after.

Each line should match the PO exactly. **One line becomes one ShopKeeper job.**

**How the app fills in line items**

| Field | Rule |
|---|---|
| **Qty** | The quantity exactly as stated on the PO, including lot lines (sometimes 1, sometimes the real piece count). **0 means the PO didn't state a quantity**: check the PO and enter the right number. A job can't be created with 0. |
| **Unit** | **Each** or **Lot** only. Lot is used when the line is priced as a lot charge. This is the unit ShopKeeper uses to apply the price. |
| **Unit price** | The price as stated on the PO, shown as US dollars (`$12.50`). Press **Enter** or leave the field to format what you typed. For lot-priced lines this is the lot charge; it is never divided by the quantity. Blank means the PO showed no price: enter it before creating the job. |
| **Due** | Always **today's date** (the day the PO was extracted), whatever date the PO shows. Change it here if a line needs a different date. |

**Expedite fees** become their own line (and their own job) with the part number **EXPEDITE**. If the PO shows the fee amount it's filled in; otherwise enter the amount you've calculated. When matching the part in ShopKeeper, search for the expedite part by name if **EXPEDITE** doesn't find it.

### The action bar (pinned to the bottom of the screen)

| Button | What it does |
|---|---|
| **Save** | Saves your edits without marking the PO checked. Use it when you need to come back later. |
| **PO is correct** | Saves your edits and marks the PO as checked. This is required before you can create jobs. |

**Read PDF again** and **Delete this PO** sit below the form, not on the action bar. Read PDF again replaces all fields, including your edits, and sets the PO back to Needs check.

> Once a PO is checked, changing any field sets it back to **Needs check**, and you'll need to click **PO is correct** again.

---

## 8. Creating ShopKeeper jobs

The **ShopKeeper jobs** section appears on the review page once extraction is finished. Jobs can only be created after you click **PO is correct**. After the PO is checked, that card moves above **PO information** and **Line items**. If several lines are ready, **Create all ready lines** creates them one after another (still one ShopKeeper job per line).

### Step 1: Match the customer

The app searches ShopKeeper for the customer name on the PO and suggests a match. It ignores differences such as "Inc.", "LLC" or "Technologies" versus "Tech".

- **Green box:** a likely match was found. Check that it's the right customer and click the row.
- **List of possible matches:** several customers look similar. Click the right row (or press **Enter** in the search box to take the first one).
- **No match:** type the customer number or company name into the search box. Matches that **start with** what you typed appear as you type. Press **Enter** for the first match, or click the row.

Leave **Apply to every line** ticked, which is the normal case, so the customer is stored on all lines at once.

The app remembers your choice. The next time a PO arrives with the same customer name, it matches that customer automatically.

Once the customer is picked, the app also checks whether the same PO number was already entered for that customer. If so, a **Duplicate** warning appears at the top of the page and on the work list.

> Inactive customers can't be used. If a customer is on **credit hold**, you'll be asked to acknowledge that before the job can be created.

### Step 2: Match the part for each line

Under each line in **Line items**, the ShopKeeper part search is already filled from the extracted part number and revision.

1. Correct the search if ShopKeeper uses a different part number. Matches that **start with** what you typed appear as you type.
2. Press **Enter** for the first match, or click the correct part row. That fills **Part #**, **Rev**, and **Description** on the line. You can still edit those fields.

When the customer and part are both set, and any warnings have been acknowledged, the line's status changes to **Ready**.

### Step 3: Create the job

Click **Create job** on a line that shows **Ready**. The ShopKeeper job number then appears in the **Job #** column and the status changes to **Created**.

Jobs are created **one line at a time**, so check each line before you click. A job needs a quantity above 0, a unit price, and a due date.

When you pick the customer, each line’s **Cert** box follows that customer’s ShopKeeper default. Use **Certs for all lines** if the whole PO needs certificates, or change one line if it is different. That flag is written to ShopKeeper when the job is created.

### Line statuses

| Status | Meaning |
|---|---|
| **Match needed** | The customer or part isn't set yet, or the PO isn't checked. |
| **Ready to create** | Everything is set. You can click **Create job**. |
| **Creating** | The job is being written to ShopKeeper. |
| **Job made** | The job exists in ShopKeeper, and the job number is shown. |
| **Failed** | ShopKeeper rejected the job. The reason is shown in red. Fix the problem and try again. |
| **Skipped** | You chose to skip this line for now. |

### Checks you may be asked to acknowledge

- **Credit hold:** the customer is on credit hold in ShopKeeper. Click **Acknowledge credit hold** if the job should go ahead anyway.
- **Duplicate job:** ShopKeeper already has a job for this customer, PO number, and part. Choose one of:
  - **Create new job anyway**, if this really is a new order;
  - **Skip line**, if the job already exists.

---

## 9. Skipping a line and coming back to it

Sometimes a line can't be entered yet. For example, the part isn't in ShopKeeper's part master yet, or the pricing needs to be sorted out with the customer.

- **To skip:** open the line and click **Skip line**. The app never skips a line on its own; only you can.
- A PO with a skipped line stays **Jobs open** on the work list, so it isn't forgotten.
- **To come back:** open the PO, open the skipped line (skipped lines open automatically) and click **Un-skip line**. Fix whatever was blocking it, match the part, and click **Create job**.

---

## 10. Fixing mistakes

| Situation | What to do |
|---|---|
| A field was read wrong | Edit it on the review page, then **PO is correct** again. |
| Many fields are wrong, or the wrong PDF was used | **Read PDF again**, or **Delete this PO** and upload it again. |
| Extraction failed or shows **Stuck** | Open the PO and click **Read PDF again**. |
| "The original PDF file is missing from storage" | The PDF file was moved or deleted from the PDF folder. Tell whoever manages the warehouse PC; it can be restored from the DiskStation copy. |
| A job was created with the wrong details | Open the job and **Save job details** (price, qty, date, notes, cert, part, customer, PO). Job number and shipper number cannot be changed here. If a shipper already exists, confirm the warning; the shipper quantity is updated too. Office only: **Delete ShopKeeper job** removes the job in ShopKeeper (same as ShopKeeper Delete Job) and clears it here so you can create again. It is refused if the job is on a shipper — unlink that in ShopKeeper first. **Clear job from this app** only drops this app’s job number; use it when the job is already gone from ShopKeeper. |
| A page was missed and you need another line | **Add line**, enter qty/price, **Save**, **PO is correct**, **Use** the part, then **Create job**. The ShopKeeper customer is copied from the other lines. If a shipper already exists, click **Add to shipper** on the work list after the new job is created. |
| Customer or part isn't found | Open the **Parts** tab to add the part, then search again. Customers still need to be added in ShopKeeper. |

> **Be careful with Read PDF again and Delete.** Read PDF again replaces the line items, and Delete removes the PO and its history. Neither changes jobs already in ShopKeeper, but this app will lose track of which jobs it created for that PO.

---

## 11. Quick checklist

**PDF POs**

1. Upload the PDF, including all pages.
2. Read the review warnings.
3. Check the header fields and every line against the PDF. Fix any **0** quantities, blank prices, and the **Each / Lot** unit.
4. **PO is correct.**
5. Match the customer (press **Enter** or click the row).
6. For each line: type the part (matches appear as you type), press **Enter** or click the row, then acknowledge any checks, then **Create job**. Several ready lines can use **Create all ready lines**.
7. The work list shows **Jobs done**. Click **Create shipper** on that row for one shipper covering every job on the PO. Any skipped line needs follow-up. If you add a line later and create its job, use **Add to shipper** instead of making a second shipper.

**Manual entry**

1. Open **New PO**, then **Type it in**. A blank form opens (not saved yet).
2. Type a ShopKeeper customer and press **Enter** (or click the row). That fills name and addresses, then moves to the PO #.
3. Type the part and press **Enter** (or click the row) on each line (fills part, rev, description). Press **Enter** through qty and price (price formats as `$0.00`). **Save**.
4. Optional **Look up a past price**, set **Cert**, then **Create job**.
5. **Create shipper** on the work list when every job is created. Use **Add to shipper** if that PO already has a shipper and you created a job afterward.
