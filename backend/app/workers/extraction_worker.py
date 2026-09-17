from __future__ import annotations

import logging
import threading
import time

from app.config import get_settings
from app.database.session import get_session_factory
from app.services.extraction.pipeline import run_extraction
from app.services.po_service import claim_pending_job

logger = logging.getLogger(__name__)

_stop = threading.Event()
_thread: threading.Thread | None = None


def worker_loop() -> None:
    settings = get_settings()
    factory = get_session_factory()
    logger.info("Extraction worker started provider=%s", settings.extraction_provider)
    while not _stop.is_set():
        session = factory()
        try:
            po_id = claim_pending_job(session, settings)
            if po_id is None:
                _stop.wait(settings.worker_poll_seconds)
                continue
            from app.models.llm_call import LlmCall

            prior_calls = session.query(LlmCall).filter(LlmCall.po_request_id == po_id).count()
            call_type = "reextract" if prior_calls else "extract"
            logger.info("Extracting PO %s (%s)", po_id, call_type)
            run_extraction(session, po_id, call_type=call_type)
        except Exception:
            logger.exception("Extraction worker iteration failed")
            session.rollback()
            _stop.wait(settings.worker_poll_seconds)
        finally:
            session.close()
    logger.info("Extraction worker stopped")


def start_worker() -> None:
    global _thread
    settings = get_settings()
    if not settings.worker_enabled:
        logger.info("Extraction worker disabled")
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=worker_loop, name="extraction-worker", daemon=True)
    _thread.start()


def stop_worker() -> None:
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)


def recover_stale_jobs() -> int:
    """Stale pending jobs are claimed by the normal worker loop using HEARTBEAT_STALE_SECONDS."""
    time.sleep(0)
    return 0
