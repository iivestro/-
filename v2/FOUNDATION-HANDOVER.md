# PATIENT 2.0 — foundation and handover status
Date: 2026-11-25. This is a development and staging record, not a production readiness certificate.

## Environment boundary
- Source: patient-v2 branch, separate from main. Original website and production database must not be changed by the development work.
- Staging project: sfaatbfiwwbvobpvhwxo. Synthetic data only. Do not enable writes in production from this preview.
- Deployment, infrastructure, app store distribution, disaster recovery and final independent audit belong to the deployment engineer. No paid service provisioned here.

## Implemented and verified database controls
- 24 public ordinary tables have RLS enabled. Removed client administrative table privileges in staging (v2/sql/client-privilege-hardening.sql); catalog confirmed zero remaining TRUNCATE/REFERENCES/TRIGGER grants for anon/authenticated.
- Applied staging-only v2/sql/staging-booking-foundation.sql after rollback trial. Five indexes (three unique, two capacity lookup) and four new triggers across doctor and center appointments confirmed in catalog. The older separate proposal files are historical; do not apply those again.
- Actual staging transaction test inserted synthetic patient/provider fixtures, verified capacity limits, duplicate rejection, foreign cancellation and reassignment rejection, doctor and center confirmation, and own cancellation. All fixture records rolled back. After applying DDL, verified 1 pre-existing Auth account, zero appointment rows, 5 indexes, 4 triggers. The test emulated JWT subject in SQL with elevated connection, not real independent device sessions/RLS or a concurrent live HTTP test.
- Daily capacity counts pending, approved/confirmed and completed appointments; one active request per patient/provider/Baghdad day. These are implementation choices requiring business acceptance. Finite schedule blocks use the smallest configured daily limit. Center and doctor subscriptions must be active for provider decisions. Time selection is Baghdad time. Schedule edit races and legacy migration compatibility require more tests.

## Application
- Native React Native/Expo/TypeScript, Next.js server API, PostgreSQL/Supabase. No legacy WebView.
- Implemented sign-in/temporary sessions, directories, schedules, appointment history, patient date-only request form, provider decisions, subscription display, notifications, representative visits, scoped workspaces. Admin accounts API and native filtered lists, approve/reject/suspend for patient and representative with a separate write gate.
- STAGING_BOOKING_WRITES and STAGING_ADMIN_WRITES default disabled. Do not open them until authenticated multi-role end-to-end testing passes and the database guards are reviewed. API origin checking is CSRF defense, not authentication. User access token + server-side role/ownership verification and database RLS are still required.
- Current integration CI uses a pre-existing synthetic fixture from legacy test code. Rotate that account password, remove hardcoded credentials, and use protected CI secrets before release; no real credentials in source or logs.

## Not finished / release blockers
- Full role workflow parity: provider account creation, patient/representative registration, password recovery and MFA, provider schedules editing, center doctor management, representative booking/actions, subscription renewal and payment audit/idempotency, home-care booking/progress, consent and data lifecycle, photo/storage security, notification generation/push, emergency feature intentionally deferred.
- Supabase advisor reported 32 authenticated-callable SECURITY DEFINER functions; these are warnings requiring individual authorization review, not 32 proven vulnerabilities. Also 4 RLS/no policy informational findings (including deferred emergency tables) and disabled leaked-password protection. Enable available auth controls and verify plan requirements with operator; no plan purchase authorized.
- Secure persistent/refresh sessions, rate limiting, audit trails, input and dependency security review, migration of production records/Auth/storage with reconciliation, restore drill, independent penetration test, real device tests, localization/accessibility, scale tests and monitoring.
- Prior load result is not proof of 500,000 real accounts or 10,000 concurrent users. Targets: 500k registered, 10k concurrent; provision infrastructure and validate with realistic independent accounts/workload after explicit scope approval.
- No live deployment or production migration. Engineer must configure trusted HTTPS staging endpoint, secrets server-side, run test suites and provision deployment. No real patient information in test environments.

## Verification commands
- Web: npm install; npm run typecheck; npm run build; node tests/smoke.mjs.
- Mobile: npm install; npx expo install --check; npm run typecheck; npx expo export --platform ios; npx expo export --platform android.
- GitHub workflows patient-v2-build, patient-v2-mobile, patient-v2-staging-integration, patient-v2-postgres-concurrency. Check exact tested commit and logs, not just badges. Current PostgreSQL concurrency workflow tests earlier proposals in disposable schema; extend it to latest actor guard and actual staging RLS roles before enabling writes.
