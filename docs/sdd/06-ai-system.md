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
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;
  embed(input: string[]): Promise<Embedding[]>;
}
```

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

## 6. Business context

Structured context should be loaded from relational data.

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
