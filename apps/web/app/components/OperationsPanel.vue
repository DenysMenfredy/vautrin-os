<script setup lang="ts">
import type { OperationsSummary, WorkflowRunDetail, WorkflowRunPage } from '@vautrin/contracts';
import { dateTime, humanize } from '~/utils/presentation';

const { request, can } = useSession();
const summary = ref<OperationsSummary | null>(null);
const runs = ref<WorkflowRunPage | null>(null);
const detail = ref<WorkflowRunDetail | null>(null);
const status = ref('');
const currentCursor = ref<string | undefined>();
const error = ref('');
const busy = ref(false);
async function load(cursor?: string) {
  busy.value = true;
  error.value = '';
  try {
    const result = await Promise.all([
      request<OperationsSummary>('/operations/summary'),
      request<WorkflowRunPage>('/operations/runs', {
        query: { limit: 10, status: status.value || undefined, cursor },
      }),
    ]);
    summary.value = result[0];
    runs.value = result[1];
    currentCursor.value = cursor;
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function inspect(id: string) {
  error.value = '';
  try {
    detail.value = await request<WorkflowRunDetail>(`/operations/runs/${id}`);
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  }
}
async function cancel() {
  if (!detail.value) return;
  error.value = '';
  try {
    detail.value = await request<WorkflowRunDetail>(`/operations/runs/${detail.value.id}/cancel`, {
      method: 'POST',
    });
    await load();
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  }
}
onMounted(() => {
  if (can('workflow.read')) void load();
});
</script>
<template>
  <section v-if="can('workflow.read')" aria-labelledby="automation-title">
    <div class="section-head">
      <h2 id="automation-title">
        Automation activity
      </h2><button class="button button--ghost button--small" :disabled="busy" @click="load()">
        Refresh
      </button>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">
      {{ error }}
    </p>
    <div v-if="summary" class="metrics-strip">
      <div class="metric">
        <span class="metric__label">Failed workflows</span><span class="metric__value">{{ summary.failedWorkflows }}</span><span class="metric__foot">{{ summary.waitingWorkflows }} waiting</span>
      </div>
      <div class="metric">
        <span class="metric__label">Human handoffs</span><span class="metric__value">{{ summary.handoffs }}</span><NuxtLink class="link small" to="/conversations">
          Open inbox
        </NuxtLink>
      </div>
      <div class="metric">
        <span class="metric__label">Agent runs</span><span class="metric__value">{{ summary.agentRuns }}</span><span class="metric__foot">{{ summary.inputTokens + summary.outputTokens }} reported tokens</span>
      </div>
      <div class="metric">
        <span class="metric__label">Failed messages</span><span class="metric__value">{{ summary.failedMessages }}</span><span class="metric__foot">{{ summary.pendingEvents }} pending events</span>
      </div>
    </div>
    <div class="surface surface__body">
      <label class="field">Run status<select v-model="status" @change="load()"><option value="">All statuses</option><option v-for="state in ['PENDING','RUNNING','WAITING','COMPLETED','FAILED','CANCELLED']" :key="state" :value="state">{{ humanize(state) }}</option></select></label>
      <AppEmpty v-if="!runs?.items.length" title="No automation runs yet." />
      <ul v-else class="activity-list">
        <li v-for="run in runs.items" :key="run.id">
          <span class="activity-list__text"><button class="link" @click="inspect(run.id)">{{ run.workflowKey }} · v{{ run.workflowVersion }}</button><br><span class="small muted">{{ humanize(run.status) }} · {{ run.error || run.triggerEvent }}</span></span><span class="activity-list__time">{{ dateTime(run.createdAt) }}</span>
        </li>
      </ul>
      <button v-if="runs?.nextCursor" class="button button--secondary button--small" :disabled="busy" @click="load(runs.nextCursor)">
        Next page
      </button>
      <button v-if="currentCursor" class="button button--ghost button--small" @click="load()">
        First page
      </button>
    </div>
    <div v-if="detail" class="surface surface__body">
      <div class="section-head">
        <h3>{{ detail.workflowKey }} · {{ humanize(detail.status) }}</h3><button class="button button--ghost button--small" @click="detail = null">
          Close
        </button>
      </div>
      <p v-if="detail.error" class="notice notice--error">
        {{ detail.error }}
      </p>
      <p class="small muted">
        Correlation: {{ detail.correlationId || 'Unavailable' }}
      </p>
      <ul class="activity-list">
        <li v-for="step in detail.steps" :key="step.id">
          <span>{{ step.stepId }} · {{ humanize(step.status) }}<br><span class="small muted">Attempt {{ step.attempt }} · {{ step.error || step.stepType }} · {{ step.durationMs ?? '—' }} ms</span></span><span v-if="step.scheduledFor" class="small muted">{{ dateTime(step.scheduledFor) }}</span>
        </li>
      </ul>
      <ul class="activity-list">
        <li v-for="agent in detail.agents" :key="agent.id">
          <span>{{ agent.model }} · {{ humanize(agent.status) }}<br><span class="small muted">{{ agent.toolCount }} tools · {{ agent.inputTokens ?? '—' }} input / {{ agent.outputTokens ?? '—' }} output tokens · {{ agent.handoffReason || agent.failureReason || agent.promptVersion }}</span></span>
        </li>
      </ul>
      <button v-if="can('workflow.manage') && ['PENDING','RUNNING','WAITING'].includes(detail.status)" class="button button--secondary" @click="cancel">
        Cancel remaining work
      </button>
    </div>
  </section>
</template>
