# Platform Access P3.3 — Test Report

**Release:** P3.3.0  
**Repository:** `tevyeharper-ai/roll-call-platform-gateway`  
**Branch:** `feature/p3.3-access-tenant-audit`  
**Certified source:** `f8bf33b27a4748f60eafcacc415f70e31a456c29`  
**CI run:** `Platform Access P3.3` / 35312909743  
**Production mutation:** false

## Automated certification

GitHub Actions completed successfully.

Validated gates:
- npm install
- dependency audit at high severity
- Node syntax checks
- organization-graph policy tests
- BSV-owner descendant inheritance
- cross-business denial
- identity-token permissions ignored without server-side membership
- service-principal authentication
- invalid-identity deny receipt
- allowed decision receipt
- outsider/self-authorization denial
- authenticated receipt read
- Docker runtime image build

**Result: all certification steps passed.**

## Security properties exercised

- deny by default
- no authorization from Identity roles/permissions alone
- explicit organization membership required
- inherited scope only where role grant explicitly allows descendants
- cross-business scope denial
- separate OMNI service authentication
- decision receipt generated for evaluated allow/deny requests
- no write action is present in P3.3

## Railway Staging status

Source certification is complete, but live Staging deployment is blocked by the connected Railway deployer pulling the repository default `main` branch even when the service configuration is set to the P3.3 feature branch.

Two isolated provisioner services were attempted. Both failed before application execution because the deployment snapshot came from `main`, where the additive `/access` directory does not exist. No database provisioning SQL executed and no existing platform service was modified.

Gateway `main` was intentionally not changed to work around this connector limitation.

## Next acceptance gate

Deploy the certified P3.3 source from a dedicated/default-branch `platform-access` repository or a Railway source binding that honors the P3.3 branch, then:

1. provision the restricted `platform_access_runtime` database role;
2. verify that role cannot access `identity_control`;
3. deploy Platform Access runtime;
4. verify `/ready` and metadata;
5. enroll a Preview BSV Identity subject;
6. prove BSV-owner descendant allow and Roll Call-to-ASMBLY cross-business deny;
7. bind OMNI server-only client;
8. execute first Work/Calendar read with decision + Audit receipts.

## Launch status

**Staging source candidate only. Production remains frozen.**
