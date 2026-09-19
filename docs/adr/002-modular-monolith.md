# ADR-002 — Modular Monolith

- Status: Accepted
- Date: 2026-09-19

## Context

The MVP needs strong domain boundaries but must remain inexpensive to develop and operate.

## Decision

Use a NestJS modular monolith for the API and a separate NestJS worker process.

Modules encapsulate:
- auth;
- tenant;
- business;
- CRM;
- conversations;
- appointments;
- estimates;
- workflows;
- AI;
- knowledge;
- integrations;
- analytics;
- audit.

## Consequences

Positive:
- fast development;
- simple deployment;
- shared transactions;
- clear module ownership.

Negative:
- a single API can become large;
- module boundaries must be actively maintained.

## Extraction rule

A module may become a separate service only when:
- scale requires it;
- deployment independence has material value;
- failure isolation is required;
- ownership/team boundaries justify it.

An ADR is required before extraction.
