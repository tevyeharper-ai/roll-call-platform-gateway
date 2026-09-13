# Platform Gateway P3.2 API Contract Matrix

| Method | Route | Purpose | Auth/Trust | P3.2 status |
|---|---|---|---|---|
| GET | /health | Liveness | Public health | Preserved |
| GET | /bootstrap/v1/metadata | Gateway identity/version/consumers/signing metadata | Service discovery | Preserved + extended |
| GET | /ready | Dependency/readiness gate | Service discovery | Preserved |
| GET | /v1/events/reference | Governed Events service reference | Correlation envelope | New |
| GET | /v1/field/reference | Governed Field service reference | Correlation envelope | New |
| GET | /v1/experiential/reference | Governed Experiential service reference | Correlation envelope | New |
| GET | /v1/identity/metadata | Identity 2.0 public verification metadata | Public verification material | New |
| POST | /v1/identity/assertions/verify | Verify RS256 principal/context assertion | Signed assertion | New |
| POST | /v1/identity/assertions | Assertion issuance | Authoritative issuer required | 501 / not available |

No route directly accesses another application's database.
