# PATIENT — 500k scalability target

Targets, not verified capacity: 500,000 registered accounts; 50,000 daily active; 10,000 concurrent sessions; 10 million records. Establish workload mix and budget before production sizing.

Acceptance gates: independent authenticated sessions; doctor and center bookings, laboratory and nursing lifecycle, representative visits; authorization isolation; duplicate booking prevention; sustained load and recovery; p95 under 500 ms target and error rate under 1%; backup restoration drill. Measure each workload separately and mixed. Never load test production. Use synthetic data only. Bound load to approved staging quotas and stop on resource pressure. No paid provisioning without explicit approval.

Current evidence: authenticated directory read passed 1,000 virtual users using a shared session, not full platform capacity. Overnight workflow targets up to 2,000 VUs and sustained 500 VUs. Future work: independent test identities, representative data, transactional contention, observability, query plans, connection pooling and storage capacity. Remove temporary test credentials/accounts after testing.

## Revised concurrency target
Design for 50,000 concurrent independent sessions with 30% headroom (65,000). At one request per session per 5 seconds this implies 10,000 requests/s nominal and 13,000 requests/s headroom. Validate actual workload mix with distributed load generators and production-equivalent isolated infrastructure. Current staging ceiling remains 2,000 VUs until quotas and budget are verified. No paid provisioning without approval. This is a target, not verified capacity.
