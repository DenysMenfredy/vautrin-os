# ADR-006 — AI Provider Abstraction

- Status: Accepted
- Date: 2026-09-19

## Context

Model providers and pricing/performance change quickly. The business must not
be coupled to one vendor.

## Decision

Define internal interfaces for:
- text generation;
- streaming;
- embeddings.

Implement providers as adapters.

## Consequences

Positive:
- provider portability;
- easier testing;
- controlled cost optimization;
- future model routing.

Negative:
- abstraction has to cover meaningful common capabilities;
- provider-specific features may require optional capabilities.

## Rule

Do not expose provider SDK types through the domain layer.
