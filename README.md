# Britech Job Entry

Manufacturing purchase-order extraction, human review, and ShopKeeper job creation.

The application accepts a scanned or digital PO PDF, extracts structured job information with Claude vision, and lets a reviewer correct and confirm the result. After confirmation, the reviewer matches an existing ShopKeeper customer and part, then creates one job per PO line. It never creates customers or parts, and it never edits or deletes jobs after they are written.

- **Using the app:** [docs/user_manual.md](docs/user_manual.md)
- **Installing on the warehouse PC:** [docs/warehouse_pc_setup.md](docs/warehouse_pc_setup.md)

## Production

The app runs on the warehouse PC (`Shipping-Bri`) as a single process on port 8000 that serves both the API and the built website. Data is in SQL Server Express (`BritechJobEntry` database), and PDFs are files on the PC, with a copy of each on the DiskStation. It starts at boot from a scheduled task (`scripts/run_server.ps1`). See the setup guide for installation and updates.

## Local development

Development uses SQLite, so no database server is needed.

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
copy ..\.env.example ..\.env
```

In `.env`, set at least:

```text
DATABASE_URL=sqlite:///./dev.db
ANTHROPIC_API_KEY=<your key>
PDF_STORAGE_DIR=
PDF_BACKUP_DIR=
```

Blank PDF folders mean PDFs go to `backend/storage/pdfs` with no backup copy. For testing without Claude or SQL Server, also set `EXTRACTION_PROVIDER=fake` and/or `SHOPKEEPER_PROVIDER=fake`.

If `backend/dev.db` already exists from before PDFs were stored as files, delete that file first. The next start creates a new empty database.

Run the API from the `backend` directory:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Database migrations run on startup (set `SKIP_MIGRATIONS=true` to skip them). The in-process worker picks up pending extractions and recovers jobs whose heartbeat is older than `HEARTBEAT_STALE_SECONDS`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. Open http://localhost:5173. To test from a phone on the same network, run `npx vite --host` instead and open the printed network address. (In PowerShell, `npm run dev -- --host` does not pass the flag through.)

## Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Automated tests use `FakeExtractionProvider`, `FakeShopKeeper`, and temporary SQLite databases and PDF folders. They do not call Anthropic or SQL Server.

## Workflow

1. Scan a paper PO to PDF and upload it.
2. The app extracts the header and line items. Each line's due date is set to today, and its unit to **Each** or **Lot**.
3. Review the original PDF next to the extracted fields, fix anything wrong, then **Confirm reviewed**.
4. Match the ShopKeeper bill-to customer and, for each line, the exact part and revision. The reviewer must pick each match.
5. Create one ShopKeeper job per line (or skip the line). A person then finishes routing and shipping in ShopKeeper.
6. If a confirmed PO is edited later, it returns to **unreviewed**.
7. Re-extract always uses the original stored PDF, keeps previous `llm_call` history, and resets review state to **unreviewed**.

## Environment

See `.env.example`. Important variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQL Server (production) or SQLite (development) connection string |
| `PDF_STORAGE_DIR` | Folder for uploaded PDFs (blank = `backend/storage/pdfs`) |
| `PDF_BACKUP_DIR` | Second folder that gets a copy of every PDF, e.g. a DiskStation share (blank = no copy) |
| `ANTHROPIC_API_KEY` | Claude API key (server-side only) |
| `ANTHROPIC_MODEL` | Vision-capable Claude model (currently `claude-haiku-4-5-20251001`) |
| `EXTRACTION_PROVIDER` | `claude` or `fake` |
| `MAX_UPLOAD_SIZE_MB` / `MAX_PDF_PAGES` | Upload limits |
| `HEARTBEAT_STALE_SECONDS` | Stale extraction recovery threshold |
| `SHOPKEEPER_PROVIDER` | `shopkeeper` or `fake` |
| `SHOPKEEPER_CONNECTION_STRING` | pyodbc connection string for ShopKeeper's SQL Server |
| `SHOPKEEPER_EXPECTED_DATABASE` | Must match `DB_NAME()` or writes are refused |
| `SHOPKEEPER_NON_TAX_CODE` | Used when the customer has no tax code |
| `SHOPKEEPER_NEW_JOB_STATUS` | Written to `Jb_Status` (currently `NA`) |
| `CORS_ORIGINS` | Comma-separated frontend origins (blank = allow all) |

## Architecture

- FastAPI API, SQLAlchemy models, Pydantic schemas, and extraction/PDF/storage services are separated. Alembic migrations work on SQL Server, PostgreSQL, and SQLite.
- PDFs are stored as files (`PDF_STORAGE_DIR/YYYY/MM/<po-id>.pdf`), with the path, size, and SHA-256 checksum in the database. Each file is copied to `PDF_BACKUP_DIR`. Missing backup copies are filled in at startup, and a missing primary file is restored from the backup when read.
- Claude access is isolated behind `ExtractionProvider` / `ClaudeExtractionProvider`. The prompt is in `backend/app/services/extraction/prompt.py`.
- ShopKeeper access is isolated behind `ShopKeeperProvider`. Live writes use pyodbc against SQL Server and stop if `DB_NAME()` does not match `SHOPKEEPER_EXPECTED_DATABASE`.
- Duplicate-PO warnings match the PO number plus the ShopKeeper customer chosen during review.
