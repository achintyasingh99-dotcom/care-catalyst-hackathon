"""HTTP smoke tests for static pages and authenticated API (standard library only)."""
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
PAGES = ["/", "/index.html", "/auth.html", "/patients.html", "/care-pathway.html",
         "/health-story.html", "/follow-ups.html", "/visit-brief.html", "/symptoms.html", "/privacy.html"]

class HttpSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        # Let the OS choose a free port, then use a stable test port for the subprocess.
        cls.port = 18766
        env = os.environ.copy()
        env["CARE_CATALYST_DB"] = str(Path(cls.temp.name) / "http-smoke.sqlite3")
        env["CARE_CATALYST_PORT"] = str(cls.port)
        cls.proc = subprocess.Popen([sys.executable, str(PROJECT / "backend" / "server.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = "http://127.0.0.1:%d" % cls.port
        cls.jar = http.cookiejar.CookieJar()
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.jar))
        for _ in range(60):
            try:
                cls.fetch("GET", "/api/health")
                break
            except Exception:
                if cls.proc.poll() is not None:
                    raise RuntimeError("API process exited before starting")
                time.sleep(.1)
        else:
            raise RuntimeError("API did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
        cls.temp.cleanup()

    @classmethod
    def fetch(cls, method, path, data=None, expected=None):
        raw = None if data is None else json.dumps(data).encode("utf-8")
        headers = {"Accept": "application/json"}
        if raw is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(cls.base + path, data=raw, headers=headers, method=method)
        try:
            with cls.opener.open(req, timeout=4) as response:
                status, body, content_type = response.status, response.read(), response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            status, body, content_type = error.code, error.read(), error.headers.get("Content-Type", "")
        payload = json.loads(body.decode("utf-8")) if "json" in content_type and body else {}
        if expected is not None:
            assert status == expected, "%s %s expected %s got %s" % (method, path, expected, status)
        return status, payload, body, content_type

    def test_all_pages_and_shared_assets_are_served(self):
        for page in PAGES:
            with self.subTest(page=page):
                status, _, body, content_type = self.fetch("GET", page, expected=200)
                self.assertIn(b"<!doctype html", body.lower())
                self.assertIn("text/html", content_type)
        for asset in ["/css/style.css", "/js/api-client.js", "/js/auth.js", "/js/app.js"]:
            with self.subTest(asset=asset):
                status, _, body, content_type = self.fetch("GET", asset, expected=200)
                self.assertTrue(body)
                self.assertNotIn("text/html", content_type)

    def test_api_auth_and_patient_persistence_over_http(self):
        self.fetch("GET", "/api/patients", expected=401)
        self.fetch("POST", "/api/register", {"username": "http_demo", "password": "Http-Smoke-Password-83"}, expected=201)
        self.fetch("POST", "/api/patients", {"id": "http-patient-1", "name": "Fictional HTTP Patient"}, expected=200)
        _, listed, _, _ = self.fetch("GET", "/api/patients", expected=200)
        self.assertEqual([item["id"] for item in listed["items"]], ["http-patient-1"])
        self.fetch("POST", "/api/logout", {}, expected=200)
        self.fetch("GET", "/api/patients", expected=401)
        self.fetch("POST", "/api/login", {"username": "http_demo", "password": "Http-Smoke-Password-83"}, expected=200)
        _, listed_again, _, _ = self.fetch("GET", "/api/patients", expected=200)
        self.assertEqual(listed_again["items"][0]["name"], "Fictional HTTP Patient")

if __name__ == "__main__":
    unittest.main(verbosity=2)
