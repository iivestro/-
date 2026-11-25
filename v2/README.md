# PATIENT 2.0

Isolated migration from legacy HTML/JavaScript to TypeScript and Next.js. Keep PostgreSQL/Supabase and existing identity IDs. Introduce NestJS only where server-side workflows require it.

## Safety gates
- Production main is untouched. Code rollback reference: backup-before-v2-2026-11-25.
- This branch is not a database backup. Verify encrypted database, Auth and Storage backups and restore in staging before migration.
- No production credentials or real patient data in development or CI.
- Preserve legacy routes and feature parity before cutover: index, patients, doctor, medical-center, representatives, admin, emergency and home services.
- Verify role escalation and appointment ownership findings in docs/STAGING-SECURITY-REVIEW.md before enabling writes.
- Keep RLS enabled; use user-scoped access and server-side authorization. No service-role key in browser.
- Validate atomic booking limits and idempotency in staging.
- No paid provisioning or load above 2000 VUs without explicit approval; coordinate existing load runs.

## Acceptance
Build, typecheck, unit tests, role isolation tests, feature parity and staging load tests must pass before production cutover. Target: 500000 registered accounts and 10000 concurrent users; not yet demonstrated.
