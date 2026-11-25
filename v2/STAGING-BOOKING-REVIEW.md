# PATIENT 2.0 — Staging booking review, 2026-11-25

Read-only catalog inspection of staging, no schema or data changes.

## Verified in catalog
- profiles has protect_profile_privileges_trigger: prevents a user modifying their own role or approval_status.
- appointments has trg_guard_appointments: checks patient identity and approval on insert, checks doctor availability and weekly schedule, prevents changing owner/doctor/id/created_at on update, restricts status transitions.
- These guards mitigate the previously documented potential privilege/ownership risks. This is inspection, not proof from adversarial tests.
- center_appointments has no equivalent user trigger in the inspected catalog. Existing INSERT policy requires own approved patient, pending status, requested date and active center/doctor; UPDATE policy permits center owner without checking center activity.
- Existing doctor guard does not enforce subscription expiry, daily patient maximum or atomic day capacity. The regular INSERT policy permits a preassigned time, contrary to the desired v2 request flow.
- Center booking uniqueness and transactional capacity still require design, duplicate audit and tests.

## Release gates for writes
1. Confirm exact statuses and scheduling semantics; use date-only patient requests and provider-assigned arrival times.
2. Add database-enforced active subscription checks, immutable ownership and allowed state transitions for both booking types.
3. Define whether daily capacity counts pending or approved records, then enforce it atomically with row locks on a per-provider/date capacity record. Ensure all write paths, including legacy API, obey the same rule.
4. Add idempotent creation and appropriate unique constraints after auditing duplicates.
5. Validate synthetic identities and concurrent transactions in isolated staging. Do not run production load or overlap existing load tests.
6. Only enable booking writes in v2 after these controls pass. No production migration, paid provisioning or unapproved load.

## Current v2 implementation
Patient login preview, approved-patient server guard, directory reads, doctor schedules, center doctors and appointment history. Integration tests with a configured staging instance remain required. No claim of 500k accounts/10k concurrent capacity.
