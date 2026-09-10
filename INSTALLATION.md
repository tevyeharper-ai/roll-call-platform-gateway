# Dream Kinetic: Forge F0.4.0 — cPanel Upgrade / Install

## Existing F0.3.1 installation

1. Open **cPanel → File Manager** and go to the document root used by `forge.dreamkinetic.com`.
2. Confirm you currently see `index.php`, `assets/`, and `forge-app/`.
3. Download or copy `forge-app/storage/` as a safety backup.
4. Upload `dream-kinetic-forge-f0.4.0-cpanel-install.zip` into that same document root.
5. Extract it and allow cPanel to overwrite matching application files.
6. Do not delete your existing `forge-app/storage/forge-local.php` or `forge-app/storage/forge-foundation.json`.
7. Visit `https://forge.dreamkinetic.com/?health=1`.
8. Sign in and open **Infrastructure**.

## New installation

Extract the ZIP directly into the subdomain document root. You should see:

```text
index.php
assets/
forge-app/
.htaccess
START-HERE.txt
```

Open the site. Forge generates a one-time setup key in `forge-app/storage/install-key.txt`. Use it to create the administrator account.

## HTTPS

In cPanel, use **SSL/TLS Status** or **AutoSSL** for `forge.dreamkinetic.com`. After the certificate is active, force HTTPS using cPanel's domain redirect/force-HTTPS control if available.

## PostgreSQL

Forge F0.4 supports an external managed PostgreSQL database, including Railway-style PostgreSQL URLs.

Requirements:
- PHP 8.2+;
- `PDO`;
- `pdo_pgsql`.

Use **Forge → Infrastructure** and paste the PostgreSQL connection URL. Forge will:

1. validate the URL;
2. connect using PDO;
3. apply versioned SQL migrations;
4. seed the current JSON bootstrap state into PostgreSQL;
5. switch PostgreSQL to the authoritative storage driver.

If `pdo_pgsql` is unavailable, enable it through cPanel's PHP extension selector or ask the hosting provider to enable it.

## Security notes

- `forge-app/` is blocked from direct web access by `.htaccess`.
- admin passwords are hashed;
- database connection configuration is stored in the blocked storage directory and chmod'd to `0600` when supported;
- do not expose the database URL in screenshots, support tickets, chat, or source control.
