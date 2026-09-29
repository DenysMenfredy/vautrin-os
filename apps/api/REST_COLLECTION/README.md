# Vautrin OS API — Bruno collection

This OpenCollection contains requests for the API routes implemented today.
Open this directory in Bruno; the `Local API` environment is selected by
default and targets `http://localhost:3000/api`.

## Before running authentication requests

The API does not provide public tenant signup or seed a demo account. After
building the API, an operator can run
`pnpm --filter @vautrin/api onboard:tenant --slug my-business --name "My Business" --owner-email owner@example.com`.
Deliver the one-time owner token privately; the invitee accepts it through
`POST /auth/invitations/accept` with a new password. Once logged in, an owner
or admin can issue further invitations through `POST /tenant/invitations`.
The API returns each token once; do not commit or log it. Set `inviteEmail`
and `invitationPassword` in Bruno's local environment only when exercising
those requests. Enter the active account's email and password in the `Local
API` environment's secret fields. If the user
has multiple tenant memberships, set `tenantId` to the membership you want to
exercise. With one membership, tenant switching uses the active tenant returned
at login.

## Run order

Run the collection in sequence:

1. Health checks and validation examples.
2. Login, current session, tenant switch, refresh with a body token, refresh
   with the rotated HttpOnly cookie, then `/me` with the latest access token.
3. Logout and a refresh attempt using the revoked token.
4. Business configuration: update/read the profile, then list, create, read,
   update, and archive/deactivate locations, services, and service areas; update
   and read operational settings. The
   delete endpoints are reversible state changes: locations are archived and
   services/service areas are deactivated. Create requests are not idempotent;
   rerunning them creates additional records. The sample service uses a
   per-run key to avoid the tenant-level unique-key constraint.
5. CRM smoke flow: create a lead source, contact, and lead; read it, transition
   it to CONTACTED, assign it to the logged-in user, then inspect the paginated
   lead list and dashboard. The account must have `business.manage`,
   `contact.write`, `lead.write`, and `lead.assign` capabilities. These create
   new records on every run; use a disposable tenant for repeated smoke tests.
6. Conversation smoke flow: open an SMS conversation for the CRM contact,
   list conversations, change its status, and list its messages. Provider
   ingress and delivery are not yet available through this collection.
7. OpenAPI UI and JSON document requests (available outside production only).

The scripts put tokens in Bruno runtime variables for the current run. They do
not write credentials or tokens into the collection files. Login, refresh, and
logout use the API's `vos_refresh` cookie behavior, including the refresh-token
rotation and logout revocation semantics.

To point at another local API instance, edit `baseUrl` in the selected
environment. Do not commit credentials or local environment files.

See [Bruno's OpenCollection guide](https://docs.usebruno.com/opencollection-yaml/overview)
for details about the YAML collection format.
