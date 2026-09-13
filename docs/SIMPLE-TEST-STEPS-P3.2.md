# Simple P3.2 Test Steps

1. Deploy only to a separate Platform Gateway P3.2 Staging service.
2. Confirm `/health`, `/bootstrap/v1/metadata`, and `/ready` return 200.
3. Confirm Events, Field and Experiential reference routes each return 200 and the correct `consumer`.
4. Send correlation headers and confirm the same values are returned.
5. Confirm an unknown consumer returns 404.
6. Confirm `/v1/identity/metadata` returns public verification material and never a private key.
7. Verify a valid signed assertion; confirm expired/tampered/wrong-environment assertions fail.
8. Confirm assertion issuance returns 501 Not Available.
9. Point Avery Staging only at the P3.2 Staging URL and rerun AAB-100.
10. Do not merge or cut over Production based on a green Staging run.
