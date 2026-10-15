<script setup lang="ts">
import type {
  IntegrationPage,
  IntegrationSummary,
  MissedCallResponse,
  RemodelingTemplateResponse,
} from '@vautrin/contracts';

const { request, can } = useSession();
const emit = defineEmits<{ installed: [] }>();
const integrations = ref<IntegrationSummary[]>([]);
const nextCursor = ref<string | null>(null);
const error = ref('');
const success = ref('');
const busy = ref(false);
const postalCodes = ref('');
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone);
const model = ref('');
const calendarId = ref('primary');
const caller = ref('');
const pendingCallKey = ref<string | null>(null);
const pendingCaller = ref('');
async function load(cursor?: string) {
  if (!can('integration.manage')) return;
  try {
    const page = await request<IntegrationPage>('/integrations', { query: { limit: 25, cursor } });
    integrations.value = cursor ? [...integrations.value, ...page.items] : [...page.items];
    nextCursor.value = page.nextCursor;
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  }
}
async function install() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await request<RemodelingTemplateResponse>('/templates/remodeling', {
      method: 'POST',
      body: {
        postalCodes: postalCodes.value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        timezone: timezone.value,
        model: model.value.trim(),
      },
    });
    emit('installed');
    success.value =
      'Remodeling services, qualification, booking rules, receptionist and recovery workflows are installed. Review them in Settings, Workflows and AI Workforce.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function connect() {
  busy.value = true;
  error.value = '';
  try {
    const result = await request<{ authorizationUrl: string }>(
      '/integrations/google-calendar/connect',
      { method: 'POST', body: { calendarId: calendarId.value.trim() } },
    );
    const url = new URL(result.authorizationUrl);
    if (url.origin !== 'https://accounts.google.com')
      throw new Error('Unexpected calendar authorization URL.');
    window.location.assign(url.toString());
  } catch (cause) {
    error.value = apiErrorMessage(cause);
    busy.value = false;
  }
}
async function disconnect(id: string) {
  busy.value = true;
  error.value = '';
  try {
    await request(`/integrations/${id}`, { method: 'DELETE' });
    await load();
    success.value = 'Integration disconnected.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function recordCall() {
  busy.value = true;
  error.value = '';
  const phone = caller.value.trim();
  if (phone !== pendingCaller.value || !pendingCallKey.value) {
    pendingCaller.value = phone;
    pendingCallKey.value = crypto.randomUUID();
  }
  try {
    await request<MissedCallResponse>('/intake/missed-calls', {
      method: 'POST',
      body: { fromNumber: phone, idempotencyKey: pendingCallKey.value },
    });
    success.value = 'Missed call recorded. Recovery is queued.';
    pendingCallKey.value = null;
    caller.value = '';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load();
});
</script>
<template>
  <section class="surface surface__body" aria-labelledby="revenue-setup-title">
    <div class="section-head">
      <h2 id="revenue-setup-title">
        Reception and booking setup
      </h2>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">
      {{ error }}
    </p><p v-if="success" class="notice notice--success" role="status">
      {{ success }}
    </p>
    <form v-if="can('business.manage') && can('workflow.manage')" class="form-grid" @submit.prevent="install">
      <label class="field">Service postal codes<input v-model="postalCodes" placeholder="78701, 78702" required></label>
      <label class="field">Business timezone<input v-model="timezone" required></label>
      <label class="field">OpenAI model<input v-model="model" placeholder="Model configured for your OpenAI account" required></label>
      <button class="button button--secondary" :disabled="busy" type="submit">
        Install remodeling template
      </button>
    </form>
    <template v-if="can('integration.manage')">
      <div class="section-head">
        <h3>Connected integrations</h3><button class="button button--ghost button--small" :disabled="busy" @click="load()">
          Refresh
        </button>
      </div>
      <AppEmpty v-if="!integrations.length" title="No integrations connected." detail="Connect Google Calendar for booking and provision your SMS sender with the operator setup command." />
      <ul class="activity-list">
        <li v-for="integration in integrations" :key="integration.id">
          <span>{{ integration.provider }} · {{ integration.status }}<br><span class="small muted">{{ integration.configuration.calendarId || integration.configuration.phoneNumber || '' }}</span></span><button v-if="integration.status !== 'DISCONNECTED'" class="button button--ghost button--small" :disabled="busy" @click="disconnect(integration.id)">
            Disconnect
          </button>
        </li>
      </ul>
      <button v-if="nextCursor" class="button button--ghost button--small" @click="load(nextCursor)">
        Load more
      </button>
      <form class="form-grid" @submit.prevent="connect">
        <label class="field">Google Calendar ID<input v-model="calendarId" required></label><button class="button button--secondary" :disabled="busy" type="submit">
          Connect Google Calendar
        </button>
      </form>
    </template>
    <form v-if="can('contact.write') && can('lead.write') && can('conversation.write')" class="form-grid" @submit.prevent="recordCall">
      <label class="field">Missed caller phone<input v-model="caller" placeholder="+15125550101" pattern="\+[1-9][0-9]{7,14}" required></label><button class="button button--secondary" :disabled="busy" type="submit">
        Record missed call
      </button>
    </form>
    <p class="small muted">
      Recording a call can send recovery messages through your connected SMS provider. Use a controlled test number during setup.
    </p>
  </section>
</template>
