# ADR-014 - Service and Service Area Modeling

- Status: Accepted
- Date: 2026-09-21

## Context

The first vertical is remodeling, where qualification and routing depend on both the requested service and whether the property is inside the contractor's service area. These concepts are also shared by HVAC, roofing, plumbing, dental, and other local-business verticals.

Storing them only as arbitrary JSON would weaken validation, querying, analytics, and AI tool grounding.

## Decision

Create tenant-scoped relational entities:

```text
Service
- id
- tenant_id
- key
- name
- description
- active
- metadata

ServiceArea
- id
- tenant_id
- type (CITY | POSTAL_CODE | RADIUS | REGION)
- value/configuration
- active
```

Both entities use RLS. Vertical templates seed default services and qualification mappings.

## Consequences

Positive:
- reliable qualification;
- queryable service coverage;
- stronger AI grounding;
- reusable across verticals;
- analytics can group by service.

Negative:
- two additional tables and APIs;
- geospatial sophistication may require later schema evolution.

## Deferred

Do not introduce PostGIS in V0.2 unless radius/polygon requirements prove that simple city/ZIP/radius configuration is insufficient.
