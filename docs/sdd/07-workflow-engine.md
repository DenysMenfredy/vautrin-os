# SDD-07 — Workflow Engine

## 1. Purpose

The workflow engine turns business events into reliable, configurable actions.

It is the foundation for:
- missed-call recovery;
- lead follow-up;
- estimate follow-up;
- customer re-engagement;
- review automation;
- future operations workflows.

## 2. Workflow model

```text
Workflow
 ├── Trigger
 ├── Conditions
 ├── Steps
 ├── Retry policy
 ├── Failure policy
 └── Activation state
```

### V0.3 definition API envelope

The management API stores each editable workflow version as a draft. Its
`definition` JSON has a 1–100 item `steps` array; each step has a stable `id`, a supported
lower-case `type`, and an object-valued `config`. Step IDs are unique within
the version. The supported v0.3 types are `wait`, `condition`, `send_message`,
`create_lead`, `update_lead`, `create_appointment`, `call_agent`,
`human_handoff`, and `end`. The step executor owns type-specific `config`
validation when that step becomes executable; opaque configuration is never
evaluated as code. Condition steps are validated before activation as specified
in §4. Trigger conditions, retry policy, and failure policy are stored as JSON,
but are not interpreted until their execution work lands.

Create starts version 1 in `DRAFT`. Only drafts can be edited. Activating a
draft publishes it, after which PostgreSQL enforces definition immutability.
Creating a new version copies a published version into the next draft version;
activation, pause, archive, and version creation are audited. Runs continue to
refer to the immutable version they started with.

## 3. Trigger

Examples:

```text
call.missed
lead.created
lead.updated
message.received
appointment.completed
estimate.sent
customer.inactive
```

## 4. Step types

V0.1:

```text
wait
condition
send_message
create_lead
update_lead
create_appointment
call_agent
create_task
human_approval
end
```

### Condition step (VOS-085)

Condition configuration is a structured JSON DSL only:

```json
{
  "condition": {
    "all": [
      { "field": "lead.status", "operator": "eq", "value": "QUALIFIED" },
      { "field": "contact.tags", "operator": "contains", "value": "remodeling" }
    ]
  },
  "onTrue": "send-follow-up",
  "onFalse": "finish"
}
```

Logical nodes are `all` (array), `any` (array), and `not` (one node).
Comparison nodes contain `field`, `operator`, and, except for presence checks,
`value`. The operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`,
`not_in`, `contains`, `exists`, and `not_exists`. Conditions do not accept
JavaScript, SQL, executable expressions, LLM evaluation, or evaluator-side
database access. Evaluation is deterministic and side-effect free.

The worker builds a tenant-scoped `WorkflowContext` from the typed trigger
event, the active workflow version, available structured lead/contact/
conversation state, and completed earlier step outputs. The evaluator receives
only that context. The permitted namespaces are `event`, `workflow`, `lead`,
`contact`, `conversation`, and `steps`. `workflow` exposes `id`, `key`,
`version`, and `trigger`; `event` exposes its `id`, `name`, `version`,
`occurredAt`, and typed payload fields. Lead, contact, and conversation expose
only their explicitly projected fields; in particular, contact names, email,
phone, address, and notes are not condition inputs. `steps.<stepId>.*`
can reference only a completed earlier step output. Drafts may be edited with
unfinished step configuration, but activation rejects malformed condition
trees, unsupported fields/operators, and invalid branch targets.

The current projections are deliberately explicit: `lead` exposes `id`,
`status`, `sourceId`, `service`, `assignedUserId`, `title`, `estimatedValue`,
`version`, `createdAt`, and `updatedAt`; `contact` exposes `id`, `company`,
`tags`, `createdAt`, and `updatedAt`; `conversation` exposes `id`, `leadId`,
`contactId`, `channel`, `status`, `assignedUserId`, and `lastMessageAt`.
Version-1 event payload properties are limited to `leadId`, `contactId`, `from`,
`to`, `messageId`, and `conversationId`.

The lead `estimatedValue` projection is a JSON number sourced from the bounded
`DECIMAL(12,2)` business amount; other date/time projections use ISO-8601
strings.

The AST is bounded to depth 32 and 256 nodes; field paths are at most 256
characters and 32 segments. Values are JSON scalars (or a
scalar array for `in`/`not_in`). Equality requires matching scalar types;
ordering is numeric only; `contains` supports string substring checks or
same-typed scalar array membership. No implicit coercion occurs. An incompatible
runtime value is an explicit condition-step failure. A missing field evaluates
`false` for every operator except `not_exists`, which evaluates `true`; `exists`
tests property presence, including a present `null` value. Empty `all` and `any`
use their standard boolean identities (`true` and `false`, respectively).

`onTrue` and `onFalse`, when present, must reference a later step in the same
ordered definition. This forward-only rule prevents implicit loops and keeps
step idempotency keys unique within one run; iteration requires a separately
specified bounded-loop model. The selected branch skips intervening
unselected steps. If the selected branch is absent, the run completes
successfully and any remaining steps are marked `SKIPPED`.

A valid false result is not a failure. Every evaluated condition is persisted
as a `COMPLETED` step run with the normalized condition, boolean result,
selected branch, and next step ID; a tenant-scoped audit record stores the same
decision. Invalid configuration, unavailable event context, and incompatible
operand types fail the condition step with a stable error code. The executor's
existing tenant row lock, run/step idempotency keys, and RLS context apply to
condition execution and persistence.

## 5. Execution

```text
Event
 ↓
Find active workflows
 ↓
Create WorkflowRun
 ↓
Enqueue step
 ↓
Worker executes
 ↓
Persist step result
 ↓
Next step
```

## 6. Idempotency

Every side-effecting workflow step should have an idempotency key.

Example:

```text
tenant_id
workflow_run_id
step_id
target_id
```

The same external SMS must not be sent twice because a worker retried.

## 7. Retry policy

Retries should define:
- maximum attempts;
- exponential/backoff strategy;
- retryable errors;
- terminal errors.

## 8. Failure policy

Each workflow must specify what happens when a step fails:
- retry;
- skip;
- stop;
- escalate;
- human handoff.

## 9. Scheduling

For v0.3 `wait`, `config.duration` currently accepts the positive-integer
seconds/hours forms shown in the workflow example (for example `30s` or `24h`).
The worker writes the scheduled
step and `WorkflowRun.scheduled_for` in PostgreSQL before a reconciler creates
the delayed BullMQ wake job. PostgreSQL remains authoritative: the reconciler
discovers pending/waiting run tenant IDs through a narrow database function,
then reloads and locks runs within tenant RLS. Missing jobs are recreated
after Redis loss or process restarts. On wake, the worker locks and reloads the
run, checks that the same wait step is still current and due, then advances it.

The executor supports `condition`, `wait`, and `end`. Other admitted step types
fail the step/run with an explicit `step_type_not_implemented` reason until
their specified executors land; they are not skipped or interpreted
dynamically.

Do not rely on in-memory timers.

## 10. Workflow versioning

Published workflow versions are immutable.

The database stamps `published_at` when a draft is activated and rejects
changes to the definition, trigger, policies, or version after publication.
Pause/archive only changes activation state; editing requires a new row/version.

A new configuration creates a new version.

Existing workflow runs continue using the version with which they started.

## 11. Example — lead follow-up branch

```json
{
  "trigger": "lead.status_changed",
  "steps": [
    {
      "id": "qualified",
      "type": "condition",
      "config": {
        "condition": {"field": "lead.status", "operator": "eq", "value": "QUALIFIED"},
        "onTrue": "follow-up",
        "onFalse": "finish"
      }
    },
    {"id": "follow-up", "type": "send_message", "config": {"channel": "SMS"}},
    {"id": "finish", "type": "end", "config": {}}
  ]
}
```
