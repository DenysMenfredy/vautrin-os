<script setup lang="ts">
import type {
  BusinessProfileResponse,
  ContactResponse,
  LeadPageResponse,
  LeadResponse,
  LeadSourcePageResponse,
  LeadStatus,
  PageResponse,
  ServiceResponse,
} from '@vautrin/contracts';
import { LEAD_STATUSES } from '@vautrin/contracts';
import { contactName, dateTime, humanize, shortDate } from '~/utils/presentation';

const route = useRoute();
const { request, can } = useSession();
const page = ref<LeadPageResponse | null>(null);
const sources = ref<LeadSourcePageResponse | null>(null);
const services = ref<ServiceResponse[]>([]);
const contacts = ref<Record<string, ContactResponse>>({});
const cursors = ref<string[]>([]);
const selected = ref<LeadResponse | null>(null);
const statusChoice = ref<LeadStatus>('NEW');
const searchInput = ref(typeof route.query.search === 'string' ? route.query.search : '');
const search = ref(searchInput.value);
const status = ref('');
const sourceId = ref('');
const loading = ref(true);
const saving = ref(false);
const servicesLoading = ref(false);
const servicesLoaded = ref(false);
const servicesLoadError = ref(false);
const error = ref('');
const actionError = ref('');
const actionSuccess = ref('');
const createDialog = ref<HTMLDialogElement | null>(null);
const firstName = ref('');
const lastName = ref('');
const email = ref('');
const phone = ref('');
const title = ref('');
const service = ref('');
const pendingContactId = ref<string | null>(null);
const businessProfile = ref<BusinessProfileResponse | null>(null);
const timezone = computed(() => businessProfile.value?.timezone);

function formatValue(value: string | null): string {
  if (!value) return 'Not set';
  if (!businessProfile.value) return `${value} (currency unavailable)`;
  return new Intl.NumberFormat(businessProfile.value.locale, {
    style: 'currency',
    currency: businessProfile.value.currency,
  }).format(Number(value));
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await request<LeadPageResponse>('/leads', {
      query: {
        limit: 20,
        cursor: cursors.value.at(-1),
        status: status.value,
        sourceId: sourceId.value,
        search: search.value,
      },
    });
    page.value = result;
    if (can('contact.read')) {
      const missing = [...new Set(result.items.map((lead) => lead.contactId))].filter(
        (id) => !contacts.value[id],
      );
      await Promise.allSettled(
        missing.map(async (id) => {
          contacts.value[id] = await request<ContactResponse>(`/contacts/${id}`);
        }),
      );
    }
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  cursors.value = [];
  selected.value = null;
  void load();
}
function applySearch() {
  search.value = searchInput.value.trim();
  resetFilters();
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

async function loadServices() {
  if (servicesLoading.value || servicesLoaded.value) return;
  if (!can('business.read')) {
    servicesLoaded.value = true;
    servicesLoadError.value = true;
    return;
  }

  servicesLoading.value = true;
  servicesLoadError.value = false;
  try {
    const loaded: ServiceResponse[] = [];
    let cursor: string | undefined;
    do {
      const result = await request<PageResponse<ServiceResponse>>('/business/services', {
        query: { limit: 100, active: true, cursor },
      });
      loaded.push(...result.items);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    services.value = loaded.filter((item) => item.active);
    servicesLoaded.value = true;
  } catch {
    servicesLoadError.value = true;
  } finally {
    servicesLoading.value = false;
  }
}

async function selectLead(lead: LeadResponse) {
  selected.value = lead;
  statusChoice.value = lead.status;
  actionError.value = '';
  actionSuccess.value = '';
  if (!contacts.value[lead.contactId] && can('contact.read')) {
    try {
      contacts.value[lead.contactId] = await request<ContactResponse>(
        `/contacts/${lead.contactId}`,
      );
    } catch {
      /* The lead remains readable when contact lookup is unavailable. */
    }
  }
}

async function changeStatus() {
  if (!selected.value || statusChoice.value === selected.value.status) return;
  saving.value = true;
  actionError.value = '';
  actionSuccess.value = '';
  try {
    const updated = await request<LeadResponse>(`/leads/${selected.value.id}/status`, {
      method: 'PATCH',
      body: { version: selected.value.version, status: statusChoice.value },
    });
    selected.value = updated;
    page.value = page.value
      ? {
          ...page.value,
          items: page.value.items.map((item) => (item.id === updated.id ? updated : item)),
        }
      : null;
    actionSuccess.value = 'Lead stage updated.';
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    saving.value = false;
  }
}

async function openCreate() {
  actionError.value = '';
  createDialog.value?.showModal();
  await loadServices();
}
function closeCreate() {
  createDialog.value?.close();
}

async function createLead() {
  actionError.value = '';
  if (!email.value.trim() && !phone.value.trim()) {
    actionError.value = 'Add an email or phone number for the contact.';
    return;
  }
  saving.value = true;
  try {
    if (!pendingContactId.value) {
      const contact = await request<ContactResponse>('/contacts', {
        method: 'POST',
        body: {
          firstName: firstName.value.trim() || null,
          lastName: lastName.value.trim() || null,
          email: email.value.trim() || null,
          phone: phone.value.trim() || null,
        },
      });
      pendingContactId.value = contact.id;
      contacts.value[contact.id] = contact;
    }
    const lead = await request<LeadResponse>('/leads', {
      method: 'POST',
      body: {
        contactId: pendingContactId.value,
        title: title.value.trim() || null,
        service: service.value.trim() || null,
      },
    });
    pendingContactId.value = null;
    firstName.value = '';
    lastName.value = '';
    email.value = '';
    phone.value = '';
    title.value = '';
    service.value = '';
    closeCreate();
    cursors.value = [];
    await load();
    await selectLead(lead);
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load();
  if (can('business.read')) {
    try {
      businessProfile.value = await request<BusinessProfileResponse>('/business/profile');
    } catch {
      /* Values remain explicitly unformatted. */
    }
  }
  try {
    sources.value = await request<LeadSourcePageResponse>('/lead-sources', {
      query: { limit: 100, active: true },
    });
  } catch {
    /* Filter is optional. */
  }
  if (route.query.new === '1' && can('lead.write')) await openCreate();
  if (typeof route.query.lead === 'string') {
    const lead = page.value?.items.find((item) => item.id === route.query.lead);
    if (lead) await selectLead(lead);
    else
      try {
        await selectLead(await request<LeadResponse>(`/leads/${route.query.lead}`));
      } catch {
        /* The list already shows a useful state. */
      }
  }
});
useHead({ title: 'Leads' });
</script>

<template>
  <div>
    <AppPageHeader title="Leads" description="Find, qualify and advance your opportunities." eyebrow="Revenue pipeline">
      <button v-if="can('lead.write')" class="button button--primary" type="button" @click="openCreate">
        Add lead
      </button>
    </AppPageHeader>
    <div class="split-list" :class="{ 'split-list--single': !selected }">
      <section class="surface surface--flush" aria-label="Leads list">
        <form class="toolbar" @submit.prevent="applySearch">
          <div class="field field--compact">
            <label for="lead-search">Search leads</label><input id="lead-search" v-model="searchInput" type="search" placeholder="Name, email, phone, title or service">
          </div>
          <div class="field field--compact">
            <label for="lead-stage">Stage</label><select id="lead-stage" v-model="status" @change="resetFilters">
              <option value="">
                All stages
              </option><option v-for="stage in LEAD_STATUSES" :key="stage" :value="stage">
                {{ humanize(stage) }}
              </option>
            </select>
          </div>
          <div v-if="sources?.items.length" class="field field--compact">
            <label for="lead-source">Source</label><select id="lead-source" v-model="sourceId" @change="resetFilters">
              <option value="">
                All sources
              </option><option v-for="source in sources.items" :key="source.id" :value="source.id">
                {{ source.label }}
              </option>
            </select>
          </div>
          <button class="button button--secondary" type="submit">
            Search
          </button>
        </form>
        <div v-if="loading" class="loading-lines" role="status" aria-label="Loading leads">
          <span /><span /><span /><span />
        </div>
        <div v-else-if="error" class="notice notice--error" role="alert">
          {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
            Retry
          </button>
        </div>
        <AppEmpty v-else-if="!page?.items.length" title="No leads match these filters." detail="Change the filters or add the first lead.">
          <button v-if="can('lead.write')" class="button button--secondary" type="button" @click="openCreate">
            Add lead
          </button>
        </AppEmpty>
        <template v-else>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    Lead
                  </th><th scope="col">
                    Stage
                  </th><th scope="col">
                    Last contact
                  </th><th scope="col">
                    Next action
                  </th><th scope="col">
                    Owner
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="lead in page.items" :key="lead.id">
                  <td>
                    <div class="table-primary">
                      <button class="text-button" type="button" @click="selectLead(lead)">
                        {{ contactName(contacts[lead.contactId]) }}
                      </button><span class="table-primary__sub">{{ lead.title || lead.service || 'No project title' }}</span>
                    </div>
                  </td><td><AppBadge :value="lead.status" /></td><td class="small">
                    {{ shortDate(lead.lastContactedAt, timezone) }}
                  </td><td class="small muted">
                    No action set
                  </td><td class="small">
                    {{ lead.assignedUserId ? 'Assigned user' : 'Unassigned' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <AppPagination
            :has-next="Boolean(page.nextCursor)"
            :has-previous="cursors.length > 0"
            :loading="loading"
            @next="next"
            @previous="previous"
          />
        </template>
      </section>
      <aside v-if="selected" class="detail-panel" aria-label="Lead details">
        <div class="detail-panel__head">
          <div>
            <p class="eyebrow">
              Lead detail
            </p><h2>{{ contactName(contacts[selected.contactId]) }}</h2><span class="small muted">{{ selected.title || selected.service || 'No project title' }}</span>
          </div><button class="close-button" type="button" aria-label="Close lead details" @click="selected = null">
            <AppIcon name="close" />
          </button>
        </div>
        <div class="detail-panel__body">
          <AppBadge :value="selected.status" />
          <dl class="detail-list">
            <dt>Lead ID</dt><dd class="mono">
              {{ selected.id }}
            </dd><dt>Created</dt><dd>{{ dateTime(selected.createdAt, timezone) }}</dd><dt>Source</dt><dd>{{ sources?.items.find((item) => item.id === selected?.sourceId)?.label ?? 'Not set' }}</dd><dt>Service</dt><dd>{{ selected.service || 'Not set' }}</dd><dt>Estimated value</dt><dd>{{ formatValue(selected.estimatedValue) }}</dd><dt>Assigned user</dt><dd>{{ selected.assignedUserId || 'Unassigned' }}</dd><dt>Next action</dt><dd>No action recorded</dd>
          </dl>
          <hr class="divider">
          <form v-if="can('lead.write')" class="form-stack" @submit.prevent="changeStatus">
            <div class="field">
              <label for="detail-stage">Move to stage</label><select id="detail-stage" v-model="statusChoice">
                <option v-for="stage in LEAD_STATUSES" :key="stage" :value="stage">
                  {{ humanize(stage) }}
                </option>
              </select>
            </div><p v-if="actionError" class="inline-error" role="alert">
              {{ actionError }}
            </p><p v-if="actionSuccess" class="inline-success" role="status">
              {{ actionSuccess }}
            </p><button class="button button--primary" type="submit" :disabled="saving || statusChoice === selected.status">
              {{ saving ? 'Updating…' : 'Update stage' }}
            </button>
          </form>
        </div>
      </aside>
    </div>
    <dialog ref="createDialog" class="modal" @close="actionError = ''">
      <form class="form-stack" @submit.prevent="createLead">
        <div class="modal__head">
          <div>
            <p class="eyebrow">
              New opportunity
            </p><h2>Add lead</h2>
          </div><button class="close-button" type="button" aria-label="Close" @click="closeCreate">
            <AppIcon name="close" />
          </button>
        </div><p class="small muted">
          Create a contact and start a lead in the active business.
        </p>
        <div class="form-grid">
          <div class="field">
            <label for="new-first">First name</label><input id="new-first" v-model="firstName" autocomplete="given-name" :disabled="Boolean(pendingContactId)">
          </div><div class="field">
            <label for="new-last">Last name</label><input id="new-last" v-model="lastName" autocomplete="family-name" :disabled="Boolean(pendingContactId)">
          </div><div class="field">
            <label for="new-email">Email</label><input
              id="new-email"
              v-model="email"
              type="email"
              autocomplete="email"
              :disabled="Boolean(pendingContactId)"
            >
          </div><div class="field">
            <label for="new-phone">Phone (E.164)</label><input
              id="new-phone"
              v-model="phone"
              type="tel"
              placeholder="+15551234567"
              pattern="\+[1-9][0-9]{1,14}"
              :disabled="Boolean(pendingContactId)"
            >
          </div>
        </div>
        <div class="field">
          <label for="new-title">Project title</label><input id="new-title" v-model="title" placeholder="Kitchen remodel">
        </div><div class="field">
          <label for="new-service">Service (optional)</label><select id="new-service" v-model="service">
            <option value="">
              No service selected
            </option><option v-for="item in services" :key="item.id" :value="item.key">
              {{ item.name }}
            </option>
          </select>
        </div><p v-if="pendingContactId" class="notice notice--warning">
          Contact created. Retry will use the same contact.
        </p><p v-if="servicesLoading" class="small muted" role="status">
          Loading active services…
        </p><p v-else-if="servicesLoadError" class="small muted">
          Active services could not be loaded. You can still create this lead without a service.
        </p><p v-else-if="!services.length" class="small muted">
          No active services are configured. You can create this lead without a service or add services in Settings.
        </p><p v-if="actionError" class="inline-error" role="alert">
          {{ actionError }}
        </p><div class="form-actions">
          <button class="button button--primary" type="submit" :disabled="saving">
            {{ saving ? 'Saving…' : 'Create lead' }}
          </button><button class="button button--secondary" type="button" @click="closeCreate">
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
