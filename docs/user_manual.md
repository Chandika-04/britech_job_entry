# Britech Job Entry: User Guide

## What this app does

Job Entry turns a customer's purchase order (PO) into ShopKeeper jobs:

1. You upload a scanned or digital PO as a PDF.
2. The app reads the PO and fills in the header fields and each line item.
3. You check what it read against the original PDF, fix anything wrong, and confirm it.
4. You match the PO to an existing ShopKeeper customer, and each line to an existing ShopKeeper part.
5. You create **one ShopKeeper job per PO line**.

The app **never creates customers or parts** in ShopKeeper. If a customer or part is missing, add it in ShopKeeper first and then come back.

Open the app in a browser on the warehouse PC, or on a phone on the shop Wi-Fi, at `http://Shipping-Bri:8000`.

---

## 1. Uploading a PO

1. Click **Upload PO** in the top-right corner, or open the **Upload** tab.
2. Drag the PDF into the box, or click the box to choose a file.
3. Click **Upload and extract**.

**Tips**

- **Paper POs:** scan them with Genius Scan, Adobe Scan or Microsoft Lens and save the result as a PDF.
- **Limits:** PDF only, up to **15 MB** and **10 pages**.
- **Multi-page POs:** upload all the pages in one PDF. If you upload only page 1 of a multi-page PO, the app warns you that lines may be missing.

After you upload, the review page opens with the message *"Extracting purchase-order information…"*. This usually takes 5 to 15 seconds, and the page updates by itself when it's done.

---

## 2. The Purchase Orders tab (dashboard)

This tab lists every PO that has been uploaded.

| Column | Meaning |
|---|---|
| **PO #** | The customer's PO number. Click the row to open the PO. |
| **Customer** | The customer name read from the PO. |
| **Uploaded** | When the PDF was uploaded. |
| **Pages** | Number of pages in the PDF. |
| **Extraction** | **Extracting**: still reading the PDF. **Extracted**: ready to review. **Failed**: couldn't be read (open it to retry). |
| **Review** | **Unreviewed**: someone still needs to check it. **Confirmed**: checked and approved. |
| **Jobs** | **Complete**: every line has a ShopKeeper job. **Incomplete**: at least one line doesn't, including lines you skipped. The number shows jobs created out of total lines, for example `4/6`. |
| **Flags** | **Duplicate**: this PO number was already entered for the same ShopKeeper customer. **Stale**: extraction seems stuck. **N warn**: the number of review warnings. |

**Search and sort:** type a PO number or customer name and press **Enter** (or click **Search**). Use the drop-down to sort by date, PO number, customer or status.

---

## 3. Reviewing a PO

The review page shows the **original PDF** on the left and the **fields the app read** on the right, so you can compare them side by side.

### The PDF viewer

- Use the arrows to change pages, or click a page thumbnail.
- Use **zoom out / zoom in** to change the size, and the circular arrow to reset it.
- The arrow-out-of-box icon opens the original PDF in a new browser tab.

### Warnings

A yellow **Review warnings** box lists anything the app is unsure about. Examples are missing pages, handwriting it couldn't read, a missing quantity, or notes from the extraction such as "no unit price shown on this PO". Read these warnings before confirming.

### PO information

The header fields are grouped into **Order**, **Customer**, and **Addresses & notes**. Check each field against the PDF and correct anything that's wrong.

### Line items

Each line of the PO is one row in the table: line number, part number, revision, description, quantity, unit, unit price and due date.

- Click any cell to edit it.
- Click the speech-bubble icon on a row to add or view **notes** for that line.
- Click the trash icon to delete a line that the app added by mistake.
- Click **Add line** to add a line the app missed.

Each line should match the PO exactly. **One line becomes one ShopKeeper job.**

**How the app fills in line items**

| Field | Rule |
|---|---|
| **Qty** | The quantity exactly as stated on the PO, including lot lines (sometimes 1, sometimes the real piece count). **0 means the PO didn't state a quantity**: check the PO and enter the right number. A job can't be created with 0. |
| **Unit** | **Each** or **Lot** only. Lot is used when the line is priced as a lot charge. This is the unit ShopKeeper uses to apply the price. |
| **Unit price** | The price as stated on the PO. For lot-priced lines this is the lot charge; it is never divided by the quantity. Blank means the PO showed no price: enter it before creating the job. |
| **Due** | Always **today's date** (the day the PO was extracted), whatever date the PO shows. Change it here if a line needs a different date. |

**Expedite fees** become their own line (and their own job) with the part number **EXPEDITE**. If the PO shows the fee amount it's filled in; otherwise enter the amount you've calculated. When matching the part in ShopKeeper, search for the expedite part by name if **EXPEDITE** doesn't find it.

### The action bar (pinned to the bottom of the screen)

| Button | What it does |
|---|---|
| **Save draft** | Saves your edits without confirming. Use it when you need to come back later. |
| **Confirm reviewed** | Saves your edits and marks the PO as checked. This is required before you can create jobs. |
| **Re-extract** | Reads the PDF again from scratch. **This replaces all fields, including your edits**, and sets the PO back to Unreviewed. |
| **Delete** | Permanently deletes the PO and its PDF. |

> Once a PO is confirmed, changing any field sets it back to **Unreviewed**, and you'll need to confirm it again.

---

## 4. Creating ShopKeeper jobs

The **ShopKeeper jobs** section appears on the review page once extraction is finished. Jobs can only be created after the PO is **confirmed**.

### Step 1: Match the customer

The app searches ShopKeeper for the customer name on the PO and suggests a match. It ignores differences such as "Inc.", "LLC" or "Technologies" versus "Tech".

- **Green box:** a likely match was found. Check that it's the right customer and click **Use**.
- **List of possible matches:** several customers look similar. Pick the right one and click **Use**.
- **No match:** type the customer number or company name into the search box, click **Search**, then click **Use** next to the right customer.

Leave **Apply to every line** ticked, which is the normal case, so the customer is stored on all lines at once.

The app remembers your choice. The next time a PO arrives with the same customer name, it matches that customer automatically.

Once the customer is picked, the app also checks whether the same PO number was already entered for that customer. If so, a **Duplicate** warning appears at the top of the page and on the dashboard.

> Inactive customers can't be used. If a customer is on **credit hold**, you'll be asked to acknowledge that before the job can be created.

### Step 2: Match the part for each line

The **Jobs by line** table has one row per PO line. Click a row to open its details.

1. The part number and revision from the PO are already filled in. Correct them if ShopKeeper uses a different part number.
2. Click **Find part**.
3. Click **Use** next to the correct part and revision.

When the customer and part are both set, and any warnings have been acknowledged, the line's status changes to **Ready**.

### Step 3: Create the job

Click **Create job** on a line that shows **Ready**. The ShopKeeper job number then appears in the **Job #** column and the status changes to **Created**.

Jobs are created **one line at a time**, so check each line before you click. A job needs a quantity above 0, a unit price, and a due date.

### Line statuses

| Status | Meaning |
|---|---|
| **Needs match** | The customer or part isn't set yet, or the PO isn't confirmed. |
| **Ready** | Everything is set. You can click **Create job**. |
| **Creating** | The job is being written to ShopKeeper. |
| **Created** | The job exists in ShopKeeper, and the job number is shown. |
| **Failed** | ShopKeeper rejected the job. The reason is shown in red. Fix the problem and try again. |
| **Skipped** | You chose to skip this line for now. |

### Checks you may be asked to acknowledge

- **Credit hold:** the customer is on credit hold in ShopKeeper. Click **Acknowledge credit hold** if the job should go ahead anyway.
- **Duplicate job:** ShopKeeper already has a job for this PO number and line. Choose one of:
  - **Create new job anyway**, if this really is a new order;
  - **Skip line**, if the job already exists.

---

## 5. Skipping a line and coming back to it

Sometimes a line can't be entered yet. For example, the part isn't in ShopKeeper's part master yet, or the pricing needs to be sorted out with the customer.

- **To skip:** open the line and click **Skip line**. The app never skips a line on its own; only you can.
- A PO with a skipped line stays **Incomplete** on the dashboard, so it isn't forgotten.
- **To come back:** open the PO, open the skipped line (skipped lines open automatically) and click **Un-skip line**. Fix whatever was blocking it, match the part, and click **Create job**.

---

## 6. Fixing mistakes

| Situation | What to do |
|---|---|
| A field was read wrong | Edit it on the review page, then **Confirm reviewed** again. |
| Many fields are wrong, or the wrong PDF was used | **Re-extract**, or **Delete** the PO and upload it again. |
| Extraction failed or shows **Stale** | Open the PO and click **Re-extract**. |
| "The original PDF file is missing from storage" | The PDF file was moved or deleted from the PDF folder. Tell whoever manages the warehouse PC; it can be restored from the DiskStation copy. |
| A job was created with the wrong details | Fix or delete the job **in ShopKeeper**. If you deleted it, use **Admin reset** on that line (shown only on created lines) so a new job can be created. Only do this after the job is gone from ShopKeeper. |
| Customer or part isn't found | Add or activate it in ShopKeeper, then search again here. |

> **Be careful with Re-extract and Delete.** Re-extract replaces the line items, and Delete removes the PO and its history. Neither changes jobs already in ShopKeeper, but this app will lose track of which jobs it created for that PO.

---

## 7. Quick checklist

1. Upload the PDF, including all pages.
2. Read the review warnings.
3. Check the header fields and every line against the PDF. Fix any **0** quantities, blank prices, and the **Each / Lot** unit.
4. **Confirm reviewed.**
5. Match the customer (**Use**).
6. For each line: **Find part**, then **Use**, then acknowledge any checks, then **Create job**.
7. The dashboard shows **Complete**. Any skipped line needs follow-up.
