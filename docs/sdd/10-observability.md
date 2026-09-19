# SDD-10 — Observability

## 1. Goals

The platform must answer:
- what happened?
- for which tenant?
- for which entity?
- which workflow/agent caused it?
- how long did it take?
- did an external provider fail?
- how much did AI execution cost?

## 2. Structured logging

Every request/job should carry:

```text
request_id
correlation_id
tenant_id
actor_id
operation
status
duration_ms
```

## 3. AI telemetry

Record where available:

```text
agent_run_id
agent_version
prompt_version
provider
model
input_tokens
output_tokens
latency_ms
tool_count
failure_reason
handoff
```

## 4. Workflow telemetry

```text
workflow_run_id
workflow_version
tenant_id
trigger_event
step
attempt
status
duration
error
```

## 5. Metrics

Initial metrics:

```text
http_requests_total
http_request_duration_ms
queue_depth
queue_failures
workflow_runs_total
workflow_failures_total
ai_runs_total
ai_failures_total
tool_executions_total
integration_errors_total
```

Business metrics:

```text
leads_created
leads_qualified
appointments_booked
estimates_sent
estimate_followups
missed_calls
recovered_leads
```

## 6. Correlation

A customer event should be traceable:

```text
call
 ↓
webhook
 ↓
event
 ↓
workflow
 ↓
agent
 ↓
tool
 ↓
SMS
```

using a shared correlation ID.

## 7. Alerts

Production alerting should eventually cover:
- API error rate;
- queue backlog;
- worker failures;
- database saturation;
- integration outage;
- unusual AI error/cost spikes.
