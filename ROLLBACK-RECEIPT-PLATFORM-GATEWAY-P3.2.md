# Platform Gateway P3.2 — Rollback Receipt

**Candidate:** P3.2.0 Staging only  
**Production mutation:** false

## Authoritative baseline

- Repository: `tevyeharper-ai/roll-call-platform-gateway`
- Baseline branch: `gateway-recovery`
- Baseline commit: `18f11cdab132e61ae4ba0bdc04c68e13f7c65ada`
- Baseline release: P3.1.1
- Existing Staging service: `platform-gateway-staging`
- Existing Staging URL: `https://platform-gateway-staging-production.up.railway.app`
- Baseline service identity default: `roll-call-gateway:p3.1.1`

## P3.2 candidate

- Branch: `feature/p3.2-identity-reference-contracts`
- Supplied-package source commit: `140c469839c1c072e09d77bd0a5cd2e00bfc489d`
- Candidate service: `platform-gateway-p3-2-staging`
- Candidate URL: `https://platform-gateway-p3-2-staging-production.up.railway.app`
- Candidate service identity: `roll-call-platform-gateway:p3.2-staging`
- Candidate semantic environment: Staging

## Rollback procedure

Rollback affects **Avery Staging only**:

1. Set `PLATFORM_GATEWAY_URL` on `avery-runtime-staging` back to `https://platform-gateway-staging-production.up.railway.app`.
2. Set `PLATFORM_GATEWAY_EXPECTED_SERVICE_ID` back to `roll-call-gateway:p3.1.1`.
3. Redeploy Avery Staging.
4. Confirm Avery `/readiness` returns HTTP 200.
5. Rerun the AAB cross-application reference checks and record the resulting baseline behavior.
6. Leave the P3.2 Staging service intact until evidence retention is complete; it may then be disabled/removed without touching Production.

## Production rollback

No Production rollback is required because P3.2 did not modify Production Gateway, Production DNS, Avery Production, `main`, or `gateway-recovery`.

The P3.2 branch can be abandoned independently without changing the authoritative P3.1.1 baseline.
