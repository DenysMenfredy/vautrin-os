# ADR-010 — Provider Adapter Architecture

- Status: Accepted
- Date: 2026-09-19

## Context

Messaging, voice, calendar, email, and other providers can change.

## Decision

Define domain-facing interfaces and provider adapters.

Examples:
- `MessagingProvider`;
- `CalendarProvider`;
- `VoiceProvider`.

## Consequences

Positive:
- provider portability;
- isolated integration tests;
- reduced domain coupling.

Negative:
- interfaces must avoid becoming lowest-common-denominator abstractions.

## Rule

Provider-specific functionality belongs in adapters or explicitly scoped
capability interfaces.
