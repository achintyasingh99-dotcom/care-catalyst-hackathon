"""Integration smoke tests for the local Care Catalyst API (standard library only)."""
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

class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.port = 18765
        env = os.environ.copy()
        env["CARE_CATALYST_DB"] = str(Path(cls.temp.name) / "test.sqlite3")
        env["CARE_CATALYST_PORT"] = str(cls.port)
        cls.proc = subprocess.Popen([sys.executable, str(PROJECT / "backend" / "server.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = "http://127.0.0.1:%d" % cls.port
        cls.jar = http.cookiejar.CookieJar()
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.jar))
        for _ in range(50):
            try:
                cls.request("GET", "/api/health")
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError("API did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try: cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired: cls.proc.kill()
        cls.temp.cleanup()

    @classmethod
    def request(cls, method, path, data=None, expected=None):
        raw = None if data is None else json.dumps(data).encode()
        headers = {"Accept": "application/json"}
        if raw is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(cls.base + path, data=raw, headers=headers, method=method)
        try:
            with cls.opener.open(req, timeout=3) as res:
                status, body = res.status, res.read()
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read()
        parsed = json.loads(body.decode()) if body else {}
        if expected is not None:
            assert status == expected, "%s %s expected %s got %s: %s" % (method, path, expected, status, parsed)
        return status, parsed

    def test_registration_auth_and_crud(self):
        status, result = self.request("POST", "/api/register", {"username":"demo_user", "password":"Correct-Horse-Battery-42"}, 201)
        self.assertEqual(result["user"]["username"], "demo_user")
        _, me = self.request("GET", "/api/me", expected=200)
        self.assertEqual(me["user"]["username"], "demo_user")
        _, patient = self.request("POST", "/api/patients", {"name":"Fictional Person", "age":"68", "notes":"Test record only"}, 200)
        pid = patient["item"]["id"]
        _, assessment = self.request("POST", "/api/assessments", {"patientId":pid, "symptoms":"example note", "duration":"2 days"}, 200)
        self.assertEqual(assessment["item"]["patientId"], pid)
        _, listing = self.request("GET", "/api/patients", expected=200)
        self.assertEqual(len(listing["items"]), 1)
        self.request("DELETE", "/api/patients/" + pid, expected=200)
        _, assessment_after = self.request("GET", "/api/assessments/" + assessment["item"]["id"], expected=200)
        self.assertEqual(assessment_after["item"].get("patientId", ""), "")
        self.request("POST", "/api/logout", {}, 200)
        self.request("GET", "/api/patients", expected=401)
        # Sign-in must restore an authenticated session for the same stored account.
        self.request("POST", "/api/login", {"username":"demo_user", "password":"Correct-Horse-Battery-42"}, 200)
        _, me_after_login = self.request("GET", "/api/me", expected=200)
        self.assertEqual(me_after_login["user"]["username"], "demo_user")
        self.request("POST", "/api/logout", {}, 200)
        self.request("POST", "/api/login", {"username":"demo_user", "password":"incorrect-password"}, 401)

    def test_registration_validation_and_duplicate_username(self):
        self.request("POST", "/api/register", {"username":"short_pw", "password":"tiny"}, 400)
        self.request("POST", "/api/register", {"username":"demo_user", "password":"Correct-Horse-Battery-42"}, 409)

    def test_account_isolation_and_record_validation(self):
        # Create two independent sessions and verify they cannot read each other's data.
        self.request("POST", "/api/register", {"username":"owner_user", "password":"Owner-Strong-Password-72"}, 201)
        other_jar = http.cookiejar.CookieJar()
        other_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(other_jar))
        def other_request(method, path, data=None, expected=None):
            raw = None if data is None else json.dumps(data).encode()
            headers = {"Accept":"application/json"}
            if raw is not None:
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(self.base + path, data=raw, headers=headers, method=method)
            try:
                with other_opener.open(req, timeout=3) as res:
                    status, body = res.status, res.read()
            except urllib.error.HTTPError as exc:
                status, body = exc.code, exc.read()
            payload = json.loads(body.decode()) if body else {}
            if expected is not None:
                self.assertEqual(status, expected, payload)
            return status, payload

        other_request("POST", "/api/register", {"username":"second_user", "password":"Another-Strong-Password-91"}, 201)
        _, own_patient = self.request("POST", "/api/patients", {"name":"First account fictional patient"}, 200)
        _, other_list = other_request("GET", "/api/patients", expected=200)
        self.assertEqual(other_list["items"], [])
        other_request("GET", "/api/patients/" + own_patient["item"]["id"], expected=404)
        other_request("POST", "/api/assessments", {"patientId":own_patient["item"]["id"], "symptoms":"not allowed"}, 400)
        other_request("POST", "/api/logout", {}, 200)

    def test_cross_origin_mutation_is_rejected(self):
        # A browser request carrying an Origin from another host must not mutate state.
        raw = json.dumps({"username": "blocked_user", "password": "Long-Enough-Password-123"}).encode()
        req = urllib.request.Request(
            self.base + "/api/register", data=raw, method="POST",
            headers={"Content-Type": "application/json", "Origin": "http://attacker.invalid"}
        )
        try:
            with urllib.request.build_opener().open(req, timeout=3) as res:
                status, body = res.status, res.read()
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read()
        self.assertEqual(status, 403, body.decode())
        # Confirm the rejected request did not create an account.
        self.request("POST", "/api/register", {"username": "blocked_user", "password": "Long-Enough-Password-123"}, 201)

    def test_static_path_traversal_is_rejected(self):
        status, _ = self.request("GET", "/../../../../etc/passwd")
        self.assertIn(status, (403, 404))

if __name__ == "__main__":
    unittest.main(verbosity=2)
