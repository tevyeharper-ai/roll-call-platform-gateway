# Platform Gateway P3.7 — Experiential Same-Origin Routing

Scope: certify the shared Roll Call route boundary required by Roll Call Experiential.

Adds:
- same-origin `/app/experiential` proxying through the shared Gateway
- shared shell/session enforcement for `roll-call.experiential`
- no toolkit-specific cookies propagated back to the browser
- governed Event reference requests that may use the sealed Gateway browser identity token internally
- readiness and metadata receipts for the Experiential route

Authority remains unchanged: BSV Identity authenticates, Platform Access authorizes, Experiential owns its domain, Events owns Event records.

No Production or DNS mutation is authorized by this branch.
