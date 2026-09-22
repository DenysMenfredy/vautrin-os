# Vautrin OS API — Bruno collection

This OpenCollection contains requests for the API routes implemented today.
Open this directory in Bruno; the `Local API` environment is selected by
default and targets `http://localhost:3000/api`.

## Before running authentication requests

The API does not provide public registration or seed a demo account. Use an
existing test account provisioned through the application, then enter its
email and password in the `Local API` environment's secret fields. If the user
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
   update, and archive/deactivate locations, services, and service areas. The
   delete endpoints are reversible state changes: locations are archived and
   services/service areas are deactivated. Create requests are not idempotent;
   rerunning them creates additional records. The sample service uses a
   per-run key to avoid the tenant-level unique-key constraint.
5. OpenAPI UI and JSON document requests (available outside production only).

The scripts put tokens in Bruno runtime variables for the current run. They do
not write credentials or tokens into the collection files. Login, refresh, and
logout use the API's `vos_refresh` cookie behavior, including the refresh-token
rotation and logout revocation semantics.

To point at another local API instance, edit `baseUrl` in the selected
environment. Do not commit credentials or local environment files.

See [Bruno's OpenCollection guide](https://docs.usebruno.com/opencollection-yaml/overview)
for details about the YAML collection format.
