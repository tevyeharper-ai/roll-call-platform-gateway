# Roll Call Platform Gateway P3.2

Staging candidate for governed application reference contracts and Platform Identity 2.0 verification.

## Preserved contracts
- `GET /health`
- `GET /bootstrap/v1/metadata`
- `GET /ready`

## New governed reference contracts
- `GET /v1/events/reference`
- `GET /v1/field/reference`
- `GET /v1/experiential/reference`

These endpoints do not access application databases. They establish a governed service/reference contract and preserve Roll Call correlation headers.

## Platform Identity 2.0
- `GET /v1/identity/metadata` — public verification metadata/JWK
- `POST /v1/identity/assertions/verify` — verifies signed RS256 principal/context assertions
- `POST /v1/identity/assertions` — deliberately returns `501`; authoritative issuance is not part of this release

Private signing material is never returned by an API.
