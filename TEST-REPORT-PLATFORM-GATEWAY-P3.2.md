# Platform Gateway P3.2 — Test Report

**Release:** P3.2.0  
**Repository:** `tevyeharper-ai/roll-call-platform-gateway`  
**Branch:** `feature/p3.2-identity-reference-contracts`  
**Clean baseline:** `gateway-recovery` @ `18f11cdab132e61ae4ba0bdc04c68e13f7c65ada`  
**Supplied-package source commit:** `140c469839c1c072e09d77bd0a5cd2e00bfc489d`  
**Staging service:** `platform-gateway-p3-2-staging`  
**Staging URL:** `https://platform-gateway-p3-2-staging-production.up.railway.app`  
**Semantic environment:** Staging  
**Production mutation:** false

## Package integrity

The uploaded `platform-gateway-p32` contents were applied from the clean `gateway-recovery` baseline. The supplied `checksums.sha256` validated all listed package files before upload.

## Contract suite

The supplied package test suite was executed with `node --test test.mjs`.

**Result: 13 passed · 0 failed.**

Validated contracts:

- `/health` compatibility
- `/bootstrap/v1/metadata` Gateway identity and consumers
- `/ready` green state
- Events reference returns HTTP 200 and `consumer=events`
- Field reference returns HTTP 200 and `consumer=field`
- Experiential reference returns HTTP 200 and `consumer=experiential`
- governed correlation envelope preservation
- unsupported consumer fails closed
- Identity 2.0 metadata exposes public verification material only
- valid RS256 staging assertion verifies
- expired assertion fails
- tampered assertion fails
- wrong-environment assertion fails
- assertion issuance remains intentionally unavailable

## Staging deployment

Railway deployed the supplied-package source commit successfully to the separate P3.2 Staging service. The existing `platform-gateway-staging` P3.1.1 service was not replaced.

Configured service identity:

`roll-call-platform-gateway:p3.2-staging`

Configured consumers:

`events,field,experiential`

A new staging-only RSA key pair was generated for this candidate. Production key material was not reused.

## Avery Staging validation

Avery Staging only was repointed to:

`https://platform-gateway-p3-2-staging-production.up.railway.app`

with expected service identity:

`roll-call-platform-gateway:p3.2-staging`

Avery Production was not accessed or modified.

The Forge Evaluation harness then reran `AAB-100-A3.2-v1.1`.

| Measure | Before P3.2 | After supplied P3.2 |
|---|---:|---:|
| AAB-100 | 60 / 100 | **65 / 100** |
| Passing scenarios | 29 / 39 | **32 / 39** |
| Failed / unavailable | 10 | **7** |
| Gateway dependency failures | 3 | **0** |
| Identity & Context | 15 / 15 | **15 / 15** |
| Tenant-isolation critical failures | 0 | **0** |
| Unauthorized R4 executions | 0 | **0** |
| p50 latency | — | **80 ms** |
| p95 latency | — | **178 ms** |

The three cross-application reference scenarios moved to PASS and no critical benchmark blocker was introduced.

## Launch Readiness

**92 / 100 — Staging Candidate**

This does not authorize Production promotion. Platform Identity 2.0 authoritative issuance remains unavailable in P3.2 and Production remains frozen.
