# PO Extraction

Phase 1 manufacturing purchase-order extraction and human review.

The application accepts a scanned or digital PO PDF, extracts structured job information with Claude vision, and lets a reviewer correct and confirm the result. It does **not** write anything to ShopKeeper.

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

Automated tests use `FakeExtractionProvider` and do not call Anthropic.

## Workflow

1. Scan a paper PO to PDF.
2. Upload the PDF.
3. Wait for extraction.
4. Review the original PDF next to the extracted fields.
5. Edit anything that is wrong.
6. Save draft or Confirm reviewed.
7. If a confirmed PO is edited later, it returns to **unreviewed**.
8. Re-extract always uses the original stored PDF, keeps previous `llm_call` history, and resets review state to **unreviewed**.

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
- `ERPIntegrationService` is a Phase 2 placeholder and does not connect to ShopKeeper.

## Phase 2 note

ShopKeeper / SQL Server job creation is intentionally not implemented. Reference notes remain in `Project_Instructions.md`.
