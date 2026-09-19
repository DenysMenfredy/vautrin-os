# SDD-00 — Vautrin OS Overview

## 1. Purpose

Vautrin OS is a multi-tenant SaaS platform that connects customer acquisition,
lead management, AI-assisted communication, sales workflows, appointments,
estimates, and later operational workflows into one business operating layer.

The MVP is intentionally optimized for remodeling and home-service companies
in the United States while keeping the platform core vertical-agnostic.

## 2. Product thesis

The platform should not be sold as "AI automation".

It should eliminate operational waste around:
- missed calls;
- slow lead response;
- inconsistent qualification;
- forgotten follow-ups;
- untracked estimates;
- disconnected communication channels.

## 3. MVP promise

> Capture, qualify, follow up with, and book local-business leads with an AI-assisted revenue workflow.

## 4. MVP lifecycle

```text
Inbound lead
  -> Contact identification
  -> Lead creation/update
  -> AI reception
  -> Qualification
  -> Follow-up
  -> Appointment
  -> Estimate
  -> Estimate follow-up
```

## 5. Architectural goals

### G1 — Multi-tenancy
Adding a new business must not require a new application stack.

### G2 — Vertical extensibility
New verticals should be introduced through templates/configuration wherever possible.

### G3 — Provider independence
LLM, messaging, telephony, and calendar providers must be replaceable.

### G4 — Operational reliability
External calls must be asynchronous where appropriate and retryable.

### G5 — AI safety
Agents can only act through explicit, authorized tools.

### G6 — Developer velocity
The architecture must be practical for a small engineering team assisted by coding agents.

## 6. Non-goals

V0.1 is not:
- an accounting system;
- a payment processor;
- a complete project-management suite;
- a general-purpose CRM replacement;
- an autonomous financial operator;
- a custom LLM platform.

## 7. Success criteria

The MVP is successful when a real remodeling business can:
1. configure its business profile;
2. manage contacts and leads;
3. receive inbound communication through an integrated channel;
4. have an AI agent qualify a lead;
5. execute a follow-up workflow;
6. book an appointment;
7. track an estimate;
8. automatically follow up on the estimate;
9. observe the workflow in the dashboard;
10. operate without cross-tenant data exposure.

## 8. Technology baseline

- Nuxt 4 / Vue 3
- NestJS
- TypeScript
- PostgreSQL
- pgvector
- Redis
- BullMQ
- pnpm
- Turborepo
- GitHub Actions
- Docker
