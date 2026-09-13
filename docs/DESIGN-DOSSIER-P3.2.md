# Platform Gateway P3.2 — Design Dossier

## Purpose
Close the current Avery cross-application reference gap while establishing the verification half of Platform Identity 2.0 without inventing an identity issuer.

## Architecture boundary
The Gateway is a contract and trust boundary. It does not become Events, Field, Experiential, Avery, or Identity authority. Application data remains application-owned. Identity assertion issuance remains unavailable until a trusted Platform Identity 2.0 issuer is connected.

## Backward compatibility
Avery A3.2 depends on `/bootstrap/v1/metadata` returning the expected `service_id` and `/ready` returning `status=ready`. P3.2 preserves both contracts and adds versioned metadata.

## Governed references
The three reference routes prove that a consumer is registered with the Gateway and preserve request/context/trace/correlation identifiers. They do not query application databases.

## Identity 2.0 verification contract
RS256 signed assertions carry principal, tenant, application, workspace, environment, roles/permissions, assurance, issuance/expiry, assertion id, trace id and correlation id. Verification checks signature, key id, required claims, time validity and environment binding.

## Security
- Private signing key is never exposed by APIs.
- Identity issuance is not implemented.
- Tampered, expired, malformed and wrong-environment assertions fail closed.
- Unknown reference consumers fail closed.
- No direct database coupling.

## Rollback
P3.2 is additive. Rollback is application-level: redeploy P3.1.1 from `gateway-recovery`. Avery A3.2 remains compatible with P3.1.1 readiness contracts, though AAB cross-application reference tests return to failing until P3.2 is restored.

## Release gates
1. Local contract suite passes.
2. Separate P3.2 Staging service only.
3. `/health`, `/bootstrap/v1/metadata`, `/ready` remain green.
4. All three reference routes return 200 with correct consumers.
5. Identity verification tests pass; issuance remains unavailable.
6. Avery Staging points to P3.2 Staging only.
7. AAB-100 moves from 60 to target 65 with no regression of the existing 29 passing scenarios.
8. No Production merge, DNS or cutover without explicit approval.
