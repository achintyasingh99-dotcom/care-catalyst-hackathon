# Care Catalyst — frontend prototype + local API foundation

Care Catalyst is a healthcare-visit preparation prototype. The frontend uses HTML, CSS, and vanilla JavaScript. A separate Python standard-library API and SQLite database foundation is included for local development.

> **Important status:** The patient, assessment, timeline, and follow-up pages now load records from the authenticated local API and queue record changes back to the server. Browser `localStorage` is used as a local view cache, not the authoritative record store. This integration has passed static checks and backend tests, but full browser interaction testing is still outstanding. Treat this as a local development prototype, not a production healthcare system.

## Frontend pages

- `index.html` — dashboard and recent activity
- `patients.html` — create, edit, and delete local patient profiles
- `care-pathway.html` — organize reported symptoms, duration, trend, and context; save an informational assessment
- `health-story.html` — add, search, filter, and delete timeline entries
- `follow-ups.html` — create, edit, complete, cancel, reopen, and delete follow-up tasks
- `visit-brief.html` — generate a patient-specific visit summary and print/save it as PDF
- `symptoms.html` — searchable general symptom education topics
- `privacy.html` — local-storage limitations and clear-data control
- `auth.html` — local API registration/sign-in screen

## Run the frontend prototype

1. Open the project folder in VS Code.
2. Double-click `run_windows.bat` (Python 3.8+ required).
3. Open `http://127.0.0.1:8000/auth.html` in your browser. Do not open the HTML files directly or use a separate Live Server port; the frontend must share the backend origin for session cookies and API requests.
4. Create a demo account, then use the app. Use fictional sample data only.

## Run the local API (Python 3.8+)

The API uses only Python's standard library; no `pip install` is required.

### Windows

Double-click `run_windows.bat`, then open `http://127.0.0.1:8000`.

### Command line

```bash
python backend/server.py
```

The API binds to `127.0.0.1` by default and stores SQLite data in `backend/care_catalyst.sqlite3`. Set `CARE_CATALYST_DB` to change the database path, or `CARE_CATALYST_PORT` to change the port.

### API endpoints

- `GET /api/health` — health check
- `POST /api/register` — create account (`username`, `password`; password minimum 12 characters)
- `POST /api/login` — sign in
- `POST /api/logout` — sign out
- `GET /api/me` — current account
- `GET /api/patients`, `/api/assessments`, `/api/entries`, `/api/followups` — list records for the signed-in account
- `GET /api/<collection>/<id>` — read one record
- `POST /api/<collection>` — create a record; post the same record `id` to update it
- `DELETE /api/<collection>/<id>` — delete a record

The backend hashes passwords with PBKDF2-HMAC-SHA256, scopes records to the authenticated account, validates request size and basic field limits, uses parameterized SQL, and uses HttpOnly/SameSite session cookies. Sessions are kept in memory and expire on server restart. The local HTTP development cookie is not marked Secure unless `CARE_CATALYST_SECURE_COOKIE=1` is set for HTTPS deployment.

## Automated backend tests

From the project root:

```bash
python tests/test_backend.py
python tests/test_http_smoke.py
```

The backend tests exercise registration, successful and unsuccessful login, session logout, record create/list/delete, patient unlink behavior, duplicate username handling, validation, account isolation, rejection of cross-account patient links, cross-origin mutation rejection, and static path-traversal rejection. The HTTP smoke tests start the real local server against a temporary database, verify that all HTML pages and shared assets are served, and test authentication plus record persistence across logout/login. They do not touch your demo database.

## Safety, privacy, and deployment limitations

- This is an educational prototype, **not a diagnostic or clinical decision-support system**. Symptom review organizes user-entered words; it does not infer a condition or calculate medical probabilities.
- The frontend uses `localStorage` as a cache while signed-in record reads/writes use the local API. A top-bar status indicator reports when data is loaded, being saved, or when a save fails; failed writes may leave the current browser view ahead of the server, so verify the status before relying on a change. The local SQLite database is not encrypted by this app and does not provide cloud synchronization or secure backup.
- The backend is a local development server, not production hardened. Sessions are in-memory; there is no password reset, rate limiting, account recovery, audit log, TLS termination, administrator workflow, or formal threat model.
- Do not use real patient data. Before real-world use, obtain appropriate clinical, privacy, security, accessibility, and legal review and implement production-grade controls.
- The API is intended to be accessed locally. Do not expose the development server directly to the public internet.

## Validation status

The five backend integration tests and two HTTP smoke tests pass in this environment. The HTTP tests verify all pages/assets are served and that an authenticated patient record persists across logout/login. JavaScript syntax and basic HTML structural checks pass. Full interactive browser testing of the UI, Windows 8.1 runtime verification, and live deployment verification are **not yet complete**. Do not describe the project as production-ready until those checks are completed.
