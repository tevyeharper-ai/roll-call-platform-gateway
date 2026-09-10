# Dream Kinetic: Forge F0.4.0

F0.4 is the Production Foundation release for Dream Kinetic: Forge. It preserves the agency hierarchy **Agency → Client → Workspace → Application → Environment**, with Roll Call operating as a client.

## Added in F0.4

- upgrade-safe cPanel package;
- HTTPS readiness reporting;
- PostgreSQL production storage adapter, connection parser, migrations, and seed path;
- JSON adapter retained only as bootstrap/recovery mode;
- contractor invitation and password activation flow;
- application-scoped contractor visibility model;
- GitHub repository registry and public-repository verification;
- explicit Explore → Research → Design → Build Prompt-to-Build lifecycle;
- improved certification gates;
- AI Agent Pack rule preventing non-Build stages from mutating source;
- Runtime Standard boundary for the upcoming F1.0 Data Builder.

## Important

F0.4 does not claim production PostgreSQL certification until the live server reports both `pdo_pgsql` and a working migrated PostgreSQL database. The Certification surface reports that honestly.
