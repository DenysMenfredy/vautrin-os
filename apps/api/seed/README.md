# Local sample data

`sample-data.json` contains fictional remodeling data for previewing the frontend against the real Nest API and PostgreSQL database. The data is clearly marked as sample data, uses `.test` email addresses and reserved `555-010x` phone numbers, and is safe to add repeatedly.

## Run it

1. Start PostgreSQL, Redis, and the API using the normal local development workflow.
2. Use the operator-controlled onboarding flow to create a development tenant and owner, then accept the invitation with a password of your choice. Do not put invitation tokens or passwords in source control.
3. Set the existing development owner credentials in your shell and run:

   ```sh
   export SEED_OWNER_EMAIL='owner@your-development-domain.test'
   export SEED_OWNER_PASSWORD='your-local-owner-password'
   pnpm --filter @vautrin/api seed:samples
   ```

   If the owner belongs to more than one tenant, also set `SEED_TENANT_ID` to the intended tenant ID. The ID must be one of that account’s active memberships.

The command requires `NODE_ENV=development`, an HTTP API on a loopback host, an existing `OWNER` membership, and the capabilities used by the fixtures. It stops before writing if the tenant has active `lead.created` or `lead.status_changed` workflows, because newly-created leads must not start existing automations. `SEED_API_BASE_URL` can override the local API URL, but it must remain on `localhost`, `127.0.0.1`, or `::1`. The default uses `API_PORT` and `API_GLOBAL_PREFIX` from the root `.env`.

## What it creates

- A sample business profile only if the tenant has no profile yet.
- One sample office, three remodeling services, two Austin postal-code service areas, and three sample lead sources.
- Three fictional contacts and leads shown at different points in the lead lifecycle.
- One empty email conversation per sample lead. No message is sent or queued.
- One draft workflow and one draft agent with no allowed tools. Neither is activated.

The seed uses the existing API with the owner’s bearer token, so tenant scoping, validation, events, and audit records follow the same paths as normal application use. It does not write directly to PostgreSQL or Redis. It does not create appointments because booking requires a configured calendar integration. If the process stops partway through, run it again; existing records are detected and reused. Existing tenant profile, contacts, services, and other records are not overwritten.
