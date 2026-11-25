# PATIENT v2 — test evidence, 2026-11-25

## Confirmed
- GitHub Actions 45595512561 / job 139140417743: actual synthetic password sign-in via v2 API against PATIENT-STAGING; own approved patient profile; doctor/center directories; own doctor/center booking reads; patient denied access to five other workspaces; booking writes correctly disabled; local-scope signout HTTP 200.
- Staging SQL transaction with authenticated role and synthetic patient JWT context: self-role escalation and self-approval change explicitly blocked. Rolled back.
- Staging SQL rollback trial: temporarily installed the exact booking-capacity and uniqueness proposal code, inserted synthetic doctor, center, schedules and patients, created one booking of each kind; daily limit of one rejected the second patient; following day allowed booking; repeated active same-patient/provider/day booking rejected for both kinds. No concurrent independent sessions in this trial. Verified rollback left one preexisting auth user, zero real public appointment rows and zero proposed indexes/triggers.
- Existing load_test.appointments contains exactly 1,000,000 synthetic rows, 100,000 distinct integer patient identifiers, 142 MB total relation size. Not real Auth accounts.
- Web build/smoke run 45595504383 passed. Mobile export run 45594631407 passed Android and iOS JavaScript bundle export and typecheck, not native device installation or App Store submission.
- Supabase security advisor returned 32 authenticated-callable SECURITY DEFINER function warnings and four RLS-enabled/no-policy informational findings. These are review items, not 36 proven exploitable vulnerabilities. Public legacy staging fixture contains embedded test login credentials; rotate test credentials and move them to protected CI secrets before release. Never reproduce them in reports.
- Prior load run 45518372884 (job 138883620164): 1,000 VUs sharing a session, 3,472 requests, 218.58 req/s, 0 HTTP failures, p95 9.86s. Aborted on latency threshold. No proof of 10,000 independent concurrent users.

## Isolated concurrency and synthetic profiles
Workflow 45595851593 started with a disposable PostgreSQL 17 service, 500,000 synthetic profile rows and four groups of 20 simultaneous booking requests. At initial report time the result had not yet been verified. This is not a Supabase Auth-account capacity test, production benchmark or full RLS simulation.

## Release blockers
Apply reviewed booking guards only after staging integration/concurrency and compatibility verification. Verify actual booking POST with real synthetic account against enabled staging, independent multi-role accounts, full authorization/security assessment, mobile native device runs, and measured progressive load. No production modifications, no paid provisioning, no load beyond previously agreed ceiling. Booking API remains fail-closed by default.
