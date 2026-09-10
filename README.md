# Forge Runtime Standard 1.0 — Laravel implementation boundary

Forge Runtime is the preferred framework-first application runtime beneath Dream Kinetic: Forge contracts. Laravel is an implementation framework, not the Forge platform authority.

F0.4 establishes the runtime boundary and PostgreSQL production foundation. F1.0 begins executable generation of data objects, migrations, API contracts, policy contracts, tests, and live preview artifacts.

Rules:
- client/tenant scope must be explicit in every authoritative mutation;
- generated code must expose contracts rather than private implementation coupling;
- custom code extends declared Forge extension points;
- Builder Mode and Developer Mode operate on the same application state;
- Explore, Research, and Design stages cannot mutate source;
- Build targets development/preview first; release remains separately certified.
