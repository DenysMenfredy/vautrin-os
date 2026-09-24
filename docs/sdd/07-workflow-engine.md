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
evaluated as code. Trigger conditions, retry policy, and failure policy are
stored as JSON, but are not interpreted until their execution work lands.

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

The initial executor supports `wait` and `end`. Other admitted step types fail
the step/run with an explicit `step_type_not_implemented` reason until their
specified executors land; they are not skipped or interpreted dynamically.

Do not rely on in-memory timers.

## 10. Workflow versioning

Published workflow versions are immutable.

The database stamps `published_at` when a draft is activated and rejects
changes to the definition, trigger, policies, or version after publication.
Pause/archive only changes activation state; editing requires a new row/version.

A new configuration creates a new version.

Existing workflow runs continue using the version with which they started.

## 11. Example — missed call recovery

```json
{
  "trigger": "call.missed",
  "steps": [
    {"id": "initial-delay", "type": "wait", "config": {"duration": "30s"}},
    {"id": "receptionist", "type": "call_agent", "config": {"agent": "receptionist"}},
    {"id": "first-follow-up", "type": "send_message", "config": {"channel": "sms"}},
    {"id": "next-day-delay", "type": "wait", "config": {"duration": "24h"}},
    {"id": "unreplied", "type": "condition", "config": {"expression": "lead.replied == false"}},
    {"id": "follow-up-agent", "type": "call_agent", "config": {"agent": "follow_up"}}
  ]
}
```

The exact schema is an implementation task; the example is conceptual.
