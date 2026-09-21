# Roll Call Platform Gateway P3.4

Staging candidate for the shared Roll Call platform boundary used by Events, Roll Call Broadcast, Field, Experiential, Marketplace-facing consumers, and Avery integrations.

## Preserved contracts
- `GET /health`
- `GET /bootstrap/v1/metadata`
- `GET /ready`
- Platform Identity verification endpoints
- P3.3 OMNI Work/Calendar read broker

## Toolkit reference contracts
- `GET /v1/events/reference`
- `GET /v1/broadcast/reference`
- `GET /v1/field/reference`
- `GET /v1/experiential/reference`
- `GET /v1/asmbly/reference`

These endpoints expose governed service/reference metadata only. They do not make the Gateway a domain authority.

## Roll Call Core forwarding
The Gateway now forwards trusted platform calls to Platform Access using the server-owned Gateway service identity:

- `POST /v1/core/context`
- `POST /v1/entitlements/resolve`
- `POST /v1/access/decisions`

The browser/client never receives the Platform Access service key.

## Authority boundaries
- BSV Identity authenticates the human.
- Platform Access owns shared organization/workspace access decisions and toolkit entitlements.
- Gateway owns routing/trust mediation.
- Events owns Event domain state.
- Roll Call Broadcast owns Broadcast domain state.
- Avery remains the canonical shared intelligence runtime.

## Canonical Event Reference broker
`POST /v1/events/{event_id}/reference` now:
- resolves a trusted Core workspace → Events tenant/workspace binding;
- requests a workspace-scoped `events.read` decision from Platform Access;
- forwards only the trusted binding to the Events owner adapter;
- returns `roll-call.event-reference.v1` with the access receipt provenance.

Callers cannot supply Events-local tenant/workspace IDs directly.

## Next P3.4 work
- same-origin application path routing for `/app/events/*` and `/app/broadcast/*`
- Event → Promote → Broadcast intent mediation
- shared Shell session binding
- Staging integration certification

No Production or DNS mutation is authorized by this branch.
