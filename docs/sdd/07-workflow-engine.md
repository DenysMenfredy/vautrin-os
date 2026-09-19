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

Delayed steps are persisted as queue jobs.

Do not rely on in-memory timers.

## 10. Workflow versioning

Published workflow versions are immutable.

A new configuration creates a new version.

Existing workflow runs continue using the version with which they started.

## 11. Example — missed call recovery

```json
{
  "trigger": "call.missed",
  "steps": [
    {"type": "wait", "duration": "30s"},
    {"type": "call_agent", "agent": "receptionist"},
    {"type": "send_message", "channel": "sms"},
    {"type": "wait", "duration": "24h"},
    {"type": "condition", "expression": "lead.replied == false"},
    {"type": "call_agent", "agent": "follow_up"}
  ]
}
```

The exact schema is an implementation task; the example is conceptual.
