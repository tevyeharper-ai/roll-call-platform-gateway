# Platform Access P3.3 API Contract Matrix

| Method | Route | Purpose | Trust boundary | Status |
|---|---|---|---|---|
| GET | /health | Liveness | Public | Added |
| GET | /ready | Config + restricted DB readiness | Public status only | Added |
| GET | /v1/access/metadata | Contract/policy metadata | Public metadata | Added |
| POST | /v1/access/decisions | Evaluate a subject against organization/resource/action | OMNI service key + independently verified BSV Identity ID token | Added |
| GET | /v1/audit/receipts/:id | Read immutable decision receipt | OMNI service key | Added |

Identity token roles/permissions are **not authorization authority**. Access decisions use server-owned memberships and grants in the `platform_access` schema.

Initial resources are read-only: `work.read`, `calendar.read`, and `portfolio.read`. No write permission exists in P3.3.
