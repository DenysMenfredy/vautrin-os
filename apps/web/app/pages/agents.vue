<script setup lang="ts">
import type {
  AgentPageResponse,
  AgentResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@vautrin/contracts';
import { AGENT_STATUSES } from '@vautrin/contracts';
import { dateTime, humanize } from '~/utils/presentation';

const { request, can } = useSession();
const page = ref<AgentPageResponse | null>(null);
const selected = ref<AgentResponse | null>(null);
const cursors = ref<string[]>([]);
const filter = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const actionError = ref('');
const success = ref('');
const pendingStatus = ref<'ACTIVE' | 'ARCHIVED' | null>(null);
const editor = ref<HTMLDialogElement | null>(null);
const editing = ref<AgentResponse | null>(null);
const agentKey = ref('');
const agentName = ref('');
const instructions = ref('');
const promptVersion = ref('');
const allowedTools = ref('');
const editorError = ref('');
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    page.value = await request<AgentPageResponse>('/agents', {
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
function selectAgent(agent: AgentResponse) {
  selected.value = agent;
  pendingStatus.value = null;
  actionError.value = '';
  success.value = '';
}
function showEditor(agent: AgentResponse | null = null) {
  editing.value = agent;
  agentKey.value = agent?.key ?? '';
  agentName.value = agent?.name ?? '';
  instructions.value = agent?.instructions ?? '';
  promptVersion.value = agent?.promptVersion ?? '';
  allowedTools.value = agent?.allowedTools.join('\n') ?? '';
  editorError.value = '';
  editor.value?.showModal();
}
async function saveDraft() {
  editorError.value = '';
  const tools = allowedTools.value
    .split(/[\n,]/)
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (new Set(tools).size !== tools.length) {
    editorError.value = 'Each allowed tool can appear only once.';
    return;
  }
  if (tools.some((tool) => !/^[a-z][a-z0-9_.-]{0,79}$/.test(tool))) {
    editorError.value = 'Use valid tool names, one per line.';
    return;
  }
  busy.value = true;
  try {
    const fields: UpdateAgentRequest = {
      name: agentName.value.trim(),
      instructions: instructions.value.trim(),
      promptVersion: promptVersion.value.trim(),
      allowedTools: tools,
    };
    const updated = editing.value
      ? await request<AgentResponse>(`/agents/${editing.value.id}`, {
          method: 'PATCH',
          body: fields,
        })
      : await request<AgentResponse>('/agents', {
          method: 'POST',
          body: {
            key: agentKey.value.trim(),
            name: agentName.value.trim(),
            instructions: instructions.value.trim(),
            promptVersion: promptVersion.value.trim(),
            allowedTools: tools,
          } satisfies CreateAgentRequest,
        });
    editor.value?.close();
    selected.value = updated;
    success.value = editing.value ? 'Draft saved.' : 'Draft agent created.';
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
    const draft = await request<AgentResponse>(`/agents/${selected.value.id}/versions`, {
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
    const updated = await request<AgentResponse>(`/agents/${selected.value.id}/status`, {
      method: 'PATCH',
      body: { status: pendingStatus.value },
    });
    selected.value = updated;
    if (page.value)
      page.value = {
        ...page.value,
        items: page.value.items.map((item) => (item.id === updated.id ? updated : item)),
      };
    success.value = `Agent ${humanize(updated.status).toLowerCase()}.`;
    pendingStatus.value = null;
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
useHead({ title: 'AI Workforce' });
</script>

<template>
  <div>
    <AppPageHeader title="AI Workforce" description="Versioned agent configuration and tool permissions." eyebrow="Configuration">
      <button v-if="can('business.manage')" class="button button--primary" type="button" @click="showEditor()">
        New agent
      </button>
      <button class="button button--secondary" type="button" @click="load">
        Refresh
      </button>
    </AppPageHeader>
    <div class="split-list" :class="{ 'split-list--single': !selected }">
      <section class="surface surface--flush" aria-label="Agent list">
        <div class="toolbar">
          <div class="field field--compact">
            <label for="agent-filter">Status</label><select id="agent-filter" v-model="filter" @change="reset">
              <option value="">
                All statuses
              </option><option v-for="status in AGENT_STATUSES" :key="status" :value="status">
                {{ humanize(status) }}
              </option>
            </select>
          </div>
        </div>
        <div v-if="loading" class="loading-lines" role="status" aria-label="Loading agents">
          <span /><span /><span />
        </div><div v-else-if="error" class="notice notice--error" role="alert">
          {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
            Retry
          </button>
        </div><AppEmpty v-else-if="!page?.items.length" title="No agents here." detail="Configured agent versions will appear here." />
        <template v-else>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    Agent
                  </th><th scope="col">
                    Status
                  </th><th scope="col">
                    Prompt version
                  </th><th scope="col">
                    Allowed tools
                  </th><th scope="col">
                    Updated
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="agent in page.items" :key="agent.id">
                  <td>
                    <div class="table-primary">
                      <button class="text-button" type="button" @click="selectAgent(agent)">
                        {{ agent.name }}
                      </button><span class="table-primary__sub mono">{{ agent.key }} · v{{ agent.version }}</span>
                    </div>
                  </td><td><AppBadge :value="agent.status" /></td><td class="mono">
                    {{ agent.promptVersion }}
                  </td><td>{{ agent.allowedTools.length }}</td><td class="small">
                    {{ dateTime(agent.updatedAt, timezone) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div><AppPagination :has-next="Boolean(page.nextCursor)" :has-previous="cursors.length > 0" @next="next" @previous="previous" />
        </template>
      </section>
      <aside v-if="selected" class="detail-panel" aria-label="Agent details">
        <div class="detail-panel__head">
          <div>
            <p class="eyebrow">
              Agent version
            </p><h2>{{ selected.name }}</h2><span class="small muted">{{ selected.key }} · v{{ selected.version }}</span>
          </div><button class="close-button" type="button" aria-label="Close details" @click="selected = null">
            <AppIcon name="close" />
          </button>
        </div><div class="detail-panel__body">
          <AppBadge :value="selected.status" /><p class="notice small">
            Agent execution is not connected to the workflow worker yet. Active means this configuration is available for future use.
          </p><dl class="detail-list">
            <dt>Prompt version</dt><dd class="mono">
              {{ selected.promptVersion }}
            </dd><dt>Allowed tools</dt><dd>{{ selected.allowedTools.length ? selected.allowedTools.join(', ') : 'None' }}</dd><dt>Updated</dt><dd>{{ dateTime(selected.updatedAt, timezone) }}</dd>
          </dl><div>
            <h3>Instructions</h3><p class="small muted instructions">
              {{ selected.instructions }}
            </p>
          </div><div v-if="can('business.manage')" class="form-actions">
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
          </div><template v-if="can('business.manage') && selected.status !== 'ARCHIVED'">
            <hr class="divider"><div class="form-stack">
              <h3>Lifecycle</h3><div class="form-actions">
                <button v-if="selected.status === 'DRAFT'" class="button button--secondary button--small" type="button" @click="pendingStatus = 'ACTIVE'">
                  Activate
                </button><button v-if="selected.status === 'ACTIVE'" class="button button--danger button--small" type="button" @click="pendingStatus = 'ARCHIVED'">
                  Archive
                </button>
              </div><div v-if="pendingStatus" class="notice notice--warning">
                <p>{{ pendingStatus === 'ACTIVE' ? 'Activating this version makes it available to authorized workflows.' : 'Archiving removes this version from active use.' }} Review its instructions and allowed tools first.</p><div class="form-actions">
                  <button class="button button--primary button--small" type="button" :disabled="busy" @click="setStatus">
                    {{ busy ? 'Updating…' : 'Confirm change' }}
                  </button><button class="button button--secondary button--small" type="button" @click="pendingStatus = null">
                    Keep current status
                  </button>
                </div>
              </div>
            </div>
          </template>
          <p v-if="actionError" class="inline-error" role="alert">
            {{ actionError }}
          </p><p v-if="success" class="inline-success" role="status">
            {{ success }}
          </p>
        </div>
      </aside>
    </div>
    <dialog ref="editor" class="modal" aria-label="Agent draft editor">
      <form class="form-stack" @submit.prevent="saveDraft">
        <div class="modal__head">
          <div>
            <p class="eyebrow">
              AI Workforce
            </p><h2>{{ editing ? 'Edit draft agent' : 'New agent' }}</h2>
          </div>
          <button class="close-button" type="button" aria-label="Close" @click="editor?.close()">
            <AppIcon name="close" />
          </button>
        </div>
        <p class="small muted">
          Instructions and tool permissions are versioned. Review them before activation.
        </p>
        <div class="form-grid">
          <div class="field">
            <label for="agent-key">Key</label><input
              id="agent-key"
              v-model="agentKey"
              required
              maxlength="80"
              pattern="[a-z0-9][a-z0-9_-]*"
              :disabled="Boolean(editing)"
              placeholder="receptionist"
            >
          </div>
          <div class="field">
            <label for="agent-prompt-version">Prompt version</label><input
              id="agent-prompt-version"
              v-model="promptVersion"
              required
              maxlength="80"
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
              placeholder="receptionist-v1"
            >
          </div>
        </div>
        <div class="field">
          <label for="agent-name">Name</label><input id="agent-name" v-model="agentName" required maxlength="200">
        </div>
        <div class="field">
          <label for="agent-instructions">Instructions</label><textarea
            id="agent-instructions"
            v-model="instructions"
            required
            maxlength="20000"
            rows="8"
          />
        </div>
        <div class="field">
          <label for="agent-tools">Allowed tools</label><textarea id="agent-tools" v-model="allowedTools" rows="3" placeholder="lead.lookup" /><small>One registered tool name per line. Leave empty to grant no tools.</small>
        </div>
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
