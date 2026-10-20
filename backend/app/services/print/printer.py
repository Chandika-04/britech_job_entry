from __future__ import annotations

import tempfile
import time
from pathlib import Path

from app.config import get_settings
from app.exceptions import AppError


class FakePrinter:
    _shared: "FakePrinter | None" = None

    def __init__(self) -> None:
        self.printed: list[tuple[str, bytes]] = []

    @classmethod
    def shared(cls) -> "FakePrinter":
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @classmethod
    def reset_shared(cls) -> "FakePrinter":
        cls._shared = cls()
        return cls._shared

    def print_pdf(self, pdf_bytes: bytes, title: str) -> None:
        self.printed.append((title, pdf_bytes))


class WindowsPrinter:
    def __init__(self, printer_name: str) -> None:
        self.printer_name = printer_name

    def print_pdf(self, pdf_bytes: bytes, title: str) -> None:
        import subprocess

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(pdf_bytes)
            path = handle.name
        quoted_path = path.replace("'", "''")
        quoted_printer = self.printer_name.replace("'", "''")
        try:
            completed = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    (
                        f"Start-Process -FilePath '{quoted_path}' -Verb PrintTo "
                        f"-ArgumentList '{quoted_printer}' -WindowStyle Hidden"
                    ),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if completed.returncode != 0:
                err = (completed.stderr or completed.stdout or "printer command failed").strip()
                raise AppError(f"Could not send PDF to printer: {err}", status_code=502)
            time.sleep(4)
        except AppError:
            raise
        except Exception as exc:
            raise AppError(f"Could not send PDF to printer: {exc}", status_code=502) from exc
        finally:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass


def get_printer():
    settings = get_settings()
    name = (settings.warehouse_printer_name or "").strip()
    if not name:
        raise AppError("Warehouse printer is not configured.", status_code=409)
    if name.lower() == "fake" or settings.shopkeeper_provider.strip().lower() == "fake":
        return FakePrinter.shared()
    return WindowsPrinter(name)
