# Vautrin OS API — Bruno collection

This OpenCollection contains requests for the API routes implemented today.
Open this directory in Bruno; the `Local API` environment is selected by
default and targets `http://localhost:3000/api`.

## Get an access token for local testing

The API has operator-controlled registration, not public signup. For the first
owner of a disposable test tenant, run the trusted onboarding command against
the running Docker stack:

```sh
docker compose exec api node dist/onboard-tenant.js \
  --slug my-business --name "My Business" --owner-email owner@example.com
```

For an API running on the host, build it first and use
`pnpm --filter @vautrin/api onboard:tenant --slug my-business --name "My Business" --owner-email owner@example.com`.
The command returns a one-time owner invitation token. Deliver it privately;
never commit it. In Bruno's `Local API` environment, enter that token in the
`invitationToken` secret field, enter the invited email in `email`, and choose
a password of 12–200 characters in the `password` secret field. Leave
`invitationPassword` empty for this first-owner flow; it exists for separately
testing invitation acceptance with a different account.

1. Run **Authentication → Register (Accept Invitation)** once. It calls
   `POST /auth/invitations/accept` and should return `204`. Clear the
   `invitationToken` field afterward; accepted tokens cannot be reused.
2. Run **Authentication → Login**. It calls `POST /auth/login` with the Bruno
   environment credentials. The `200` response contains `accessToken`; the
   response script stores it as a Bruno runtime variable. Its pre-request
   script builds the JSON body from `email` and `password`, so editing the
   request body alone will not supply credentials.
3. Run **Authentication → Current Session** to verify the token and active
   tenant. Then run **CRM → Create Contact**. The contact request sends
   `Authorization: Bearer {{accessToken}}` automatically.

If this user is already active, start at Login. For additional users, a logged-in
owner or authorized member can run **Authentication → Issue Invitation**;
then the new user accepts the returned token and logs in with their own email
and password. If a user has multiple memberships, use **Switch Tenant** before
tenant-scoped requests. Access tokens expire after 15 minutes; run a refresh
request or log in again when they expire. Bruno runtime variables last for the
current API client session, so log in again after restarting Bruno.

## Run order

For the broader smoke collection, use this order:

1. Health checks and validation examples.
2. Optional invitation acceptance, login, current session, tenant switch,
   refresh with a body token, refresh with the rotated HttpOnly cookie, then
   `/me` with the latest access token.
3. Business configuration: update/read the profile, then list, create, read,
   update, and archive/deactivate locations, services, and service areas; update
   and read operational settings. The
   delete endpoints are reversible state changes: locations are archived and
   services/service areas are deactivated. Create requests are not idempotent;
   rerunning them creates additional records. The sample service uses a
   per-run key to avoid the tenant-level unique-key constraint.
4. CRM smoke flow: create a lead source, contact, and lead; read it, transition
   it to CONTACTED, assign it to the logged-in user, then inspect the paginated
   lead list and dashboard. The account must have `business.manage`,
   `contact.write`, `lead.write`, and `lead.assign` capabilities. These create
   new records on every run; use a disposable tenant for repeated smoke tests.
5. Conversation smoke flow: open an SMS conversation for the CRM contact,
   list conversations, change its status, and list its messages. Provider
   ingress and delivery are not yet available through this collection.
6. OpenAPI UI and JSON document requests (available outside production only).
7. Session End: logout and verify that the revoked refresh token cannot be used.

The scripts put tokens in Bruno runtime variables for the current run. They do
not write credentials or tokens into the collection files. Login, refresh, and
logout use the API's `vos_refresh` cookie behavior, including the refresh-token
rotation and logout revocation semantics.

To point at another local API instance, edit `baseUrl` in the selected
environment. Do not commit credentials or local environment files.

See [Bruno's OpenCollection guide](https://docs.usebruno.com/opencollection-yaml/overview)
for details about the YAML collection format.
