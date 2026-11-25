# PATIENT advanced feature operations and acceptance
Status: staging implementation; production and feature gates remain closed.
## Applied on staging
- v2_feature_operational_hardening: queue check-in from actual booking, cancellation sync, payment retry matching, named nearby providers, staff support/reports/subscriptions/monitoring/announcements/regions, maintenance booking guard.
- v2_health_document_quarantine_disabled: private bucket, 5 MiB, owner-reserved path, pending scan, share with eligible doctor only, seven-day consent with revoke.
- v2_push_dispatch_disabled: active-session device binding, bounded outbox claims, Expo ticket/receipt lifecycle, logout/session deletion removes device registration.
- v2_health_scanner_disabled: service-only pending scan query.
## Worker setup (do not enable until tests pass)
- On a private trusted server set the staging Supabase URL, server-only service credential, worker secret, and Expo access token. Do not use client-prefixed env variables. Configure APNs/FCM and EAS project. For push use an external trusted scheduler to POST /api/internal/push with Authorization: Bearer PATIENT_WORKER_SECRET once per minute, starting with synthetic devices and gates enabled only in isolated test. No scheduler currently installed. Ticket success is not phone delivery; check receipts, expiry, revocation, and provider failures.
- On isolated Linux with updated ClamAV signatures run node v2/workers/health-scan.mjs via a single-instance scheduler; STAGING_HEALTH_SCAN is disabled by default. No third-party medical-file transfer. Test benign synthetic files, EICAR, malformed/oversize/decompression, restricted filesystem and scanner outage. Add lifecycle cleanup for rejected/orphan files, full parser and active-content hardening, retention/backup and access audits before release. No scanner host provisioned.
- Monitor only bounded component/event counters; no personal data. Selected API catches report counters when gate and server credential are configured. Full external uptime/alerting still needs infrastructure.
## Test evidence
- SQL rollback passed real synthetic doctor booking check-in, repeat check-in, call, cancellation sync, scoped staff support and denied self-escalation, database maintenance rejection. Center check-in concurrency and rescheduling still require separate tests.
- SQL rollback passed reserved-path owner upload permission, denied cross-owner and quarantined reads, rejected scan of nonexistent object. Actual Storage upload, ClamAV scans and positive doctor share/download not exercised.
- SQL rollback passed push claim exclusivity, receipt update, and device removal on session deletion. No real Expo/APNs/FCM send.
- Staging health bucket private; one synthetic Auth account, zero health files, queue rows and push outbox; enabled false, maintenance false.
## Interfaces
v2 web: PDF/JPEG/PNG upload, list, explicit share/revoke, authorized download. Native: image upload and image display; PDF use web. Both have dedicated staff portal and check-in selector. Existing staff account must be created separately by trusted administrator; staff role is never self-selected at signup. Legacy design branch advanced-services.html contains matching gated web controls, not published.
## Remaining
End-to-end authenticated integration, actual scanner and scheduler setup, staff account provisioning UX, browser Web Push, complete storage lifecycle/deletion, native PDF, maintenance for non-booking modules, verified payment reconciliation, real public provider locations, legacy database migration and launch. Existing service gates stay disabled. Don't enable all flags at once. No change to main or production database.
