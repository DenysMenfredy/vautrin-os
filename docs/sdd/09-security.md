# SDD-09 — Security Specification

## 1. Threat model

The platform handles:
- customer contact information;
- business information;
- conversations;
- appointments;
- estimates;
- integration credentials;
- AI-generated actions.

Primary threats:
- cross-tenant access;
- credential leakage;
- unauthorized AI actions;
- webhook spoofing;
- prompt injection;
- data leakage through logs;
- insecure background jobs.

## 2. Authentication

Use short-lived access credentials and a secure refresh/session mechanism.

Authentication identifies the user.
Authorization determines what the user can do.

## 3. Authorization

Permissions are scoped to:
- tenant;
- role;
- capability.

Example:

```text
lead.read
lead.write
appointment.read
appointment.write
estimate.read
estimate.write
workflow.manage
integration.manage
audit.read
```

## 4. AI authorization

AI tools have their own permissions.

A user may have:

```text
estimate.write
```

without granting an AI agent:

```text
estimate.approve
```

## 5. Prompt injection

Retrieved/customer-provided text is untrusted input.

The system must not treat arbitrary customer content as system policy.

Business rules and tool permissions live outside the model's generated text.

## 6. Sensitive actions

Potentially high-impact actions require:
- explicit authorization;
- validation;
- audit;
- optional human approval.

Examples:
- changing estimate totals;
- refunds;
- deleting customer data;
- changing business rules.

## 7. Secrets

Secrets must be injected through environment/secret-management infrastructure.

Never commit:
- API keys;
- OAuth client secrets;
- database passwords;
- JWT secrets;
- provider tokens.

## 8. Logging

Do not log:
- raw credentials;
- access tokens;
- passwords;
- unnecessary full message bodies;
- unnecessary customer PII.

Use IDs and metadata wherever possible.

## 9. Data retention

Retention policies must be defined before production scale.

The system must support future deletion/anonymization workflows.

## 10. Audit

Audit state-changing actions involving:
- authentication;
- authorization;
- AI tools;
- integrations;
- workflow activation;
- customer/lead mutations;
- high-impact operations.
