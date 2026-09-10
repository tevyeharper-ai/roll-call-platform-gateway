# Forge F0.4.0 — Simple Testing Workflow

After upgrading:

1. Open `https://forge.dreamkinetic.com/?health=1` and confirm `"ok": true` and version `F0.4.0`.
2. Sign in and confirm the Overview loads.
3. Open **Forge Studio**. Switch Explore → Research → Design → Build. Confirm only Build reports that preview mutation is allowed.
4. Switch Builder ↔ Developer and confirm both modes refer to the same Events preview/application.
5. Open **Contractors**, create a test contractor invitation, copy the invitation URL, open it in an incognito window, set a password, and sign in as the contractor.
6. Confirm the contractor sees only assigned applications and does not see the agency Clients/Contractors/Infrastructure administration surfaces.
7. Open **Repositories**, connect a public GitHub repository in `owner/repository` form, then click Verify.
8. Open **Infrastructure**. Confirm HTTPS status is green. If PostgreSQL is ready, connect it and return to Overview.
9. Open **Certification**. Do not treat F0.4 as production-certified until HTTPS and PostgreSQL both pass.
10. Download an AI Context Pack for Events and confirm `AGENTS.md` states that Explore/Research/Design cannot mutate source.

CLI optional:

```bash
php forge-app/bin/forge doctor
php forge-app/bin/forge test
```
