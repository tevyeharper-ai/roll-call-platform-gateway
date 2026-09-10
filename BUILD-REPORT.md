# Dream Kinetic: Forge F0.4.0 — Build Report

## Release intent

Turn the F0.3 control-plane prototype into an upgrade-safe production foundation without pretending the visual application generator is finished.

## Implemented

- cPanel-safe overlay upgrade that preserves private install state and JSON bootstrap data;
- PostgreSQL adapter plumbing and normalized migration set;
- managed-database URL parsing with SSL mode support;
- migration + seed workflow from current Forge bootstrap state;
- HTTPS readiness detection;
- contractor invite activation and application-scoped session model;
- repository registry and public GitHub verification;
- Prompt-to-Build lifecycle stages in Forge Studio;
- expanded certification checks and explicit pending states;
- Runtime Standard scaffolding for F1.0.

## Validation performed in build environment

- PHP syntax validation across package PHP files;
- Forge foundation test suite;
- cPanel package structure validation;
- first-install setup/login/health smoke test using PHP built-in server;
- upgrade-preservation test to ensure `forge-local.php` and `forge-foundation.json` are not shipped in the overlay package;
- PostgreSQL URL parser and migration-file checks.

## Validation not falsely claimed

The build environment does not expose the PHP `pdo_pgsql` extension or a live PostgreSQL server. Therefore the real PostgreSQL network connection and SQL execution path are included but are **not marked production-certified** until the live Forge server successfully connects, migrates, and passes the Certification page.

Likewise, GitHub verification depends on outbound access from the installed server. The UI reports failure/pending rather than treating a configured string as proof.
