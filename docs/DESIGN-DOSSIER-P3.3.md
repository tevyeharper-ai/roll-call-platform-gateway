# Platform Access P3.3 — Design Dossier

## Purpose
Introduce the missing shared authorization and organization-graph authority between BSV Identity and application/domain reads.

## Authority separation
- BSV Identity proves who authenticated.
- Platform Access decides what organization/resource/action that subject may access.
- Platform Gateway remains the governed routing/contract boundary.
- Owner applications remain authoritative for Work, Calendar and other domain records.
- OMNI is a consumer and never becomes authorization authority.

## Organization graph
The initial governed graph contains Black Sands Ventures, Roll Call, ASMBLY, Gravy, Space Cadet, and the Roll Call Events, Field, Venue, Members and BRDCST divisions.

## Policy
- Deny by default.
- Membership must be stored server-side.
- Identity token permission/role claims do not grant application access.
- BSV `owner` grants may inherit to descendants for read-only Work, Calendar and Portfolio.
- Operator/viewer grants are organization-local in the initial policy.
- Cross-business access fails closed.

## Audit
Every evaluated allow/deny request after service authentication creates a decision receipt. The runtime database role has SELECT/INSERT only on receipts; it cannot update/delete receipts or mutate organization/membership/policy tables.

## Data custody
P3.3 reuses the existing managed Postgres instance as infrastructure only. Data is isolated in the `platform_access` schema with a dedicated restricted runtime role. The runtime role is explicitly denied Identity schema access.

## Deferred
- No human membership is pre-seeded.
- No owner-domain records are stored here.
- No write action exists.
- No production promotion.
- Gateway Work/Calendar adapters follow after this authority is certified.
