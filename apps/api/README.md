# @vautrin/api

The Vautrin OS HTTP API — a NestJS modular monolith (VOS-004, ADR-002).

## Run

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm db:deploy
pnpm --filter @vautrin/api dev
```

| Route | Purpose |
|---|---|
| `GET /api/health/live` | Liveness — touches no dependency |
| `GET /api/health/ready` | Readiness — verifies the database |
| `POST /api/auth/login` | Authenticate and issue short-lived access and rotating refresh tokens |
| `POST /api/auth/refresh` | Rotate a refresh token from the HttpOnly cookie or request body |
| `POST /api/auth/logout` | Revoke the refresh token in the HttpOnly cookie |
| `GET /api/auth/me` | Return the authenticated user, active tenant, role and capabilities |
| `POST /api/auth/tenant` | Switch active tenant for a verified membership |
| `GET/PATCH /api/business/profile` | Read or create/update profile for the active tenant |
| `GET/PATCH /api/business/settings` | Read or update tenant operational settings (manager only) |
| `GET/POST /api/business/locations` | List (cursor-paginated) or create locations |
| `GET/PATCH/DELETE /api/business/locations/:id` | Read, update, or archive a location |
| `GET/POST /api/business/services` | List (cursor-paginated) or create catalog services |
| `GET/PATCH/DELETE /api/business/services/:id` | Read, update, or deactivate a service |
| `GET/POST /api/business/service-areas` | List (cursor-paginated) or create service areas |
| `GET/PATCH/DELETE /api/business/service-areas/:id` | Read, update, or deactivate a service area |
| `GET/POST /api/business/custom-field-definitions` | List (cursor-paginated) or create custom field definitions |
| `GET/PATCH/DELETE /api/business/custom-field-definitions/:id` | Read, update, or deactivate a custom field definition |
| `GET /api/business/custom-field-values/:entityType/:entityId` | List values for a contact, lead, or estimate |
| `PUT/DELETE /api/business/custom-field-values/:entityType/:entityId/:definitionId` | Set or remove one custom field value |
| `GET /api/contacts` | Search and cursor-paginate active-tenant contacts |
| `POST /api/contacts` | Create a contact |
| `GET/PATCH/DELETE /api/contacts/:contactId` | Read, update, or soft-archive a contact |
| `GET/POST /api/lead-sources` | List or create tenant-owned lead sources |
| `GET/PATCH/DELETE /api/lead-sources/:sourceId` | Read, update, or deactivate a lead source |
| `GET/POST /api/leads` | Filter and paginate or create tenant leads |
| `GET/PATCH/DELETE /api/leads/:leadId` | Read, update, or archive a lead |
| `PATCH /api/leads/:leadId/status` | Move a lead forward through the lifecycle |
| `PATCH /api/leads/:leadId/assignment` | Assign or unassign an active tenant member |
| `GET /api/crm/dashboard` | Total and per-status lead counts |
| `GET/POST /api/conversations` | List or open tenant conversations |
| `GET /api/conversations/:conversationId` | Read a tenant conversation |
| `PATCH /api/conversations/:conversationId/status` | Change conversation status |
| `GET /api/conversations/:conversationId/messages` | List messages in a tenant conversation |
| `POST /api/conversations/:conversationId/messages` | Persist and queue an outbound SMS (idempotency key required) |
| `GET/POST /api/workflows` | List workflow versions or create a draft (`workflow.read` / `workflow.manage`) |
| `GET/PATCH /api/workflows/:workflowId` | Read a workflow or edit its draft definition |
| `POST /api/workflows/:workflowId/versions` | Copy a published version into the next draft version |
| `PATCH /api/workflows/:workflowId/status` | Activate, pause, or archive a workflow version |
| `POST /api/webhooks/twilio/inbound/:integrationId` | Signature-verified, provisioned Twilio SMS inbound callback (204 on success) |
| `POST /api/webhooks/twilio/status/:integrationId?messageId=...` | Signature-verified outbound delivery status callback (204 on success) |
| `GET /api/docs` | OpenAPI UI (non-production only) |
| `GET /api/docs-json` | OpenAPI document (non-production only) |

## Structure

```text
src/
  main.ts                      bootstrap: prefix, validation, filters, OpenAPI
  app.module.ts                composition root
  config/environment.module.ts validated environment, global
  database/                    DatabaseService — tenant-scoped data access
  health/                      liveness + readiness
  common/                      cross-cutting HTTP concerns
```

`app.module.ts` wires the implemented Auth, Tenant, Audit, Health, and Database
modules. Business Configuration now provides profile, location, service, and
service-area APIs. Contacts and Leads provide tenant-scoped CRUD, search, and
cursor pagination. Conversations provide tenant-scoped read/open/status,
message-list, and idempotent outbound-SMS APIs. The Twilio SMS inbound webhook
deduplicates provider event/message IDs,
atomically records `message.received`, and records an SMS/WhatsApp STOP as a
tenant-scoped communication suppression before any AI processing. Outbound
sends use the durable outbox and worker-time suppression check; this technical
suppression is not a substitute for a reviewed legal consent policy.
Workflow definitions now have tenant-scoped draft management, immutable
published versions, lifecycle transitions, and audit records. Workflow run
creation is driven by the durable event consumer; step execution remains
future work. Appointment, Estimate, Agent, Knowledge, Integration management,
and Analytics HTTP features also remain future work.

## Authentication smoke tests

Open [`REST_COLLECTION`](./REST_COLLECTION) in Bruno and select its `Local API`
environment. Add an existing provisioned user's email and password in that
environment's local secret fields. If the user belongs to multiple tenants,
set `tenantId` to one of their membership IDs; otherwise the collection uses the
active tenant returned by login. The API has no public sign-up or demo-account
route.

Requests are ordered so **Run All** checks health and validation, then exercises
login, `/me`, tenant switching, body and cookie refresh, logout and refresh-token
revocation, business-configuration endpoints, a CRM lead smoke flow, and a
conversation smoke flow, and workflow-definition lifecycle requests. Workflow
mutations require an owner/admin account with `workflow.manage`.
The CRM flow creates records, so run it against a disposable tenant. API docs
requests are for non-production environments only. Bruno keeps access and
refresh tokens as runtime variables and rotates the refresh cookie between
requests.

## Production cookie and proxy contract

The preferred topology is same-origin: Nuxt/Nitro proxies `/api/*` locally,
while the v0.3 GCP target routes `/api/*` through the external HTTPS load
balancer beside the static Nuxt assets. The refresh token is HttpOnly, scoped to
`/api/auth`, and Secure in production. Cookie-authenticated mutations validate
an exact `Origin` against `TRUSTED_ORIGINS`; requests without an Origin remain
available to non-browser clients. Do not configure a wildcard origin.

Set `TRUSTED_ORIGINS` to a comma-separated list such as
`https://app.example.com` and set `TRUST_PROXY` to the exact number of trusted
reverse-proxy hops. The API applies that proxy setting before using
`request.ip` for rate limits or audit context. Login and refresh use expiring
Redis counters keyed by IP plus normalized account/token identifiers; they do
not permanently lock accounts.

## Reaching the database

`DatabaseService.withTenant()` is the supported path:

```ts
const leads = await this.database.withTenant(tenantId, (tx) =>
  tx.lead.findMany({ where: { status: 'NEW' } }),
);
```

`.unscoped` exists for genuinely tenant-independent work — the readiness
probe, and the authentication lookup that must find a user before any tenant
is known. Tenant-scoped tables return zero rows through it, by design
(ADR-005).

Tenant context is never taken from client input. It is derived from the
authenticated access token after membership verification (SDD-05 §2,
VOS-033).

Business configuration routes require an active-tenant access token.
`business.read` is required for reads and `business.manage` for mutations.
The operational settings route requires `business.manage` for both reads and
writes because its AI configuration may be sensitive. It exposes the existing
communication preferences, qualification rules, booking rules, and AI
configuration JSON fields without inventing a nested schema not defined by
SDD-01. Provider credentials belong in a secret manager, not in these JSON
fields. Create the business profile before updating settings.
List endpoints use `limit` (default 50, maximum 100), optional `search`, and
the opaque `nextCursor` returned in each page. Service and service-area lists
also accept an `active` filter. Location deletion is an archive (`deleted_at`);
service and service-area deletion deactivates the record so configuration can
be restored without losing its history. The authenticated tenant claim—not a
body/query tenant ID—selects the RLS context.

Contact routes use `contact.read` for reads and `contact.write` for mutations.
List results exclude archived contacts, support case-insensitive substring
search on names, email, and company (plus substring phone search), and use the
50-item default / 100-item maximum pagination contract. Contact archive sets
`deleted_at`; tenant IDs and audit actor IDs are omitted from responses. Email
is normalized to lowercase, phone numbers use the schema's E.164 format, and
the existing flexible `address` JSON field is not constrained to an
undocumented shape.

CRM reads require `lead.read`; lead changes require `lead.write`. Lead-source
catalog changes require `business.manage`, and assignment requires
`lead.assign`. A lead must reference an active contact in the current tenant;
selected source and service must also be active in that tenant. Lead updates,
status transitions, and assignments require the current `version` and return
409 if another actor changed the lead first. Statuses advance through the
order in SDD-01 §4; WON and LOST are terminal. Lead creation and transitions
write versioned outbox events together with the lead and audit record.
`/crm/dashboard` counts only unarchived leads in the active tenant.

Conversation reads require `conversation.read`; creation, status changes, and
outbound messages require `conversation.write`. A new conversation must reference an active
contact and, when supplied, a lead belonging to that contact in the active
tenant. Conversation and message lists use the same opaque cursor contract as
CRM. An outbound SMS requires a UUID `idempotencyKey`, an SMS conversation, a
contact phone number in E.164 format, and one active Twilio sender. The API
stores the message, audit entry, and versioned send-request event atomically.
The worker re-checks opt-out state immediately before sending and uses the
`notifications` queue. Known Twilio HTTP 429 rejections use bounded retries;
uncertain network outcomes are not resent and await the signed status callback.
Delivery callbacks are bound to the local message ID and provisioned integration.

## Twilio inbound SMS setup

The webhook accepts `application/x-www-form-urlencoded` from a provisioned
Twilio Messaging Service. Provisioning is currently an operator action; no
client endpoint can create integrations or submit secrets. For each tenant,
use a dedicated Twilio subaccount and Messaging Service. The tenant's
`Integration` row must use `provider = twilio`, `category = MESSAGING`, an
enabled status, `externalAccountId` equal to the Twilio Account SID, and
non-secret `configuration` containing `messagingServiceSid`, `phoneNumber`
(E.164), and the exact public HTTPS `webhookUrl`. The URL must be
`https://<public-host>/<API_GLOBAL_PREFIX>/webhooks/twilio/inbound/<integration-uuid>`
(`api` is the default prefix); keep
any query string identical between Twilio and the configuration. It must not
be an internal proxy URL.

Set `credentialsRef` to a tenant-specific environment reference such as
`env:VAUTRIN_TWILIO_TENANT_A`. Inject that variable from Secret Manager into
both the API and worker processes as JSON with `accountSid`, `apiKeySid`,
`apiKeySecret`, `webhookAuthToken`, and `messagingServiceSid`. Do not place the
JSON or tokens in the database, repository, or Bruno collection. The worker's
API key authenticates REST sends; the subaccount Auth Token validates inbound
and status-callback signatures. Twilio must POST its full
form body and `X-Twilio-Signature` header to the configured URL. The API
rejects a wrong path/query, signature, Account SID, or recipient number before
writing tenant data. Replays are acknowledged without duplicating the message.

The status callback URL is derived from the configured inbound URL by changing
`/inbound/` to `/status/` and adding the local message ID query parameter; no
second callback URL needs to be provisioned. Complete applicable sender
registration and consent review before live traffic.

The Google Calendar adapter and OAuth refresh client live in
`@vautrin/integrations`; appointment API operations use this provider boundary. The API's
tenant-scoped connection resolver expects a connected `Integration` with
`provider = google_calendar`, `category = CALENDAR`, and non-secret
`configuration.calendarId`. Set `credentialsRef` to a tenant-specific
`env:VAUTRIN_GOOGLE_CALENDAR_*` reference, injected from Secret Manager as
JSON containing `clientId`, `clientSecret`, and `refreshToken`. Obtain the
refresh token through the [Google web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server)
with offline access and the minimum Calendar scopes needed for free/busy and
event changes. Consent and callback handling are not implemented yet; integration
credentials must be provisioned by an operator. Do not put access or refresh
tokens in business settings.

`businessHours` is read and written as part of `/business/profile`; it uses the
existing tenant profile JSON field. V1 requires `{ timezone, weekly: { monday,
..., sunday } }`. Each day has `enabled` and sorted, non-overlapping local
`HH:mm` periods. Disabled days have none; enabled days have at least one.
`start` must be before `end`, and `timezone` must be a valid IANA zone.
Overnight periods and date-specific exceptions are not supported. A data
migration nests previously stored flat weekday entries. The timezone here is
authoritative; `bookingRules.scheduling` has no timezone. The validated
`bookingRules` JSON lives in `/business/settings`. Its required-field paths are
limited to `contact.name`, `contact.phone`, `contact.address`, and `lead.service`;
they never create persistence fields. Enabled V1 rules require double-booking
prevention, because overbooking is deferred. Booking remains unavailable until
both configurations and exactly one connected Google Calendar integration exist.

`POST /appointments/availability` takes `leadId`, `appointmentTypeId`, `from`,
and `to` (ISO timestamps; maximum window 31 days). `POST /appointments` takes
`leadId`, `appointmentTypeId`, `startsAt`, and a UUID `idempotencyKey`; it
revalidates policy and calendar occupancy at creation.
`POST /appointments/:id/reschedule` takes `startsAt` and `idempotencyKey`;
`POST /appointments/:id/cancel` optionally takes `reason`. The existing read/list
endpoints return tenant-scoped appointments. Booking failures carry a stable
`BOOKING_*` code, with `missingFields` for qualification failures. The booking
boundary serializes local writes per tenant and uses a deterministic calendar
event ID so a create retry can reconcile a provider success after a database
rollback. Calendar operations are synchronous inside the booking transaction;
slow provider calls can therefore delay or fail bookings and need operational
monitoring. A separate agent tool is not yet wired to these API operations.

Custom field definitions are tenant-scoped and paginated. Definition changes
require `business.manage`;
custom field value reads/writes instead require the matching entity capability
(`contact.read/write`, `lead.read/write`, or `estimate.read/write`), with
`:entityType` set to `CONTACT`, `LEAD`, or `ESTIMATE`. Values can be stored only
against an existing record in the active tenant. Field types use the existing
`CustomFieldType` enum; option values are stored in the existing `options`
field for `SELECT` and `MULTI_SELECT`. Appointment custom fields are not
exposed by the VOS-046 API scope.

## Conventions

**Validation.** A global `ValidationPipe` runs with `whitelist` and
`forbidNonWhitelisted`, so unknown properties are stripped and then rejected.
Endpoints take a DTO — that is what makes the rule enforceable.

**Errors.** `AllExceptionsFilter` gives every failure one shape. Unexpected
exceptions are logged in full and returned as a bare 500: stack traces and
driver errors are useless to a caller and useful to an attacker
(AGENTS.md §8).

**Shutdown.** Shutdown hooks are enabled so SIGTERM drains in-flight requests
and closes the database pool during a rolling deploy.

## Not here yet

Estimate, Knowledge, integration self-service management, Analytics, and structured JSON logging with correlation IDs
(VOS-120) remain future work. The API currently uses Nest's default logger.
