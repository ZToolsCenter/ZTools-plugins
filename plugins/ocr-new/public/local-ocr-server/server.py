from __future__ import annotations

import base64
import json
import re
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


HOST = "127.0.0.1"
PORT = 8765


def load_engine() -> Any:
    try:
        import onnxruntime  # noqa: F401
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        import onnxruntime  # noqa: F401
        from rapidocr import RapidOCR

    return RapidOCR()


ENGINE = load_engine()


def decode_image(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$", data_url, re.DOTALL)
    if match:
        suffix = match.group(1).lower().replace("jpeg", "jpg")
        payload = match.group(2)
    else:
        suffix = "png"
        payload = data_url

    return base64.b64decode(payload), suffix


def extract_text(result: Any) -> str:
    if hasattr(result, "txts"):
        return "\n".join(str(text) for text in result.txts if str(text).strip())

    data = result[0] if isinstance(result, tuple) else result
    lines: list[str] = []

    if isinstance(data, list):
        for item in data:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                lines.append(str(item[1]))
            elif isinstance(item, dict):
                text = item.get("text") or item.get("rec_text") or item.get("txt")
                if text:
                    lines.append(str(text))

    return "\n".join(line.strip() for line in lines if line.strip())


def recognize(data_url: str) -> str:
    image_bytes, suffix = decode_image(data_url)
    with tempfile.NamedTemporaryFile(suffix=f".{suffix}", delete=False) as image_file:
        image_file.write(image_bytes)
        image_path = Path(image_file.name)

    try:
        return extract_text(ENGINE(str(image_path)))
    finally:
        image_path.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json({"ok": True, "engine": "rapidocr"})
            return
        self.write_json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self) -> None:
        if self.path != "/ocr":
            self.write_json({"ok": False, "error": "Not found"}, 404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(body or "{}")
            image = payload.get("image")
            if not image:
                raise ValueError("missing image")

            self.write_json({"ok": True, "text": recognize(str(image))})
        except Exception as error:  # noqa: BLE001
            self.write_json({"ok": False, "error": str(error)}, 500)

    def write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Local OCR server listening on http://{HOST}:{PORT}/ocr")
    server.serve_forever()


if __name__ == "__main__":
    main()