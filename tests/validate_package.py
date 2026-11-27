from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STAGING = ROOT / "balsam-demo"
PROD_REF = "oejkeqlqkwdfropylxsv"
STAGING_REF = "sfaatbfiwwbvobpvhwxo"
PROD_KEY = "sb_publishable_Ue8nsJFsLpDLFUgSTB24cw_rckeqWag"
STAGING_KEY = "sb_publishable_CBPPwjIcmVbGK1fr8EHyYg_DlfldbK6"
failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


pages = sorted(ROOT.glob("*.html"))
for production_page in pages:
    staging_page = STAGING / production_page.name
    if not staging_page.exists():
        fail(f"missing staging page: {production_page.name}")
        continue
    source = production_page.read_text(encoding="utf-8")
    copy = staging_page.read_text(encoding="utf-8")
    if PROD_REF in copy or PROD_KEY in copy:
        fail(f"production connection leaked into staging: {production_page.name}")
    if "نسخة تدريب منفصلة" not in copy:
        fail(f"missing training banner: {production_page.name}")
    if (PROD_REF in source or PROD_KEY in source) and STAGING_REF not in copy:
        fail(f"staging connection missing: {production_page.name}")
    if "location.replace(\"../" in copy or "url=../index.html" in copy:
        fail(f"staging route redirects out of its folder: {production_page.name}")
    if "SERVICE_ROLE_KEY" in copy or "SUPABASE_SECRET_KEY" in copy:
        fail(f"server secret name appears in staging HTML: {production_page.name}")

manifest = json.loads((STAGING / "manifest.webmanifest").read_text(encoding="utf-8"))
if manifest.get("scope") != "./" or manifest.get("start_url") != "./index.html":
    fail("PWA manifest points outside staging")
if "location.replace" in (STAGING / "sw.js").read_text(encoding="utf-8"):
    fail("staging service worker redirects users")
if not (STAGING / "supabase/migrations/20261128000010_patient_medical_records.sql").exists():
    fail("staging medical-report storage migration is missing")

prod_close = (ROOT / "supabase/functions/emergency-chat/index.ts").read_text(encoding="utf-8")
stage_close = (STAGING / "supabase/functions/emergency-chat/index.ts").read_text(encoding="utf-8")
for label, source, storage_remove in (
    ("production", prod_close, "attachmentPaths"),
    ("staging", stage_close, "paths"),
):
    if 'action === "doctor_close"' not in source:
        fail(f"{label} chat close action is missing")
    if f".remove({storage_remove})" not in source:
        fail(f"{label} chat close does not remove stored images")
    if '.from("emergency_chat_messages").delete()' not in source:
        # Production deletes through the emergency_chats cascade.
        if label == "staging":
            fail("staging chat close does not delete message rows")

patient_page = (STAGING / "patients.html").read_text(encoding="utf-8")
if 'functions.invoke("patient-username-auth"' not in patient_page:
    fail("staging patient page does not use its username-auth function")
if 'functions.invoke("patient-auth"' in patient_page:
    fail("staging patient page calls the production auth function")
if 'includes("انتهت المحادثة")' not in patient_page and "غير صالح|غير صالحة|المحادثة مغلقة" not in patient_page:
    fail("patient UI does not clear a session after chat deletion")

for tree, html_files in ((ROOT / "supabase/functions", pages), (STAGING / "supabase/functions", sorted(STAGING.glob("*.html")))):
    slugs = {p.name for p in tree.iterdir() if p.is_dir()}
    called: set[str] = set()
    for page in html_files:
        source = page.read_text(encoding="utf-8")
        called.update(re.findall(r"functions\.invoke\([\"']([^\"']+)", source))
        called.update(re.findall(r"/functions/v1/([a-z0-9-]+)", source))
    missing = sorted(called - slugs)
    if missing:
        fail(f"missing {tree.parent.parent.name} function sources: {', '.join(missing)}")

for relative in (
    "supabase/migrations/20261128000000_enable_visit_services_and_schedule_reminders.sql",
    "balsam-demo/supabase/migrations/20261128000000_enable_visit_services_and_schedule_reminders.sql",
    "sql/visit-services-release.sql",
):
    sql = (ROOT / relative).read_text(encoding="utf-8")
    for feature in ("support", "queue", "nearby", "reminders"):
        if feature not in sql:
            fail(f"{relative} omits {feature}")
    if "cron.schedule" not in sql or "public.v2_visit_reminder_tick()" not in sql:
        fail(f"{relative} does not schedule reminders")

node_errors = []
for page in pages + sorted(STAGING.glob("*.html")):
    source = page.read_text(encoding="utf-8")
    scripts = re.finditer(r"<script\b([^>]*)>(.*?)</script\s*>", source, re.I | re.S)
    for index, match in enumerate(scripts, start=1):
        attrs, body = match.group(1), match.group(2)
        if re.search(r"\bsrc\s*=", attrs, re.I) or not body.strip():
            continue
        script_type = re.search(r"\btype\s*=\s*[\"']([^\"']+)", attrs, re.I)
        if script_type and script_type.group(1).lower() not in ("text/javascript", "application/javascript", "module"):
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as temp:
            temp.write(body)
            temp.flush()
            result = subprocess.run(["node", "--check", temp.name], capture_output=True, text=True)
        if result.returncode:
            node_errors.append(f"{page.relative_to(ROOT)} inline script {index}: {result.stderr.strip()}")
if node_errors:
    failures.extend(node_errors)

for script in (STAGING / "sw.js", ROOT / "tests/load/staging-journeys.js"):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", encoding="utf-8") as temp:
        temp.write(script.read_text(encoding="utf-8"))
        temp.flush()
        result = subprocess.run(["node", "--check", temp.name], capture_output=True, text=True)
    if result.returncode:
        failures.append(f"{script.relative_to(ROOT)} syntax: {result.stderr.strip()}")

journey_script = (ROOT / "tests/load/staging-journeys.js").read_text(encoding="utf-8")
if PROD_REF in journey_script or "patient_request_doctor_appointment" in journey_script:
    fail("staging load scenario is not isolated and read-only")

if failures:
    print("FAIL")
    print("\n".join(f"- {item}" for item in failures))
    raise SystemExit(1)

print(f"PASS: {len(pages)} production pages, {len(list(STAGING.glob('*.html')))} staging pages, API separation, close/delete handlers, feature activation, PWA metadata, and inline JavaScript syntax.")
