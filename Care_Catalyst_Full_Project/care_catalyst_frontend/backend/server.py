#!/usr/bin/env python3
"""Care Catalyst demo API. Python 3.8+ standard library only.

This is a local development backend, not a production healthcare service.
Sessions are in-memory and expire on server restart. Use fictional data only.
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("CARE_CATALYST_DB", str(Path(__file__).resolve().parent / "care_catalyst.sqlite3")))
HOST = os.environ.get("CARE_CATALYST_HOST", "127.0.0.1")
PORT = int(os.environ.get("CARE_CATALYST_PORT", "8000"))
SESSION_SECONDS = 8 * 60 * 60
SESSIONS = {}
SESSION_LOCK = threading.Lock()
COLLECTIONS = {"patients", "assessments", "entries", "followups"}
MAX_BODY = 256 * 1024


def connect():
    con = sqlite3.connect(str(DB_PATH), timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
          salt BLOB NOT NULL, password_hash BLOB NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('patients','assessments','entries','followups')),
          patient_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_records_user_kind ON records(user_id, kind);
        CREATE INDEX IF NOT EXISTS idx_records_patient ON records(user_id, patient_id);
        """)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)


def safe_record(row):
    item = json.loads(row["payload"])
    item["id"] = row["id"]
    item["createdAt"] = item.get("createdAt") or row["created_at"]
    item["updatedAt"] = row["updated_at"]
    return item


class Handler(BaseHTTPRequestHandler):
    server_version = "CareCatalystLocal/1.0"

    def log_message(self, fmt, *args):
        # Keep logs useful without dumping request bodies or patient data.
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, data, extra_headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def body_json(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid Content-Length")
        if size <= 0 or size > MAX_BODY:
            raise ValueError("Request body must be between 1 byte and 256 KB")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("Content-Type must be application/json")
        raw = self.rfile.read(size)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Invalid JSON body")
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def get_session_user(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("cc_session")
        if not morsel:
            return None
        token = morsel.value
        with SESSION_LOCK:
            entry = SESSIONS.get(token)
            if not entry:
                return None
            user_id, expires = entry
            if expires < time.time():
                SESSIONS.pop(token, None)
                return None
            SESSIONS[token] = (user_id, time.time() + SESSION_SECONDS)
            return user_id

    def require_same_origin(self):
        origin = self.headers.get("Origin")
        if origin:
            expected = "http://%s:%s" % (self.headers.get("Host", ""), "")
            parsed = urlparse(origin)
            host = self.headers.get("Host", "").lower()
            if parsed.netloc.lower() != host or parsed.scheme not in ("http", "https"):
                return False
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "service": "Care Catalyst local API", "version": "1.0"})
        if path == "/api/me":
            uid = self.get_session_user()
            if not uid:
                return self.send_json(401, {"error": "Please sign in."})
            with connect() as con:
                row = con.execute("SELECT id, username, created_at FROM users WHERE id=?", (uid,)).fetchone()
            return self.send_json(200, {"user": dict(row) if row else None})
        if path.startswith("/api/"):
            uid = self.get_session_user()
            if not uid:
                return self.send_json(401, {"error": "Please sign in."})
            parts = [unquote(x) for x in path.split("/") if x]
            if len(parts) not in (2, 3) or parts[1] not in COLLECTIONS:
                return self.send_json(404, {"error": "API route not found."})
            kind = parts[1]
            with connect() as con:
                if len(parts) == 2:
                    rows = con.execute("SELECT * FROM records WHERE user_id=? AND kind=? ORDER BY created_at DESC", (uid, kind)).fetchall()
                    return self.send_json(200, {"items": [safe_record(r) for r in rows]})
                row = con.execute("SELECT * FROM records WHERE user_id=? AND kind=? AND id=?", (uid, kind, parts[2])).fetchone()
                if not row:
                    return self.send_json(404, {"error": "Record not found."})
                return self.send_json(200, {"item": safe_record(row)})
        return self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.require_same_origin():
            return self.send_json(403, {"error": "Cross-origin request blocked."})
        try:
            data = self.body_json()
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})
        if path == "/api/register":
            username = str(data.get("username", "")).strip().lower()
            password = data.get("password", "")
            if not isinstance(password, str) or len(password) < 12:
                return self.send_json(400, {"error": "Password must be at least 12 characters."})
            if not username or len(username) > 60 or not all(c.isalnum() or c in "._-" for c in username):
                return self.send_json(400, {"error": "Username must be 1–60 letters, numbers, dots, underscores, or hyphens."})
            uid, salt, created = secrets.token_urlsafe(18), secrets.token_bytes(16), now_iso()
            try:
                with connect() as con:
                    con.execute("INSERT INTO users(id,username,salt,password_hash,created_at) VALUES(?,?,?,?,?)", (uid, username, salt, password_digest(password, salt), created))
            except sqlite3.IntegrityError:
                return self.send_json(409, {"error": "That username is already registered."})
            return self.start_session(uid, username, created, 201)
        if path == "/api/login":
            username = str(data.get("username", "")).strip().lower()
            password = data.get("password", "")
            with connect() as con:
                row = con.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            if not row or not isinstance(password, str) or not hmac.compare_digest(password_digest(password, row["salt"]), row["password_hash"]):
                return self.send_json(401, {"error": "Invalid username or password."})
            return self.start_session(row["id"], row["username"], row["created_at"], 200)
        if path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            morsel = cookie.get("cc_session")
            if morsel:
                with SESSION_LOCK:
                    SESSIONS.pop(morsel.value, None)
            return self.send_json(200, {"ok": True}, {"Set-Cookie": "cc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        uid = self.get_session_user()
        if not uid:
            return self.send_json(401, {"error": "Please sign in."})
        parts = [unquote(x) for x in path.split("/") if x]
        if len(parts) != 2 or parts[0] != "api" or parts[1] not in COLLECTIONS:
            return self.send_json(404, {"error": "API route not found."})
        kind = parts[1]
        validation_error = self.validate_record(kind, data)
        if validation_error:
            return self.send_json(400, {"error": validation_error})
        rid = str(data.get("id") or secrets.token_urlsafe(16))
        created = str(data.get("createdAt") or now_iso())
        updated = now_iso()
        patient_id = str(data.get("patientId") or "") or None
        payload = dict(data)
        payload["id"] = rid
        payload["createdAt"] = created
        payload["updatedAt"] = updated
        with connect() as con:
            if patient_id and kind != "patients":
                exists = con.execute("SELECT 1 FROM records WHERE user_id=? AND kind='patients' AND id=?", (uid, patient_id)).fetchone()
                if not exists:
                    return self.send_json(400, {"error": "Linked patient does not exist in this account."})
            existing = con.execute("SELECT id, created_at FROM records WHERE user_id=? AND kind=? AND id=?", (uid, kind, rid)).fetchone()
            if existing:
                con.execute("UPDATE records SET patient_id=?, payload=?, updated_at=? WHERE user_id=? AND kind=? AND id=?", (patient_id, json.dumps(payload), updated, uid, kind, rid))
            else:
                # Never overwrite another user's record, even if an ID is guessed.
                collision = con.execute("SELECT 1 FROM records WHERE id=?", (rid,)).fetchone()
                if collision:
                    rid = secrets.token_urlsafe(16)
                    payload["id"] = rid
                con.execute("INSERT INTO records(id,user_id,kind,patient_id,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (rid, uid, kind, patient_id, json.dumps(payload), created, updated))
        return self.send_json(200, {"item": payload})

    def validate_record(self, kind, data):
        limits = {"name": 160, "title": 200, "symptoms": 5000, "summary": 1000, "details": 5000, "description": 3000, "notes": 5000, "context": 3000}
        for key, limit in limits.items():
            value = data.get(key)
            if value is not None and (not isinstance(value, str) or len(value) > limit):
                return "%s must be text no longer than %d characters." % (key, limit)
        if kind == "patients" and not str(data.get("name", "")).strip():
            return "Patient name is required. Use fictional data for this prototype."
        if kind == "followups" and not str(data.get("title", "")).strip():
            return "Follow-up title is required."
        if kind == "assessments" and not str(data.get("symptoms", "")).strip():
            return "Symptom notes are required."
        if kind == "entries" and not str(data.get("summary", "")).strip():
            return "Timeline summary is required."
        return None

    def do_PUT(self):
        # The client can use POST with the same id for idempotent upserts.
        return self.send_json(405, {"error": "Use POST /api/<collection> with the record id to update."}, {"Allow": "POST"})

    def do_DELETE(self):
        if not self.require_same_origin():
            return self.send_json(403, {"error": "Cross-origin request blocked."})
        uid = self.get_session_user()
        if not uid:
            return self.send_json(401, {"error": "Please sign in."})
        parts = [unquote(x) for x in urlparse(self.path).path.split("/") if x]
        if len(parts) != 3 or parts[0] != "api" or parts[1] not in COLLECTIONS:
            return self.send_json(404, {"error": "API route not found."})
        kind, rid = parts[1], parts[2]
        with connect() as con:
            cur = con.execute("DELETE FROM records WHERE user_id=? AND kind=? AND id=?", (uid, kind, rid))
            if cur.rowcount == 0:
                return self.send_json(404, {"error": "Record not found."})
            if kind == "patients":
                # Unlink rather than cascade-delete health history and tasks.
                rows = con.execute("SELECT id,payload FROM records WHERE user_id=? AND patient_id=?", (uid, rid)).fetchall()
                for row in rows:
                    payload = json.loads(row["payload"])
                    payload["patientId"] = ""
                    con.execute("UPDATE records SET patient_id=NULL,payload=?,updated_at=? WHERE id=? AND user_id=?", (json.dumps(payload), now_iso(), row["id"], uid))
        return self.send_json(200, {"ok": True})

    def start_session(self, uid, username, created, status):
        token = secrets.token_urlsafe(32)
        with SESSION_LOCK:
            SESSIONS[token] = (uid, time.time() + SESSION_SECONDS)
        cookie = "cc_session=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=%d" % (token, SESSION_SECONDS)
        if os.environ.get("CARE_CATALYST_SECURE_COOKIE") == "1":
            cookie += "; Secure"
        return self.send_json(status, {"user": {"id": uid, "username": username, "created_at": created}}, {"Set-Cookie": cookie})

    def serve_static(self, url_path):
        rel = "index.html" if url_path in ("", "/") else url_path.lstrip("/")
        candidate = (ROOT / rel).resolve()
        if ROOT.resolve() not in candidate.parents and candidate != ROOT.resolve():
            return self.send_json(403, {"error": "Forbidden"})
        if not candidate.is_file():
            return self.send_json(404, {"error": "Not found"})
        ext = candidate.suffix.lower()
        types = {".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".md":"text/plain; charset=utf-8"}
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Care Catalyst local server: http://%s:%d" % (HOST, PORT))
    print("API health check: http://%s:%d/api/health" % (HOST, PORT))
    print("Use fictional demo data only. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Care Catalyst.")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
