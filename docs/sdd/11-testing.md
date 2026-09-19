# SDD-11 — Testing Strategy

## 1. Test pyramid

```text
        E2E
       /    Integration
    /        Unit / Domain
```

## 2. Unit tests

Test:
- domain state transitions;
- qualification rules;
- workflow conditions;
- permission logic;
- tool input validation.

## 3. Integration tests

Test:
- repositories;
- PostgreSQL;
- RLS;
- Redis/BullMQ;
- provider adapters with mocks/test servers.

## 4. Tenant isolation tests

Every security-sensitive repository should include cross-tenant tests.

Minimum:

```text
Tenant A cannot read Tenant B
Tenant A cannot write Tenant B
Tenant A cannot delete Tenant B
```

## 5. E2E tests

Critical path:

```text
Create tenant
 -> configure business
 -> create lead
 -> receive inbound event
 -> AI qualification
 -> follow-up
 -> book appointment
 -> create estimate
 -> estimate follow-up
```

## 6. AI evaluation

AI tests are behavioral regression tests, not exact string tests.

Evaluate:
- correctness;
- grounding;
- tool selection;
- parameter correctness;
- refusal/escalation;
- hallucination resistance;
- business-rule compliance.

## 7. External providers

Never make normal CI depend on real paid providers.

Use:
- mocks;
- contract tests;
- sandbox environments where available.

## 8. Test data

Synthetic data only.

Never commit real customer PII.

## 9. CI gates

A pull request must pass:
- lint;
- typecheck;
- unit;
- integration;
- build;
- affected E2E tests;
- security/secret checks.
