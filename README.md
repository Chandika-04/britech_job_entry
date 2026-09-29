# PO Extraction

Manufacturing purchase-order extraction, human review, and ShopKeeper job creation (steps 1–6).

The application accepts a scanned or digital PO PDF, extracts structured job information with Claude vision, and lets a reviewer correct and confirm the result. After confirmation, the reviewer matches an existing ShopKeeper customer and part, then creates one job per PO line. It never creates customers or parts, and it never edits or deletes jobs after they are written.

## Local setup

### 1. Start PostgreSQL

```bash
docker compose up -d db
```

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements-dev.txt
copy ..\.env.example ..\.env   # Windows
# cp ../.env.example ../.env   # macOS / Linux
```

Set `ANTHROPIC_API_KEY` in `.env`. For UI/backend testing without Claude, set:

```text
EXTRACTION_PROVIDER=fake
```

Run the API from the `backend` directory:

```bash
uvicorn app.main:app --reload --port 8000
```

Alembic migrations run on startup. The in-process worker picks up pending extractions and recovers jobs whose heartbeat is older than `HEARTBEAT_STALE_SECONDS`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. Open http://localhost:5173 on a phone or desktop.

## Tests

```bash
cd backend
pytest
```

Automated tests use `FakeExtractionProvider` and `FakeShopKeeper`. They do not call Anthropic or SQL Server.

## Workflow

1. Scan a paper PO to PDF.
2. Upload the PDF.
3. Wait for extraction.
4. Review the original PDF next to the extracted fields.
5. Edit anything that is wrong.
6. Save draft or Confirm reviewed.
7. Search ShopKeeper for the bill-to/both customer and the exact part + revision. The reviewer must pick the match.
8. Create one ShopKeeper job per line (or skip the line). A person then finishes routing and shipping in ShopKeeper.
9. If a confirmed PO is edited later, it returns to **unreviewed**.
10. Re-extract always uses the original stored PDF, keeps previous `llm_call` history, and resets review state to **unreviewed**.

## Environment

See `.env.example`. Important variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key (server-side only) |
| `ANTHROPIC_MODEL` | Vision-capable Claude model |
| `MAX_UPLOAD_SIZE_MB` | Upload size limit |
| `MAX_PDF_PAGES` | Upload page limit |
| `HEARTBEAT_STALE_SECONDS` | Stale extraction recovery threshold |
| `EXTRACTION_PROVIDER` | `claude` or `fake` |
| `SHOPKEEPER_PROVIDER` | `shopkeeper` or `fake` |
| `SHOPKEEPER_CONNECTION_STRING` | pyodbc ODBC Driver 18 connection string |
| `SHOPKEEPER_EXPECTED_DATABASE` | Must match `DB_NAME()` or writes are refused |
| `SHOPKEEPER_NON_TAX_CODE` | Used when the customer has no tax code |
| `SHOPKEEPER_NEW_JOB_STATUS` | Written to `Jb_Status` (currently `NA`) |
| `CORS_ORIGINS` | Comma-separated frontend origins |
| `VITE_API_BASE_URL` | Frontend API base URL at build time |

## Deployment (Render)

`render.yaml` defines:

- PostgreSQL
- FastAPI web service (`po-extraction-api`)
- Static frontend (`po-extraction-ui`)

Set these in the Render dashboard:

- `ANTHROPIC_API_KEY`
- `CORS_ORIGINS` to the frontend origin
- `VITE_API_BASE_URL` to the public API origin, for example `https://po-extraction-api.onrender.com`

## Architecture

- FastAPI API, SQLAlchemy models, Pydantic schemas, and extraction/PDF/storage services are separated.
- PDFs are stored in PostgreSQL (`bytea`) behind a storage interface.
- Claude access is isolated behind `ExtractionProvider` / `ClaudeExtractionProvider`.
- `FakeExtractionProvider` is used in tests.
- ShopKeeper access is isolated behind `ShopKeeperProvider`. Tests and local UI work use `FakeShopKeeper`.
- Live writes use pyodbc against SQL Server and stop if `DB_NAME()` does not match `SHOPKEEPER_EXPECTED_DATABASE`.

## Phase 2

See `Phase2_Instructions.md` for the write sequence, idempotency rules, and open production questions (`Jb_Status`, non-tax code, and the production SQL login). For UI/backend testing without SQL Server, set:

```text
SHOPKEEPER_PROVIDER=fake
```
