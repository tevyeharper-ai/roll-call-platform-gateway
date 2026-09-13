# Platform Gateway P3.2 API Contract Matrix

| Method | Route | Purpose | Auth/Trust | P3.2 status |
|---|---|---|---|---|
| GET | /health | Liveness | Public health | Preserved |
| GET | /bootstrap/v1/metadata | Gateway identity/version/consumers/signing metadata | Service discovery | Preserved + extended |
| GET | /ready | Dependency/readiness gate | Service discovery | Preserved |
| GET | /v1/events/reference | Governed Events service reference | Correlation envelope | Preserved |
| GET | /v1/field/reference | Governed Field service reference | Correlation envelope | Preserved |
| GET | /v1/experiential/reference | Governed Experiential service reference | Correlation envelope | Preserved |
| GET | /v1/asmbly/reference | Governed ASMBLY service reference; contract metadata only | Correlation envelope | Added for ASMBLY clean-start staging |
| GET | /v1/identity/metadata | Identity 2.0 public verification metadata | Public verification material | Preserved |
| POST | /v1/identity/assertions/verify | Verify RS256 principal/context assertion | Signed assertion | Preserved |
| POST | /v1/identity/assertions | Assertion issuance | Authoritative issuer required | 501 / not available |

No reference route directly accesses another application's database or returns application records. The ASMBLY reference does **not** activate discovery or write authority; those contracts remain blocked until the dedicated ASMBLY data service and Identity/Access boundary are certified.
