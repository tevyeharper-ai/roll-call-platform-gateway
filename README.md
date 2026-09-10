# Roll Call Platform Gateway P3.1.1 — Managed Runtime

This directory is the hosted Gateway service paired by the WordPress Platform Bootstrap. It is designed for a managed deployment provider such as Railway so the product owner does not need SSH or reverse-proxy access.

Required runtime variables:
- `RC_WORDPRESS_ORIGIN=https://rollcallevents.co`
- `RC_GATEWAY_PRIVATE_KEY_PEM=<generated deployment secret>`
- `RC_GATEWAY_PUBLIC_KEY_PEM=<matching public key>`
- `RC_REFERENCE_CONSUMERS=events`

The private key is generated for the hosted service and is never shipped in the WordPress plugin package.
