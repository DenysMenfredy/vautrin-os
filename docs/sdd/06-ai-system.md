# SDD-06 — AI System

## 1. AI is an application capability

AI is not the source of truth.

The source of truth is:
- PostgreSQL;
- configured business rules;
- approved knowledge;
- external systems through verified tools.

## 2. Provider abstraction

```ts
interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
}
```

The v0.3 provider-neutral port includes messages, structured tool calls,
normalized usage/cost metadata, and completion/stream events. Embeddings are a
separate optional capability. Provider SDK types never cross this boundary.
The port exists without a concrete adapter; provider selection is an explicit
product decision and no model call is enabled until one is selected.

Providers may include:
- OpenAI;
- Anthropic;
- xAI;
- AWS Bedrock;
- future local providers.

## 3. Agent abstraction

An agent contains:

```text
instructions
model configuration
allowed tools
business context strategy
knowledge strategy
guardrails
handoff policy
```

Agent configurations are tenant-scoped, versioned API resources. Drafts are
editable; activated/archived versions are immutable in PostgreSQL and edits
require a new draft version. Model configuration must not contain credential
material; only a reference to an approved secret mechanism may be stored.

## 4. Agent execution

```text
User event
  ↓
Load tenant
  ↓
Load business configuration
  ↓
Load conversation/contact/lead state
  ↓
Retrieve relevant knowledge
  ↓
Build model context
  ↓
LLM
  ↓
Tool call?
  ├── No → response validation → output
  └── Yes
       ↓
     authorize
       ↓
     validate
       ↓
     execute
       ↓
     audit
       ↓
     continue
```

## 5. Tool security

Each tool declares:
- name;
- description;
- input schema;
- output schema;
- permission;
- side-effect level;
- audit requirement.

Example:

```text
create_appointment
permission: appointment.write
side_effect: external
approval: no/conditional
audit: required
```

The shared runtime registry exposes only tools present in the active agent's
allow-list. It validates input and output with application-owned parsers,
checks the required permission, enforces human approval where configured, and
records a tenant-scoped `ToolExecution`. Side-effecting calls require a stable
idempotency key and acquire a durable PostgreSQL claim before the handler runs.
The model receives tool schemas and results, never database clients or raw SQL.

## 6. Business context

Structured context should be loaded from relational data.

The v0.3 context builder projects the active tenant's business profile, active
services and service areas, non-deleted location summaries, and optional
conversation/lead/contact context. Conversation history is bounded to the
latest 20 messages with a 2000-character per-message cap. Contact names, phone,
email, postal address, notes, and provider configuration are excluded from this
projection. Every lookup is tenant-scoped and rejects cross-entity mismatches.

Semantic context should be retrieved from pgvector.

Do not use RAG for:
- current appointment availability;
- lead status;
- exact customer identity;
- transactional state.

## 7. Grounding

The agent must distinguish:
- known facts;
- retrieved knowledge;
- user-provided facts;
- uncertain information.

When a business fact is unavailable, the agent must not invent it.

## 8. Human handoff

The agent should hand off when:
- requested action is outside permissions;
- confidence/grounding is insufficient;
- customer requests a human;
- business policy requires human review;
- an integration fails repeatedly.

## 9. Prompt versioning

Prompts are versioned artifacts.

Every production agent run should record:
- agent version;
- prompt version;
- model;
- provider;
- tool calls;
- latency;
- token usage/cost where available;
- final status.

`AgentRun` telemetry stores provider/model identifiers supplied by the selected
adapter, prompt/config version, latency, input/output/cached token counts when
available, estimated cost when reported, structured result (not raw transcript),
tool count, failure code, handoff status, and correlation/tenant/run references.

## 10. AI evaluation

Maintain a regression dataset containing:
- normal customer requests;
- ambiguous requests;
- unsupported requests;
- adversarial requests;
- tenant-specific business facts;
- tool execution cases;
- escalation cases.

The dataset is part of the repository and must not contain real customer PII.
