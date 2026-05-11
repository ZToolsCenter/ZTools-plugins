#!/usr/bin/env python3
"""
ZapAPI Test Server
用于测试 ZapAPI 各功能的 HTTP/WebSocket/TCP/UDP 服务器

功能包括:
- HTTP 方法测试 (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- 认证测试 (Basic, Bearer, API Key, JWT, Digest)
- 请求体解析测试 (JSON, form-data, urlencoded, binary)
- WebSocket 服务器
- TCP/UDP 服务器
- Cookie 测试
- 延迟响应测试
- 状态码测试
- 文件上传/下载测试
"""

import asyncio
import base64
import hashlib
import json
import os
import random
import secrets
import socket
import string
import struct
import threading
import time
import uuid
from http.cookies import SimpleCookie
from io import BytesIO
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

HTTP_PORT = 8765
WS_PORT = 8766
TCP_PORT = 8767
UDP_PORT = 8768

JWT_SECRET = "zapapi-test-secret-key-2024"
NONCE_STORE: Dict[str, float] = {}


def generate_nonce() -> str:
    return secrets.token_hex(16)


def md5_hash(data: str) -> str:
    return hashlib.md5(data.encode()).hexdigest()


def sha256_hash(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


def parse_digest_auth_header(auth_header: str) -> Dict[str, str]:
    result = {}
    if not auth_header.startswith("Digest "):
        return result
    parts = auth_header[7:].split(",")
    for part in parts:
        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"')
            result[key] = value
    return result


def verify_digest_auth(
    auth_header: str,
    method: str,
    username: str,
    password: str,
    algorithm: str = "MD5",
) -> Optional[str]:
    params = parse_digest_auth_header(auth_header)
    if not params:
        return None

    req_username = params.get("username", "")
    realm = params.get("realm", "zapapi-test")
    nonce = params.get("nonce", "")
    uri = params.get("uri", "")
    response = params.get("response", "")
    qop = params.get("qop", "")
    nc = params.get("nc", "")
    cnonce = params.get("cnonce", "")
    req_algorithm = params.get("algorithm", "MD5")

    if req_username != username:
        return None

    if algorithm == "MD5-sess" or req_algorithm == "MD5-sess":
        ha1 = md5_hash(f"{md5_hash(f'{username}:{realm}:{password}')}:{nonce}:{cnonce}")
    elif algorithm.startswith("SHA-256"):
        ha1 = sha256_hash(f"{username}:{realm}:{password}")
        if algorithm == "SHA-256-sess" or req_algorithm == "SHA-256-sess":
            ha1 = sha256_hash(f"{ha1}:{nonce}:{cnonce}")
    else:
        ha1 = md5_hash(f"{username}:{realm}:{password}")

    ha2 = md5_hash(f"{method}:{uri}") if not algorithm.startswith("SHA-256") else sha256_hash(f"{method}:{uri}")

    if qop == "auth":
        expected = md5_hash(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}") if not algorithm.startswith("SHA-256") else sha256_hash(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
    else:
        expected = md5_hash(f"{ha1}:{nonce}:{ha2}") if not algorithm.startswith("SHA-256") else sha256_hash(f"{ha1}:{nonce}:{ha2}")

    if response == expected:
        return username
    return None


def generate_digest_challenge(algorithm: str = "MD5") -> str:
    nonce = generate_nonce()
    NONCE_STORE[nonce] = time.time()
    return f'Digest realm="zapapi-test", nonce="{nonce}", algorithm={algorithm}, qop="auth"'


def simple_jwt_decode(token: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header_json = base64.urlsafe_b64decode(parts[0] + "==").decode()
        payload_json = base64.urlsafe_b64decode(parts[1] + "==").decode()

        header = json.loads(header_json)
        payload = json.loads(payload_json)

        alg = header.get("alg", "HS256")
        message = f"{parts[0]}.{parts[1]}"

        if alg == "HS256":
            expected_sig = base64.urlsafe_b64encode(
                hashlib.sha256_hmac(JWT_SECRET.encode(), message.encode(), digestmod=hashlib.sha256).digest()
            ).rstrip(b"=").decode()
        elif alg == "HS384":
            expected_sig = base64.urlsafe_b64encode(
                hashlib.sha384_hmac(JWT_SECRET.encode(), message.encode(), digestmod=hashlib.sha384).digest()
            ).rstrip(b"=").decode()
        elif alg == "HS512":
            expected_sig = base64.urlsafe_b64encode(
                hashlib.sha512_hmac(JWT_SECRET.encode(), message.encode(), digestmod=hashlib.sha512).digest()
            ).rstrip(b"=").decode()
        else:
            return None

        if parts[2] != expected_sig:
            return None

        return {"header": header, "payload": payload}
    except Exception:
        return None


def create_json_response(
    data: Any,
    status: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> bytes:
    body = json.dumps(data, ensure_ascii=False, indent=2)
    response_headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(body.encode())),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
    }
    if headers:
        response_headers.update(headers)

    header_str = "\r\n".join(f"{k}: {v}" for k, v in response_headers.items())
    return f"HTTP/1.1 {status}\r\n{header_str}\r\n\r\n{body}".encode()


def create_text_response(
    body: str,
    status: int = 200,
    content_type: str = "text/plain; charset=utf-8",
    headers: Optional[Dict[str, str]] = None,
) -> bytes:
    response_headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(body.encode())),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
    }
    if headers:
        response_headers.update(headers)

    header_str = "\r\n".join(f"{k}: {v}" for k, v in response_headers.items())
    return f"HTTP/1.1 {status}\r\n{header_str}\r\n\r\n{body}".encode()


def create_error_response(message: str, status: int = 400) -> bytes:
    return create_json_response({"error": True, "message": message}, status)


def parse_multipart(body: bytes, boundary: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"fields": {}, "files": {}}
    parts = body.split(f"--{boundary}".encode())

    for part in parts[1:]:
        if part.strip() in [b"", b"--", b"--\r\n"]:
            continue

        if b"\r\n\r\n" not in part:
            continue

        header_section, content = part.split(b"\r\n\r\n", 1)
        headers = header_section.decode("utf-8", errors="ignore")

        content_disposition = ""
        content_type = "text/plain"

        for line in headers.split("\r\n"):
            if line.lower().startswith("content-disposition:"):
                content_disposition = line
            elif line.lower().startswith("content-type:"):
                content_type = line.split(":", 1)[1].strip()

        field_name = ""
        filename = None

        if 'name="' in content_disposition:
            name_start = content_disposition.index('name="') + 6
            name_end = content_disposition.index('"', name_start)
            field_name = content_disposition[name_start:name_end]

        if 'filename="' in content_disposition:
            filename_start = content_disposition.index('filename="') + 10
            filename_end = content_disposition.index('"', filename_start)
            filename = content_disposition[filename_start:filename_end]

        content = content.rstrip(b"\r\n")

        if filename:
            result["files"][field_name] = {
                "filename": filename,
                "content_type": content_type,
                "size": len(content),
                "content_preview": content[:100].hex() if content else "",
            }
        else:
            result["fields"][field_name] = content.decode("utf-8", errors="ignore")

    return result


class HTTPRequestHandler:
    def __init__(self, method: str, path: str, headers: Dict[str, str], body: bytes):
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
        self.query_params: Dict[str, List[str]] = {}
        self.path_parts = path.split("?")
        self.base_path = self.path_parts[0]

        if len(self.path_parts) > 1:
            self.query_params = parse_qs(self.path_parts[1])

    def get_header(self, name: str, default: str = "") -> str:
        for key, value in self.headers.items():
            if key.lower() == name.lower():
                return value
        return default

    def get_query(self, name: str, default: str = "") -> str:
        values = self.query_params.get(name, [])
        return values[0] if values else default

    def handle(self) -> bytes:
        if self.method == "OPTIONS":
            return self.handle_options()

        path = self.base_path

        if path == "/" or path == "":
            return self.handle_index()

        if path == "/echo":
            return self.handle_echo()

        if path == "/methods":
            return self.handle_methods()

        if path.startswith("/methods/"):
            return self.handle_method_test()

        if path == "/headers":
            return self.handle_headers()

        if path == "/query":
            return self.handle_query()

        if path == "/status":
            return self.handle_status()

        if path == "/delay":
            return self.handle_delay()

        if path == "/redirect":
            return self.handle_redirect()

        if path == "/cookies":
            return self.handle_cookies()

        if path == "/auth/basic":
            return self.handle_auth_basic()

        if path == "/auth/bearer":
            return self.handle_auth_bearer()

        if path == "/auth/apikey":
            return self.handle_auth_apikey()

        if path == "/auth/jwt":
            return self.handle_auth_jwt()

        if path == "/auth/digest":
            return self.handle_auth_digest()

        if path == "/body/json":
            return self.handle_body_json()

        if path == "/body/form":
            return self.handle_body_form()

        if path == "/body/multipart":
            return self.handle_body_multipart()

        if path == "/body/raw":
            return self.handle_body_raw()

        if path == "/body/binary":
            return self.handle_body_binary()

        if path == "/upload":
            return self.handle_upload()

        if path == "/download":
            return self.handle_download()

        if path == "/stream":
            return self.handle_stream()

        if path == "/chunked":
            return self.handle_chunked()

        if path == "/gzip":
            return self.handle_gzip()

        if path == "/uuid":
            return self.handle_uuid()

        if path == "/hash":
            return self.handle_hash()

        if path == "/base64":
            return self.handle_base64()

        if path == "/xml":
            return self.handle_xml()

        if path == "/html":
            return self.handle_html()

        if path == "/image":
            return self.handle_image()

        if path == "/large":
            return self.handle_large()

        if path == "/encoding":
            return self.handle_encoding()

        return create_error_response("Not Found", 404)

    def handle_options(self) -> bytes:
        return create_text_response("", 204)

    def handle_index(self) -> bytes:
        return create_json_response(
            {
                "name": "ZapAPI Test Server",
                "version": "1.0.0",
                "endpoints": {
                    "basic": {
                        "/": "Server info (this response)",
                        "/echo": "Echo request details",
                        "/methods": "List all supported HTTP methods",
                        "/methods/{METHOD}": "Test specific HTTP method",
                        "/headers": "Return all request headers",
                        "/query": "Return query parameters",
                    },
                    "status": {
                        "/status": "Return custom status code (?code=200)",
                        "/delay": "Delayed response (?ms=1000)",
                        "/redirect": "Redirect (?count=1, ?to=/echo)",
                    },
                    "cookies": {
                        "/cookies": "Cookie operations (?action=set|get|clear)",
                    },
                    "auth": {
                        "/auth/basic": "Basic authentication (user:password)",
                        "/auth/bearer": "Bearer token authentication",
                        "/auth/apikey": "API Key authentication (header or query)",
                        "/auth/jwt": "JWT authentication",
                        "/auth/digest": "Digest authentication",
                    },
                    "body": {
                        "/body/json": "Parse JSON body",
                        "/body/form": "Parse URL-encoded form",
                        "/body/multipart": "Parse multipart form-data",
                        "/body/raw": "Return raw body",
                        "/body/binary": "Handle binary data",
                    },
                    "files": {
                        "/upload": "File upload test",
                        "/download": "File download test (?size=1024, ?type=json|text|binary)",
                    },
                    "response": {
                        "/stream": "Streaming response",
                        "/chunked": "Chunked transfer encoding",
                        "/gzip": "Gzip compressed response",
                        "/large": "Large response (?size=1048576)",
                    },
                    "data": {
                        "/uuid": "Generate UUID",
                        "/hash": "Hash data (?data=hello&algo=md5|sha256)",
                        "/base64": "Base64 encode/decode (?data=hello&action=encode|decode)",
                        "/xml": "XML response",
                        "/html": "HTML response",
                        "/image": "Image response (?type=png|svg)",
                        "/encoding": "Test different encodings (?enc=utf-8|gbk|shift-jis)",
                    },
                },
                "ports": {
                    "http": HTTP_PORT,
                    "websocket": WS_PORT,
                    "tcp": TCP_PORT,
                    "udp": UDP_PORT,
                },
            }
        )

    def handle_echo(self) -> bytes:
        try:
            json_body = json.loads(self.body) if self.body else None
        except json.JSONDecodeError:
            json_body = None

        return create_json_response(
            {
                "method": self.method,
                "path": self.path,
                "base_path": self.base_path,
                "query_params": {k: v[0] if len(v) == 1 else v for k, v in self.query_params.items()},
                "headers": self.headers,
                "body_size": len(self.body),
                "body_preview": self.body[:500].decode("utf-8", errors="replace") if self.body else "",
                "body_json": json_body,
            }
        )

    def handle_methods(self) -> bytes:
        return create_json_response(
            {
                "methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
                "test_urls": [f"/methods/{m}" for m in ["GET", "POST", "PUT", "DELETE", "PATCH"]],
            }
        )

    def handle_method_test(self) -> bytes:
        expected_method = self.base_path.replace("/methods/", "").upper()
        if self.method == expected_method:
            return create_json_response(
                {
                    "success": True,
                    "message": f"Received {self.method} request as expected",
                    "expected": expected_method,
                    "actual": self.method,
                }
            )
        else:
            return create_json_response(
                {
                    "success": False,
                    "message": f"Expected {expected_method} but got {self.method}",
                    "expected": expected_method,
                    "actual": self.method,
                },
                400,
            )

    def handle_headers(self) -> bytes:
        return create_json_response(
            {
                "headers": self.headers,
                "count": len(self.headers),
                "user_agent": self.get_header("user-agent"),
                "content_type": self.get_header("content-type"),
                "accept": self.get_header("accept"),
            }
        )

    def handle_query(self) -> bytes:
        return create_json_response(
            {
                "query_params": {k: v[0] if len(v) == 1 else v for k, v in self.query_params.items()},
                "raw_query": self.path_parts[1] if len(self.path_parts) > 1 else "",
            }
        )

    def handle_status(self) -> bytes:
        code = int(self.get_query("code", "200"))
        message = self.get_query("message", f"Status {code}")
        return create_json_response({"status": code, "message": message}, code)

    def handle_delay(self) -> bytes:
        ms = int(self.get_query("ms", "1000"))
        time.sleep(ms / 1000)
        return create_json_response({"delayed_ms": ms, "message": f"Response delayed by {ms}ms"})

    def handle_redirect(self) -> bytes:
        count = int(self.get_query("count", "1"))
        to = self.get_query("to", "/echo")

        if count <= 0:
            return create_json_response({"redirects": "completed", "final_url": to})

        next_url = f"/redirect?count={count - 1}&to={to}"
        return create_text_response("", 302, "text/plain", {"Location": next_url})

    def handle_cookies(self) -> bytes:
        action = self.get_query("action", "get")
        cookie_header = self.get_header("cookie", "")

        cookies: Dict[str, str] = {}
        if cookie_header:
            for part in cookie_header.split(";"):
                if "=" in part:
                    key, value = part.split("=", 1)
                    cookies[key.strip()] = value.strip()

        if action == "set":
            name = self.get_query("name", "test_cookie")
            value = self.get_query("value", "cookie_value")
            return create_json_response(
                {"action": "set", "name": name, "value": value},
                headers={"Set-Cookie": f"{name}={value}; Path=/; Max-Age=3600"},
            )

        if action == "clear":
            headers = {}
            for name in cookies:
                headers[f"Set-Cookie-{name}"] = f"{name}=; Path=/; Max-Age=0"
            return create_json_response({"action": "clear", "cleared": list(cookies.keys())}, headers=headers)

        return create_json_response({"action": "get", "cookies": cookies})

    def handle_auth_basic(self) -> bytes:
        auth = self.get_header("authorization", "")
        if not auth.startswith("Basic "):
            return create_text_response(
                "", 401, "text/plain", {"WWW-Authenticate": 'Basic realm="zapapi-test"'}
            )

        try:
            decoded = base64.b64decode(auth[6:]).decode()
            username, password = decoded.split(":", 1)
        except Exception:
            return create_error_response("Invalid Basic Auth format", 400)

        if username == "admin" and password == "password":
            return create_json_response(
                {"authenticated": True, "username": username, "method": "Basic"}
            )

        return create_error_response("Invalid credentials", 401)

    def handle_auth_bearer(self) -> bytes:
        auth = self.get_header("authorization", "")
        if not auth.startswith("Bearer "):
            return create_error_response("Missing Bearer token", 401)

        token = auth[7:]
        if token == "valid-token-123":
            return create_json_response(
                {"authenticated": True, "token": token, "method": "Bearer"}
            )

        return create_error_response("Invalid token", 401)

    def handle_auth_apikey(self) -> bytes:
        api_key = self.get_header("x-api-key", "")
        if not api_key:
            api_key = self.get_query("api_key", "")

        if not api_key:
            return create_error_response("Missing API Key", 401)

        if api_key == "sk-test-123456":
            return create_json_response(
                {"authenticated": True, "api_key": api_key, "method": "API Key"}
            )

        return create_error_response("Invalid API Key", 401)

    def handle_auth_jwt(self) -> bytes:
        auth = self.get_header("authorization", "")
        if not auth.startswith("Bearer "):
            return create_error_response("Missing JWT token", 401)

        token = auth[7:]
        decoded = simple_jwt_decode(token)

        if not decoded:
            return create_error_response("Invalid JWT token", 401)

        return create_json_response(
            {
                "authenticated": True,
                "method": "JWT",
                "header": decoded["header"],
                "payload": decoded["payload"],
            }
        )

    def handle_auth_digest(self) -> bytes:
        auth = self.get_header("authorization", "")
        algorithm = self.get_query("algorithm", "MD5")

        if not auth.startswith("Digest "):
            return create_text_response(
                "", 401, "text/plain", {"WWW-Authenticate": generate_digest_challenge(algorithm)}
            )

        username = verify_digest_auth(auth, self.method, "admin", "password", algorithm)
        if username:
            return create_json_response(
                {"authenticated": True, "username": username, "method": "Digest", "algorithm": algorithm}
            )

        return create_text_response(
            "", 401, "text/plain", {"WWW-Authenticate": generate_digest_challenge(algorithm)}
        )

    def handle_body_json(self) -> bytes:
        content_type = self.get_header("content-type", "")
        if "application/json" not in content_type.lower():
            return create_error_response("Content-Type must be application/json", 400)

        try:
            data = json.loads(self.body)
        except json.JSONDecodeError as e:
            return create_error_response(f"Invalid JSON: {str(e)}", 400)

        return create_json_response({"received": data, "size": len(self.body)})

    def handle_body_form(self) -> bytes:
        content_type = self.get_header("content-type", "")
        if "application/x-www-form-urlencoded" not in content_type.lower():
            return create_error_response(
                "Content-Type must be application/x-www-form-urlencoded", 400
            )

        data = parse_qs(self.body.decode())
        return create_json_response(
            {
                "form_data": {k: v[0] if len(v) == 1 else v for k, v in data.items()},
                "size": len(self.body),
            }
        )

    def handle_body_multipart(self) -> bytes:
        content_type = self.get_header("content-type", "")
        if "multipart/form-data" not in content_type.lower():
            return create_error_response("Content-Type must be multipart/form-data", 400)

        boundary = None
        for part in content_type.split(";"):
            if "boundary=" in part:
                boundary = part.split("=", 1)[1].strip()
                break

        if not boundary:
            return create_error_response("Missing boundary in Content-Type", 400)

        result = parse_multipart(self.body, boundary)
        return create_json_response(result)

    def handle_body_raw(self) -> bytes:
        return create_json_response(
            {
                "raw": self.body.decode("utf-8", errors="replace"),
                "size": len(self.body),
                "content_type": self.get_header("content-type", ""),
            }
        )

    def handle_body_binary(self) -> bytes:
        return create_json_response(
            {
                "size": len(self.body),
                "hex_preview": self.body[:100].hex(),
                "content_type": self.get_header("content-type", "application/octet-stream"),
            }
        )

    def handle_upload(self) -> bytes:
        content_type = self.get_header("content-type", "")

        if "multipart/form-data" in content_type.lower():
            boundary = None
            for part in content_type.split(";"):
                if "boundary=" in part:
                    boundary = part.split("=", 1)[1].strip()
                    break

            if boundary:
                result = parse_multipart(self.body, boundary)
                return create_json_response(
                    {
                        "upload_type": "multipart",
                        "files": result["files"],
                        "fields": result["fields"],
                    }
                )

        return create_json_response(
            {
                "upload_type": "raw",
                "size": len(self.body),
                "content_type": content_type,
            }
        )

    def handle_download(self) -> bytes:
        size = int(self.get_query("size", "1024"))
        file_type = self.get_query("type", "text")

        if file_type == "json":
            data = {"data": "x" * (size - 20), "size": size}
            return create_json_response(data)

        if file_type == "binary":
            content = os.urandom(size)
            response_headers = {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": "attachment; filename=test.bin",
                "Content-Length": str(size),
                "Access-Control-Allow-Origin": "*",
            }
            header_str = "\r\n".join(f"{k}: {v}" for k, v in response_headers.items())
            return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n".encode() + content

        content = "x" * size
        return create_text_response(
            content, headers={"Content-Disposition": "attachment; filename=test.txt"}
        )

    def handle_stream(self) -> bytes:
        lines = int(self.get_query("lines", "10"))
        delay = float(self.get_query("delay", "0.1"))

        body_parts = []
        for i in range(lines):
            body_parts.append(json.dumps({"line": i, "time": time.time()}) + "\n")
            time.sleep(delay)

        body = "".join(body_parts)
        return create_text_response(body, content_type="application/x-ndjson")

    def handle_chunked(self) -> bytes:
        chunks = int(self.get_query("chunks", "5"))
        delay = float(self.get_query("delay", "0.1"))

        body_parts = []
        for i in range(chunks):
            chunk = json.dumps({"chunk": i, "time": time.time()}) + "\n"
            body_parts.append(f"{len(chunk.encode()):x}\r\n{chunk}\r\n")
            time.sleep(delay)

        body_parts.append("0\r\n\r\n")
        body = "".join(body_parts)

        headers = {
            "Transfer-Encoding": "chunked",
            "Content-Type": "application/x-ndjson",
            "Access-Control-Allow-Origin": "*",
        }
        header_str = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
        return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n{body}".encode()

    def handle_gzip(self) -> bytes:
        import gzip

        size = int(self.get_query("size", "1024"))
        data = {"data": "x" * size, "compressed": True}
        body = json.dumps(data).encode()
        compressed = gzip.compress(body)

        headers = {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            "Content-Length": str(len(compressed)),
            "Access-Control-Allow-Origin": "*",
        }
        header_str = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
        return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n".encode() + compressed

    def handle_uuid(self) -> bytes:
        count = int(self.get_query("count", "1"))
        uuids = [str(uuid.uuid4()) for _ in range(count)]
        return create_json_response({"uuids": uuids, "count": count})

    def handle_hash(self) -> bytes:
        data = self.get_query("data", "hello")
        algo = self.get_query("algo", "md5")

        if algo == "md5":
            result = hashlib.md5(data.encode()).hexdigest()
        elif algo == "sha256":
            result = hashlib.sha256(data.encode()).hexdigest()
        elif algo == "sha512":
            result = hashlib.sha512(data.encode()).hexdigest()
        else:
            return create_error_response(f"Unsupported algorithm: {algo}", 400)

        return create_json_response({"data": data, "algorithm": algo, "hash": result})

    def handle_base64(self) -> bytes:
        data = self.get_query("data", "hello")
        action = self.get_query("action", "encode")

        if action == "encode":
            result = base64.b64encode(data.encode()).decode()
        elif action == "decode":
            try:
                result = base64.b64decode(data).decode()
            except Exception as e:
                return create_error_response(f"Decode error: {str(e)}", 400)
        else:
            return create_error_response(f"Invalid action: {action}", 400)

        return create_json_response({"data": data, "action": action, "result": result})

    def handle_xml(self) -> bytes:
        return create_text_response(
            '<?xml version="1.0" encoding="UTF-8"?>\n<response>\n  <status>success</status>\n  <message>Hello from ZapAPI Test Server</message>\n  <timestamp>'
            + str(int(time.time()))
            + "</timestamp>\n</response>",
            content_type="application/xml",
        )

    def handle_html(self) -> bytes:
        return create_text_response(
            """<!DOCTYPE html>
<html>
<head>
    <title>ZapAPI Test Server</title>
</head>
<body>
    <h1>ZapAPI Test Server</h1>
    <p>This is a test HTML response.</p>
    <ul>
        <li><a href="/echo">Echo</a></li>
        <li><a href="/status?code=200">Status 200</a></li>
        <li><a href="/delay?ms=1000">Delay 1s</a></li>
    </ul>
</body>
</html>""",
            content_type="text/html",
        )

    def handle_image(self) -> bytes:
        img_type = self.get_query("type", "svg")

        if img_type == "svg":
            svg = """<?xml version="1.0" encoding="UTF-8"?>
<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
    <rect width="200" height="100" fill="#4A90D9"/>
    <text x="100" y="55" font-size="16" text-anchor="middle" fill="white">ZapAPI Test</text>
</svg>"""
            headers = {
                "Content-Type": "image/svg+xml",
                "Content-Length": str(len(svg)),
                "Access-Control-Allow-Origin": "*",
            }
            header_str = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
            return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n{svg}".encode()

        png_header = b"\x89PNG\r\n\x1a\n"
        ihdr = b"\x00\x00\x00\x10IHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        idat = b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
        iend = b"\x00\x00\x00\x00IEND\xaeB`\x82"
        png_data = png_header + ihdr + idat + iend

        headers = {
            "Content-Type": "image/png",
            "Content-Length": str(len(png_data)),
            "Access-Control-Allow-Origin": "*",
        }
        header_str = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
        return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n".encode() + png_data

    def handle_large(self) -> bytes:
        size = int(self.get_query("size", "1048576"))
        data = {"size": size, "data": "x" * (size - 50)}
        return create_json_response(data)

    def handle_encoding(self) -> bytes:
        enc = self.get_query("enc", "utf-8")
        messages = {
            "utf-8": "你好世界 Hello World",
            "gbk": "你好世界 Hello World",
            "shift-jis": "こんにちは Hello World",
            "euc-kr": "안녕하세요 Hello World",
        }
        message = messages.get(enc, messages["utf-8"])
        encoded = message.encode(enc, errors="replace")

        headers = {
            "Content-Type": f"text/plain; charset={enc}",
            "Content-Length": str(len(encoded)),
            "Access-Control-Allow-Origin": "*",
        }
        header_str = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
        return f"HTTP/1.1 200\r\n{header_str}\r\n\r\n".encode() + encoded


def parse_http_request(data: bytes) -> Optional[tuple]:
    try:
        header_end = data.find(b"\r\n\r\n")
        if header_end == -1:
            return None

        header_section = data[:header_end].decode("utf-8", errors="replace")
        body = data[header_end + 4 :]

        lines = header_section.split("\r\n")
        request_line = lines[0]
        parts = request_line.split(" ")

        if len(parts) < 3:
            return None

        method = parts[0]
        path = parts[1]

        headers: Dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip()] = value.strip()

        content_length = int(headers.get("Content-Length", "0"))
        if len(body) < content_length:
            return None

        return method, path, headers, body[:content_length]
    except Exception:
        return None


def handle_http_client(client_socket: socket.socket, address: tuple):
    try:
        client_socket.settimeout(30)
        data = b""
        while True:
            chunk = client_socket.recv(8192)
            if not chunk:
                break
            data += chunk

            parsed = parse_http_request(data)
            if parsed:
                method, path, headers, body = parsed
                handler = HTTPRequestHandler(method, path, headers, body)
                response = handler.handle()
                client_socket.sendall(response)
                break

            if len(data) > 10 * 1024 * 1024:
                break

    except socket.timeout:
        pass
    except Exception as e:
        try:
            error_response = create_error_response(f"Server error: {str(e)}", 500)
            client_socket.sendall(error_response)
        except Exception:
            pass
    finally:
        client_socket.close()


def run_http_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("0.0.0.0", HTTP_PORT))
    server_socket.listen(100)

    print(f"[HTTP] Server running on http://localhost:{HTTP_PORT}")

    while True:
        try:
            client_socket, address = server_socket.accept()
            thread = threading.Thread(target=handle_http_client, args=(client_socket, address))
            thread.daemon = True
            thread.start()
        except Exception as e:
            print(f"[HTTP] Error: {e}")


def handle_websocket_client(client_socket: socket.socket, address: tuple):
    try:
        client_socket.settimeout(60)
        data = client_socket.recv(4096)

        if not data:
            return

        request = data.decode("utf-8", errors="replace")
        lines = request.split("\r\n")

        key = ""
        path = "/"
        for line in lines:
            if line.startswith("Sec-WebSocket-Key:"):
                key = line.split(":", 1)[1].strip()
            elif line.startswith("GET"):
                parts = line.split(" ")
                if len(parts) > 1:
                    path = parts[1]

        if not key:
            return

        accept_key = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()

        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_key}\r\n"
            "\r\n"
        )
        client_socket.sendall(response.encode())

        print(f"[WS] Client connected from {address}, path: {path}")

        def send_message(message: str):
            frame = bytearray()
            frame.append(0x81)
            length = len(message)
            if length <= 125:
                frame.append(length)
            elif length <= 65535:
                frame.append(126)
                frame.extend(struct.pack(">H", length))
            else:
                frame.append(127)
                frame.extend(struct.pack(">Q", length))
            frame.extend(message.encode("utf-8"))
            client_socket.sendall(frame)

        send_message(f"Connected to ZapAPI WebSocket Server. Path: {path}")

        while True:
            data = client_socket.recv(4096)
            if not data:
                break

            if data[0] & 0x0F == 0x8:
                break

            if len(data) >= 2:
                payload_len = data[1] & 0x7F
                offset = 2

                if payload_len == 126:
                    payload_len = struct.unpack(">H", data[2:4])[0]
                    offset = 4
                elif payload_len == 127:
                    payload_len = struct.unpack(">Q", data[2:10])[0]
                    offset = 10

                if data[1] & 0x80:
                    mask = data[offset : offset + 4]
                    offset += 4
                    payload = bytearray(data[offset : offset + payload_len])
                    for i in range(len(payload)):
                        payload[i] ^= mask[i % 4]
                    message = bytes(payload).decode("utf-8", errors="replace")
                else:
                    message = data[offset : offset + payload_len].decode("utf-8", errors="replace")

                print(f"[WS] Received: {message[:100]}")

                response_data = json.dumps(
                    {
                        "echo": message,
                        "length": len(message),
                        "time": time.time(),
                        "type": "echo",
                    }
                )
                send_message(response_data)

    except socket.timeout:
        print(f"[WS] Client {address} timeout")
    except Exception as e:
        print(f"[WS] Error with client {address}: {e}")
    finally:
        client_socket.close()
        print(f"[WS] Client {address} disconnected")


def run_websocket_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("0.0.0.0", WS_PORT))
    server_socket.listen(50)

    print(f"[WS] WebSocket server running on ws://localhost:{WS_PORT}")

    while True:
        try:
            client_socket, address = server_socket.accept()
            thread = threading.Thread(target=handle_websocket_client, args=(client_socket, address))
            thread.daemon = True
            thread.start()
        except Exception as e:
            print(f"[WS] Server error: {e}")


def run_tcp_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("0.0.0.0", TCP_PORT))
    server_socket.listen(50)

    print(f"[TCP] TCP server running on tcp://localhost:{TCP_PORT}")

    def handle_client(client_socket: socket.socket, address: tuple):
        try:
            client_socket.settimeout(60)
            client_socket.sendall(b"Connected to ZapAPI TCP Server\n")

            while True:
                data = client_socket.recv(4096)
                if not data:
                    break

                message = data.decode("utf-8", errors="replace").strip()
                print(f"[TCP] Received from {address}: {message[:100]}")

                response = json.dumps(
                    {
                        "echo": message,
                        "length": len(message),
                        "time": time.time(),
                    }
                )
                client_socket.sendall((response + "\n").encode())

        except socket.timeout:
            pass
        except Exception as e:
            print(f"[TCP] Error: {e}")
        finally:
            client_socket.close()
            print(f"[TCP] Client {address} disconnected")

    while True:
        try:
            client_socket, address = server_socket.accept()
            thread = threading.Thread(target=handle_client, args=(client_socket, address))
            thread.daemon = True
            thread.start()
        except Exception as e:
            print(f"[TCP] Server error: {e}")


def run_udp_server():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("0.0.0.0", UDP_PORT))

    print(f"[UDP] UDP server running on udp://localhost:{UDP_PORT}")

    while True:
        try:
            data, address = server_socket.recvfrom(65535)
            message = data.decode("utf-8", errors="replace").strip()
            print(f"[UDP] Received from {address}: {message[:100]}")

            response = json.dumps(
                {
                    "echo": message,
                    "length": len(message),
                    "time": time.time(),
                    "from": f"{address[0]}:{address[1]}",
                }
            )
            server_socket.sendto((response + "\n").encode(), address)

        except Exception as e:
            print(f"[UDP] Error: {e}")


def main():
    print("=" * 60)
    print("  ZapAPI Test Server")
    print("=" * 60)
    print()

    threads = [
        threading.Thread(target=run_http_server, daemon=True),
        threading.Thread(target=run_websocket_server, daemon=True),
        threading.Thread(target=run_tcp_server, daemon=True),
        threading.Thread(target=run_udp_server, daemon=True),
    ]

    for t in threads:
        t.start()

    print()
    print("All servers started. Press Ctrl+C to stop.")
    print()
    print("Quick test URLs:")
    print(f"  HTTP:     http://localhost:{HTTP_PORT}/")
    print(f"  Echo:     http://localhost:{HTTP_PORT}/echo")
    print(f"  WebSocket: ws://localhost:{WS_PORT}")
    print(f"  TCP:      localhost:{TCP_PORT}")
    print(f"  UDP:      localhost:{UDP_PORT}")
    print()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
