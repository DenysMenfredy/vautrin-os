<script setup lang="ts">
import type {
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowDefinition,
  WorkflowPageResponse,
  WorkflowResponse,
} from '@vautrin/contracts';
import { WORKFLOW_STATUSES } from '@vautrin/contracts';
import { dateTime, humanize } from '~/utils/presentation';
import {
  type DraftWorkflowStep,
  emptyStep,
  toDraftSteps,
  toWorkflowDefinition,
} from '~/utils/workflow-draft';

const { request, can } = useSession();
const page = ref<WorkflowPageResponse | null>(null);
const selected = ref<WorkflowResponse | null>(null);
const cursors = ref<string[]>([]);
const filter = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const actionError = ref('');
const success = ref('');
const pendingStatus = ref<'ACTIVE' | 'PAUSED' | 'ARCHIVED' | null>(null);
const editor = ref<HTMLDialogElement | null>(null);
const editing = ref<WorkflowResponse | null>(null);
const draftKey = ref('');
const draftName = ref('');
const draftDescription = ref('');
const draftTrigger = ref('lead.created');
const draftSteps = ref<DraftWorkflowStep[]>([]);
const editorError = ref('');
let nextStepNumber = 2;
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    page.value = await request<WorkflowPageResponse>('/workflows', {
      query: { limit: 25, cursor: cursors.value.at(-1), status: filter.value },
    });
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}
function reset() {
  cursors.value = [];
  selected.value = null;
  void load();
}
function next() {
  if (page.value?.nextCursor) {
    cursors.value.push(page.value.nextCursor);
    void load();
  }
}
function previous() {
  cursors.value.pop();
  void load();
}
function selectWorkflow(workflow: WorkflowResponse) {
  selected.value = workflow;
  pendingStatus.value = null;
  actionError.value = '';
  success.value = '';
}
function showEditor(workflow: WorkflowResponse | null = null) {
  const steps = workflow ? toDraftSteps(workflow.definition) : [emptyStep(1)];
  if (!steps) {
    actionError.value =
      'This definition contains advanced or unsupported steps. It can be viewed and versioned here, but cannot be safely edited with this linear editor.';
    return;
  }
  editing.value = workflow;
  draftKey.value = workflow?.key ?? '';
  draftName.value = workflow?.name ?? '';
  draftDescription.value = workflow?.description ?? '';
  draftTrigger.value = workflow?.trigger ?? 'lead.created';
  draftSteps.value = steps;
  nextStepNumber = steps.length + 1;
  editorError.value = '';
  editor.value?.showModal();
}
function addStep() {
  draftSteps.value.push(emptyStep(nextStepNumber++));
}
function moveStep(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= draftSteps.value.length) return;
  const step = draftSteps.value[index];
  const other = draftSteps.value[target];
  if (!step || !other) return;
  draftSteps.value[index] = other;
  draftSteps.value[target] = step;
}
async function saveDraft() {
  editorError.value = '';
  let definition: WorkflowDefinition;
  try {
    definition = toWorkflowDefinition(draftSteps.value);
  } catch (cause) {
    editorError.value = cause instanceof Error ? cause.message : 'Invalid workflow steps.';
    return;
  }
  busy.value = true;
  try {
    const fields: UpdateWorkflowRequest = {
      name: draftName.value.trim(),
      description: draftDescription.value.trim() || null,
      trigger: draftTrigger.value.trim(),
      definition,
    };
    const updated = editing.value
      ? await request<WorkflowResponse>(`/workflows/${editing.value.id}`, {
          method: 'PATCH',
          body: fields,
        })
      : await request<WorkflowResponse>('/workflows', {
          method: 'POST',
          body: {
            key: draftKey.value.trim(),
            name: draftName.value.trim(),
            description: draftDescription.value.trim() || null,
            trigger: draftTrigger.value.trim(),
            definition,
          } satisfies CreateWorkflowRequest,
        });
    editor.value?.close();
    selected.value = updated;
    success.value = editing.value ? 'Draft saved.' : 'Draft workflow created.';
    await load();
  } catch (cause) {
    editorError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function createVersion() {
  if (!selected.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const draft = await request<WorkflowResponse>(`/workflows/${selected.value.id}/versions`, {
      method: 'POST',
    });
    selected.value = draft;
    success.value = `Draft version ${draft.version} created.`;
    await load();
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function setStatus() {
  if (!selected.value || !pendingStatus.value) return;
  busy.value = true;
  actionError.value = '';
  success.value = '';
  try {
    const updated = await request<WorkflowResponse>(`/workflows/${selected.value.id}/status`, {
      method: 'PATCH',
      body: { status: pendingStatus.value },
    });
    selected.value = updated;
    if (page.value)
      page.value = {
        ...page.value,
        items: page.value.items.map((item) => (item.id === updated.id ? updated : item)),
      };
    success.value = `Workflow ${humanize(updated.status).toLowerCase()}.`;
    pendingStatus.value = null;
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
useHead({ title: 'Workflows' });
</script>

<template>
  <div>
    <AppPageHeader title="Workflows" description="Event workflows and their current states." eyebrow="Operations">
      <button v-if="can('workflow.manage')" class="button button--primary" type="button" @click="showEditor()">
        New workflow
      </button>
      <button class="button button--secondary" type="button" @click="load">
        Refresh
      </button>
    </AppPageHeader>
    <div class="split-list" :class="{ 'split-list--single': !selected }">
      <section class="surface surface--flush" aria-label="Workflow list">
        <div class="toolbar">
          <div class="field field--compact">
            <label for="workflow-filter">Status</label><select id="workflow-filter" v-model="filter" @change="reset">
              <option value="">
                All statuses
              </option><option v-for="status in WORKFLOW_STATUSES" :key="status" :value="status">
                {{ humanize(status) }}
              </option>
            </select>
          </div>
        </div>
        <div v-if="loading" class="loading-lines" role="status" aria-label="Loading workflows">
          <span /><span /><span />
        </div><div v-else-if="error" class="notice notice--error" role="alert">
          {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
            Retry
          </button>
        </div><AppEmpty v-else-if="!page?.items.length" title="No workflows here." detail="Configured workflows will appear here." />
        <template v-else>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    Workflow
                  </th><th scope="col">
                    Trigger
                  </th><th scope="col">
                    Status
                  </th><th scope="col">
                    Version
                  </th><th scope="col">
                    Updated
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="workflow in page.items" :key="workflow.id">
                  <td>
                    <div class="table-primary">
                      <button class="text-button" type="button" @click="selectWorkflow(workflow)">
                        {{ workflow.name }}
                      </button><span class="table-primary__sub mono">{{ workflow.key }}</span>
                    </div>
                  </td><td class="mono">
                    {{ workflow.trigger }}
                  </td><td><AppBadge :value="workflow.status" /></td><td class="mono">
                    v{{ workflow.version }}
                  </td><td class="small">
                    {{ dateTime(workflow.updatedAt, timezone) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div><AppPagination :has-next="Boolean(page.nextCursor)" :has-previous="cursors.length > 0" @next="next" @previous="previous" />
        </template>
      </section>
      <aside v-if="selected" class="detail-panel" aria-label="Workflow details">
        <div class="detail-panel__head">
          <div>
            <p class="eyebrow">
              Workflow definition
            </p><h2>{{ selected.name }}</h2><span class="small muted">Version {{ selected.version }}</span>
          </div><button class="close-button" type="button" aria-label="Close details" @click="selected = null">
            <AppIcon name="close" />
          </button>
        </div><div class="detail-panel__body">
          <AppBadge :value="selected.status" /><p v-if="selected.description" class="muted">
            {{ selected.description }}
          </p><dl class="detail-list">
            <dt>Trigger</dt><dd class="mono">
              {{ selected.trigger }}
            </dd><dt>Published</dt><dd>{{ dateTime(selected.publishedAt, timezone) }}</dd><dt>Last run</dt><dd>Not available yet</dd><dt>Success rate</dt><dd>Not available yet</dd>
          </dl><hr class="divider"><div>
            <h3>Steps</h3><ol class="step-list">
              <li v-for="step in selected.definition.steps" :key="step.id">
                <div><span class="strong">{{ humanize(step.type) }}</span><br><span class="small mono muted">{{ step.id }}</span></div>
              </li>
            </ol>
          </div><div v-if="can('workflow.manage')" class="form-actions">
            <button v-if="selected.status === 'DRAFT'" class="button button--secondary button--small" type="button" @click="showEditor(selected)">
              Edit draft
            </button><button
              v-else
              class="button button--secondary button--small"
              type="button"
              :disabled="busy"
              @click="createVersion"
            >
              Create new version
            </button>
          </div><template v-if="can('workflow.manage')">
            <hr class="divider"><div class="form-stack">
              <h3>Lifecycle</h3><div class="form-actions">
                <button v-if="selected.status !== 'ACTIVE' && selected.status !== 'ARCHIVED'" class="button button--secondary button--small" type="button" @click="pendingStatus = 'ACTIVE'">
                  Activate
                </button><button v-if="selected.status === 'ACTIVE'" class="button button--secondary button--small" type="button" @click="pendingStatus = 'PAUSED'">
                  Pause
                </button><button v-if="selected.status === 'ACTIVE' || selected.status === 'PAUSED'" class="button button--danger button--small" type="button" @click="pendingStatus = 'ARCHIVED'">
                  Archive
                </button>
              </div><div v-if="pendingStatus" class="notice notice--warning">
                <p>Changing this workflow to {{ humanize(pendingStatus).toLowerCase() }} affects future event handling. Existing queued work may still finish.</p><div class="form-actions">
                  <button class="button button--primary button--small" type="button" :disabled="busy" @click="setStatus">
                    {{ busy ? 'Updating…' : `Confirm ${humanize(pendingStatus).toLowerCase()}` }}
                  </button><button class="button button--secondary button--small" type="button" @click="pendingStatus = null">
                    Keep current status
                  </button>
                </div>
              </div><p v-if="actionError" class="inline-error" role="alert">
                {{ actionError }}
              </p><p v-if="success" class="inline-success" role="status">
                {{ success }}
              </p>
            </div>
          </template>
        </div>
      </aside>
    </div>
    <dialog ref="editor" class="modal modal--wide" aria-label="Workflow draft editor">
      <form class="form-stack" @submit.prevent="saveDraft">
        <div class="modal__head">
          <div>
            <p class="eyebrow">
              Automation
            </p><h2>{{ editing ? 'Edit draft workflow' : 'New workflow' }}</h2>
          </div>
          <button class="close-button" type="button" aria-label="Close" @click="editor?.close()">
            <AppIcon name="close" />
          </button>
        </div>
        <p class="small muted">
          Build a linear flow using steps the worker can execute. Activation uses the saved definition.
        </p>
        <div class="form-grid">
          <div class="field">
            <label for="workflow-key">Key</label><input
              id="workflow-key"
              v-model="draftKey"
              required
              maxlength="80"
              pattern="[a-z0-9][a-z0-9_-]*"
              :disabled="Boolean(editing)"
              placeholder="lead_follow_up"
            >
          </div>
          <div class="field">
            <label for="workflow-name">Name</label><input id="workflow-name" v-model="draftName" required maxlength="200">
          </div>
        </div>
        <div class="field">
          <label for="workflow-description">Description</label><textarea id="workflow-description" v-model="draftDescription" maxlength="2000" rows="2" />
        </div>
        <div class="field">
          <label for="workflow-trigger">Trigger event</label><input
            id="workflow-trigger"
            v-model="draftTrigger"
            required
            maxlength="100"
            pattern="[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*"
            list="workflow-events"
          ><small>Runs when the matching tenant event occurs.</small>
        </div>
        <datalist id="workflow-events">
          <option value="lead.created" /><option value="lead.status_changed" /><option value="message.received" /><option value="appointment.created" />
        </datalist>
        <div class="editor-heading">
          <h3>Steps</h3><button class="button button--secondary button--small" type="button" :disabled="draftSteps.length >= 100" @click="addStep">
            Add step
          </button>
        </div>
        <ol class="draft-steps">
          <li v-for="(step, index) in draftSteps" :key="index" class="draft-step">
            <div class="draft-step__head">
              <span class="eyebrow">Step {{ index + 1 }}</span><div class="form-actions">
                <button
                  class="text-button small"
                  type="button"
                  :disabled="index === 0"
                  :aria-label="`Move step ${index + 1} up`"
                  @click="moveStep(index, -1)"
                >
                  Up
                </button><button
                  class="text-button small"
                  type="button"
                  :disabled="index === draftSteps.length - 1"
                  :aria-label="`Move step ${index + 1} down`"
                  @click="moveStep(index, 1)"
                >
                  Down
                </button><button
                  class="text-button small"
                  type="button"
                  :disabled="draftSteps.length === 1"
                  :aria-label="`Remove step ${index + 1}`"
                  @click="draftSteps.splice(index, 1)"
                >
                  Remove
                </button>
              </div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label :for="`step-id-${index}`">Step ID</label><input
                  :id="`step-id-${index}`"
                  v-model="step.id"
                  required
                  maxlength="64"
                  pattern="[a-z][a-z0-9_-]*"
                >
              </div><div class="field">
                <label :for="`step-type-${index}`">Action</label><select :id="`step-type-${index}`" v-model="step.type">
                  <option value="wait">
                    Wait
                  </option><option value="condition">
                    Condition
                  </option><option value="send_message">
                    Send SMS
                  </option><option value="end">
                    End
                  </option>
                </select>
              </div>
            </div>
            <div v-if="step.type === 'wait'" class="field">
              <label :for="`step-duration-${index}`">Duration</label><input :id="`step-duration-${index}`" v-model="step.duration" placeholder="30s" pattern="[1-9][0-9]*(s|h)"><small>Positive seconds (s) or hours (h).</small>
            </div>
            <div v-if="step.type === 'send_message'" class="field">
              <label :for="`step-body-${index}`">SMS message</label><textarea :id="`step-body-${index}`" v-model="step.body" maxlength="1600" rows="3" /><small>Literal text, up to 1600 characters. Delivery needs a configured SMS integration and eligible contact.</small>
            </div>
            <template v-if="step.type === 'condition'">
              <div class="form-grid">
                <div class="field">
                  <label :for="`step-field-${index}`">Context field</label><input :id="`step-field-${index}`" v-model="step.field" placeholder="lead.status">
                </div><div class="field">
                  <label :for="`step-operator-${index}`">Comparison</label><select :id="`step-operator-${index}`" v-model="step.operator">
                    <option value="eq">
                      Equals
                    </option><option value="neq">
                      Does not equal
                    </option><option value="contains">
                      Contains
                    </option><option value="exists">
                      Exists
                    </option><option value="not_exists">
                      Does not exist
                    </option>
                  </select>
                </div>
              </div><div v-if="step.operator !== 'exists' && step.operator !== 'not_exists'" class="field">
                <label :for="`step-value-${index}`">Value</label><input :id="`step-value-${index}`" v-model="step.value">
              </div><div class="form-grid">
                <div class="field">
                  <label :for="`step-true-${index}`">If true, go to</label><select :id="`step-true-${index}`" v-model="step.onTrue">
                    <option value="">
                      Finish workflow
                    </option><option v-for="later in draftSteps.slice(index + 1)" :key="later.id" :value="later.id">
                      {{ later.id }}
                    </option>
                  </select>
                </div><div class="field">
                  <label :for="`step-false-${index}`">If false, go to</label><select :id="`step-false-${index}`" v-model="step.onFalse">
                    <option value="">
                      Finish workflow
                    </option><option v-for="later in draftSteps.slice(index + 1)" :key="later.id" :value="later.id">
                      {{ later.id }}
                    </option>
                  </select>
                </div>
              </div>
            </template>
          </li>
        </ol>
        <p v-if="editorError" class="inline-error" role="alert">
          {{ editorError }}
        </p>
        <div class="form-actions">
          <button class="button button--primary" type="submit" :disabled="busy">
            {{ busy ? 'Saving…' : 'Save draft' }}
          </button><button class="button button--secondary" type="button" @click="editor?.close()">
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
