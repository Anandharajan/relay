# Relay database on Aiven

Relay's database is `relay-db` in project `anandharajan-relay`, on Aiven's
permanent Free tier (1 CPU, 1 GB RAM, 1 GB storage, 20 connections).
Aiven assigned the service to DigitalOcean Bangalore (`blr`). Inactive free
services may be powered off; restart them from the console when needed.

## Local configuration

The ignored root `.env` contains `DATABASE_URL`, a generated `RELAY_SECRET`, and
`DATABASE_CA_CERT_FILE` pointing to the downloaded certificate in
`data/aiven-ca.pem`. The connection uses `sslmode=verify-full` so certificate
and hostname validation remain enabled. Keep these credentials out of Git.

Relay applies `apps/server/migrations/001_init.sql` automatically when it
opens the database, including enabling the `vector` extension.

Verified on 7 October 2026: the production database schema was applied with
pgvector 0.8.6, TLS certificate validation succeeded, server type checking
passed, and all 24 tests passed against a separate temporary Aiven database.
The temporary database was removed afterwards. The embedded database suite
also passed (23 tests, with the Postgres-only test skipped).

## Render configuration

1. Copy `DATABASE_URL` from the local `.env` into the Render environment.
2. Add `data/aiven-ca.pem` as a Render secret file named `aiven-ca.pem`.
3. Set `DATABASE_CA_CERT_FILE=/etc/secrets/aiven-ca.pem` in Render.
4. Retain Render's generated `RELAY_SECRET`; do not replace an existing
   production signing/encryption secret after users have stored credentials.
5. Deploy and check `/healthz`, then verify login and a knowledge query.

Database persistence does not make uploaded files persistent. Configure the
existing S3-compatible storage settings or a persistent application disk for
those files. Never run the end-to-end test suite against a database containing
real user data; it creates and changes test records.
