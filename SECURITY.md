# Security

## Reporting

Report suspected vulnerabilities privately to the maintainers. Do not open a
public issue.

## Automated checks

Every pull request runs (`.github/workflows/ci.yml`):

| Check | What it catches |
|---|---|
| TruffleHog | Credentials committed to the repository (VOS-026). Runs with `--results=verified,unknown`, so a real secret that cannot be verified still fails. Deliberate test fixtures carry an inline `trufflehog:ignore` on the matching line. |
| `pnpm audit` | Known CVEs in the dependency tree; gated at **high** |
| Non-root assertion | A Dockerfile that lost its `USER node` |
| RLS coverage | A tenant-scoped table shipped without an RLS policy |
| CodeQL (`codeql.yml`) | Injection, tainted data reaching a sink, unsafe APIs |

The integration job additionally asserts that the runtime database role holds
neither `SUPERUSER` nor `BYPASSRLS`. Without that, every tenant-isolation test
would pass vacuously.

## Controls in place

**Tenant isolation** — PostgreSQL RLS with `ENABLE` + `FORCE` on all 25
tenant-scoped tables, enforced against a runtime role that is neither the
table owner nor `BYPASSRLS` (ADR-005). Verified by 16 integration tests
covering SELECT/INSERT/UPDATE/DELETE, conversations, workflows, vector search
and background jobs.

**Least privilege** — two database roles: `vautrin_migrator` owns the schema
and runs migrations; `vautrin_app` serves traffic and holds DML only.
Containers run as the unprivileged `node` user.

**Secrets** — never stored in the database. `integrations.credentials_ref`
points at a secret manager; `users.password_hash` holds a digest. `.env` is
git-ignored and excluded from Docker build contexts.

**Input validation** — a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so unknown properties are stripped then rejected.

**Error handling** — one response shape; unexpected exceptions are logged in
full and returned as a bare 500, so stack traces and driver errors never
reach a client.

**Headers** — `helmet` on the API; CSP, `frame-ancestors 'none'`, nosniff and
a referrer policy on the frontend.

**Proxy confinement** — the frontend's `/api` proxy rejects path traversal and
verifies the resolved target stays on the API origin and under the API path.

## Known gaps

These are tracked, not forgotten.

| Gap | Risk | Tracked as |
|---|---|---|
| No authentication or RBAC | Every endpoint is unauthenticated. Only health exists today. | VOS-030, VOS-034 |
| No rate limiting | Abuse and brute force once real endpoints exist | Post-MVP |
| No structured logging or audit writes | Limited forensics | VOS-120, VOS-121 |
| CSP allows `'unsafe-inline'` for scripts | Nuxt's hydration payload is an inline script; weakens XSS defence | Before real customer data |
| Compose files carry a default local password | A production deploy of these files would use a known password | VOS-024, VOS-025 |
| `vautrin_migrator` is `SUPERUSER` locally | Needed for `CREATE EXTENSION vector` in dev and CI | Local/CI only |

## Notes for reviewers

The compose files under `infra/` and at the repository root are **local
development tools**, not deployment artifacts. They default to a well-known
password so a clean checkout runs. Production provisioning belongs to
VOS-024/VOS-025 and must source credentials from a secret manager
(SDD-09 §7).
