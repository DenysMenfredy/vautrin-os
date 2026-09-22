# Security

## Reporting

Report suspected vulnerabilities privately to the maintainers. Do not open a
public issue.

## Automated checks

Every pull request runs the main CI workflow and the dedicated Semgrep workflow:

| Check | What it catches |
|---|---|
| TruffleHog | Credentials committed to the repository (VOS-026). Runs with `--results=verified,unknown`, so a real secret that cannot be verified still fails. Deliberate test fixtures carry an inline `trufflehog:ignore` on the matching line. |
| `pnpm audit` | Known CVEs in the dependency tree; gated at **high** |
| Non-root assertion | A Dockerfile that lost its `USER node` |
| RLS coverage | A tenant-scoped table shipped without an RLS policy |
| Semgrep (`semgrep.yml`) | Runs on every pull request and branch push; community packs (injection, unsafe APIs, OWASP Top 10) plus `.semgrep/vautrin.yml` project rules |
| Semgrep rules tests | Project-specific security rules are tested before the source scan |

The integration job additionally asserts that the runtime database role holds
neither `SUPERUSER` nor `BYPASSRLS`. Without that, every tenant-isolation test
would pass vacuously.

### CI authentication and scan exceptions

The integration job generates a new random JWT signing key for each run,
masks it in the Actions log, and supplies it through `GITHUB_ENV`.
`test:integration.passThroughEnv` in `turbo.json` forwards `JWT_SECRET` to
the uncached test processes. CI needs no repository/production signing
secret, and the key is not added to build-task environments.

The unscoped-access rule remains blocking. Reviewed call sites use
`nosemgrep: semgrep.vautrin-unscoped-database-access` with an adjacent reason:
global user and refresh-token operations follow SDD-04 §3 / ADR-013, while
tenant bootstrap establishes transaction-local tenant context before tenant
writes. These exceptions do not bypass PostgreSQL RLS and do not exclude
the containing files or other security rules. New unscoped accesses still
require review. See [Semgrep's scoped annotation documentation](https://docs.semgrep.dev/ignoring-files-folders-code#ignore-code-through-nosemgrep).

CI runs `semgrep --test --config .semgrep/vautrin.yml .semgrep/vautrin.ts
--metrics=off` before scanning application code. Explicit paths ensure that
the hidden rules directory is tested, not silently skipped. The fixtures
verify that unreviewed global/tenant queries and unsafe
proxy paths remain detectable, while tenant-scoped queries pass.

## Semgrep CI coverage and limitations

`.github/workflows/semgrep.yml` runs Semgrep Community Edition on every pull
request and branch push, plus manual `workflow_dispatch` runs. The workflow
installs a pinned CLI, tests the project rules, then scans the source tree. It
uses no repository secret or Semgrep account token, which keeps the baseline
available to private repositories and fork pull requests. See Semgrep's
[Community Edition CI configuration](https://semgrep.dev/docs/semgrep-ci/sample-ci-configs).

Findings fail the GitHub Actions job via `--error`. This tokenless CLI setup
reports in the Actions log but does not upload results to the Semgrep App
dashboard or GitHub's Security tab. Semgrep App integrations and their managed
findings require a `SEMGREP_APP_TOKEN`; those are intentionally not a
prerequisite for this repository's CI gate. See the [Semgrep GitHub CI
documentation](https://semgrep.dev/docs/semgrep-ci/overview).

The scanner combines `.semgrep/vautrin.yml` with the TypeScript,
security-audit, and OWASP Top 10 community packs. Static analysis is not a
substitute for review: in particular, review request-controlled data flows to
sensitive sinks and keep tenant-isolation tests in the integration pipeline.

## Controls in place

**Tenant isolation** — PostgreSQL RLS with `ENABLE` + `FORCE` on
tenant-scoped tables, enforced against a runtime role that is neither the
table owner nor `BYPASSRLS` (ADR-005). A migration guard, CI schema check, and
integration tests cover tenant access, business configuration, conversations,
workflows, vector search, and background jobs.

**Authentication and authorization** — short-lived JWT access tokens,
rotating refresh tokens stored as hashes, atomic rotation, family reuse
detection, active-tenant revalidation, and capability checks on protected
routes (ADR-011, ADR-013).

**Credential abuse controls** — Redis-backed expiring counters limit login
and refresh attempts by IP and account/token. The counters fail closed when
Redis is unavailable and do not permanently lock accounts.

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
| No structured request/job logging | Limited correlation and operational context | VOS-120 |
| Partial audit coverage | Business configuration is audited; customer, workflow, AI, and integration mutations remain | VOS-121 |
| No full product critical-path E2E | CRM through estimate follow-up is not implemented | VOS-022, VOS-140 |
| CSP allows `'unsafe-inline'` for scripts | Nuxt's hydration payload is an inline script; weakens XSS defence | Before real customer data |
| Compose files carry a default local password | A production deploy of these files would use a known password | VOS-024, VOS-025 |
| `vautrin_migrator` is `SUPERUSER` locally | Needed for `CREATE EXTENSION vector` in dev and CI | Local/CI only |

## Notes for reviewers

The compose files under `infra/` and at the repository root are **local
development tools**, not deployment artifacts. They default to a well-known
password so a clean checkout runs. Production provisioning belongs to
VOS-024/VOS-025 and must source credentials from a secret manager
(SDD-09 §7).
