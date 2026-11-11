"""Send PDFs straight to a Windows printer from the server, with no print dialog.

Uses SumatraPDF's command line (`-print-to <printer> -print-settings <settings> -silent`), so each
document type gets its own fixed settings: travelers front and back, certs and shippers one side.
Direct printing is off when WAREHOUSE_PRINTER_NAME is blank; the app then falls back to the
browser print dialog.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.config import Settings, get_settings
from app.exceptions import AppError

DocKind = Literal["traveler", "certification", "shipper"]

DOC_LABELS: dict[str, str] = {
    "traveler": "Traveler",
    "certification": "Certification",
    "shipper": "Shipper",
}


@dataclass
class PrintTarget:
    kind: DocKind
    printer: str
    settings: str


@dataclass
class PrintedDocument:
    kind: DocKind
    title: str
    pdf: bytes
    printer: str
    settings: str


def _target(kind: DocKind, settings: Settings) -> PrintTarget:
    warehouse = settings.warehouse_printer_name.strip()
    override = {
        "traveler": settings.traveler_printer_name,
        "certification": settings.cert_printer_name,
        "shipper": settings.shipper_printer_name,
    }[kind].strip()
    print_settings = {
        "traveler": settings.traveler_print_settings,
        "certification": settings.cert_print_settings,
        "shipper": settings.shipper_print_settings,
    }[kind].strip()
    return PrintTarget(kind=kind, printer=override or warehouse, settings=print_settings)


def describe_settings(value: str) -> str:
    parts = {part.strip().lower() for part in value.split(",") if part.strip()}
    if parts & {"duplex", "duplexlong", "duplexshort"}:
        sides = "front and back"
    elif "simplex" in parts:
        sides = "one side"
    else:
        sides = "printer default sides"
    copies = next((part[:-1] for part in parts if part.endswith("x") and part[:-1].isdigit()), None)
    return f"{sides}, {copies} copies" if copies and copies != "1" else sides


class FakePrinter:
    """Records print jobs instead of printing (tests, and SHOPKEEPER_PROVIDER=fake)."""

    _shared: "FakePrinter | None" = None

    def __init__(self) -> None:
        self.printed: list[PrintedDocument] = []
        self.fail_with: str | None = None

    @classmethod
    def shared(cls) -> "FakePrinter":
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @classmethod
    def reset_shared(cls) -> "FakePrinter":
        cls._shared = cls()
        return cls._shared

    def print_pdf(self, pdf: bytes, title: str, target: PrintTarget) -> None:
        if self.fail_with:
            raise AppError(self.fail_with, status_code=502)
        self.printed.append(PrintedDocument(target.kind, title, pdf, target.printer, target.settings))


def find_sumatra(settings: Settings | None = None) -> Path | None:
    settings = settings or get_settings()
    configured = settings.sumatra_pdf_path.strip()
    candidates = [Path(configured)] if configured else []
    for base in (os.environ.get("LOCALAPPDATA"), os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if base:
            candidates.append(Path(base) / "SumatraPDF" / "SumatraPDF.exe")
    for path in candidates:
        if path.is_file():
            return path
    return None


class SumatraPrinter:
    def __init__(self, exe: Path, timeout: int) -> None:
        self.exe = exe
        self.timeout = timeout

    def print_pdf(self, pdf: bytes, title: str, target: PrintTarget) -> None:
        with tempfile.NamedTemporaryFile(prefix="britech-", suffix=".pdf", delete=False) as handle:
            handle.write(pdf)
            path = handle.name
        args = [str(self.exe), "-print-to", target.printer]
        if target.settings:
            args += ["-print-settings", target.settings]
        args += ["-silent", "-exit-when-done", path]
        try:
            completed = subprocess.run(
                args,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as exc:
            raise AppError(f"The printer did not answer within {self.timeout} seconds ({title}).", status_code=502) from exc
        except OSError as exc:
            raise AppError(f"Could not start SumatraPDF to print {title}: {exc}", status_code=502) from exc
        finally:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise AppError(
                f"Could not print {title} on '{target.printer}'"
                + (f": {detail}" if detail else ". Check the printer name in .env and that the printer is on."),
                status_code=502,
            )


def _use_fake(settings: Settings) -> bool:
    # WAREHOUSE_PRINTER_NAME=fake records print jobs instead of printing (tests and local dev).
    return settings.warehouse_printer_name.strip().lower() == "fake"


def direct_print_status(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    targets = {kind: _target(kind, settings) for kind in ("traveler", "certification", "shipper")}
    docs = {
        kind: {"printer": target.printer, "settings": target.settings, "description": describe_settings(target.settings)}
        for kind, target in targets.items()
    }
    if not settings.warehouse_printer_name.strip():
        return {"enabled": False, "reason": "WAREHOUSE_PRINTER_NAME is not set.", "documents": docs}
    if not _use_fake(settings) and find_sumatra(settings) is None:
        return {"enabled": False, "reason": "SumatraPDF is not installed on the server PC.", "documents": docs}
    return {"enabled": True, "reason": None, "documents": docs}


def get_printer(settings: Settings | None = None):
    settings = settings or get_settings()
    status = direct_print_status(settings)
    if not status["enabled"]:
        raise AppError(f"Direct printing is off: {status['reason']}", status_code=409)
    if _use_fake(settings):
        return FakePrinter.shared()
    exe = find_sumatra(settings)
    assert exe is not None
    return SumatraPrinter(exe, settings.print_timeout_seconds)


def print_document(kind: DocKind, pdf: bytes, title: str) -> PrintTarget:
    settings = get_settings()
    printer = get_printer(settings)
    target = _target(kind, settings)
    printer.print_pdf(pdf, title, target)
    return target
