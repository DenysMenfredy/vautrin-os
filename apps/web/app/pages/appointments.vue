<script setup lang="ts">
import type {
  AppointmentPageResponse,
  AppointmentResponse,
  AvailabilityResponse,
  ContactResponse,
} from '@vautrin/contracts';
import { APPOINTMENT_STATUSES } from '@vautrin/contracts';
import { contactName, dateTime, humanize } from '~/utils/presentation';

const { request, can } = useSession();
const page = ref<AppointmentPageResponse | null>(null);
const cursors = ref<string[]>([]);
const contacts = ref<Record<string, ContactResponse>>({});
const selected = ref<AppointmentResponse | null>(null);
const status = ref('');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const actionError = ref('');
const success = ref('');
const showCancel = ref(false);
const cancelReason = ref('');
const slots = ref<AvailabilityResponse | null>(null);
const slotChoice = ref('');
const rescheduleKey = ref<string | null>(null);
watch(slotChoice, () => {
  rescheduleKey.value = null;
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await request<AppointmentPageResponse>('/appointments', {
      query: { limit: 25, cursor: cursors.value.at(-1), status: status.value },
    });
    page.value = result;
    if (can('contact.read'))
      await Promise.allSettled(
        [...new Set(result.items.map((item) => item.contactId))]
          .filter((id) => !contacts.value[id])
          .map(async (id) => {
            contacts.value[id] = await request<ContactResponse>(`/contacts/${id}`);
          }),
      );
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
function selectAppointment(appointment: AppointmentResponse) {
  selected.value = appointment;
  slots.value = null;
  slotChoice.value = '';
  rescheduleKey.value = null;
  actionError.value = '';
  success.value = '';
  showCancel.value = false;
}
function replaceAppointment(updated: AppointmentResponse) {
  selected.value = updated;
  if (page.value)
    page.value = {
      ...page.value,
      items: page.value.items.map((item) => (item.id === updated.id ? updated : item)),
    };
}
async function checkSlots() {
  if (!selected.value?.leadId || !selected.value.appointmentTypeId) return;
  actionError.value = '';
  busy.value = true;
  try {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    slots.value = await request<AvailabilityResponse>('/appointments/availability', {
      method: 'POST',
      body: {
        leadId: selected.value.leadId,
        appointmentTypeId: selected.value.appointmentTypeId,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    });
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function reschedule() {
  if (!selected.value || !slotChoice.value) return;
  actionError.value = '';
  success.value = '';
  busy.value = true;
  rescheduleKey.value ??= crypto.randomUUID();
  try {
    const updated = await request<AppointmentResponse>(
      `/appointments/${selected.value.id}/reschedule`,
      { method: 'POST', body: { startsAt: slotChoice.value, idempotencyKey: rescheduleKey.value } },
    );
    replaceAppointment(updated);
    slots.value = null;
    slotChoice.value = '';
    rescheduleKey.value = null;
    success.value = 'Appointment rescheduled.';
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function cancelAppointment() {
  if (!selected.value) return;
  actionError.value = '';
  success.value = '';
  busy.value = true;
  try {
    const updated = await request<AppointmentResponse>(
      `/appointments/${selected.value.id}/cancel`,
      { method: 'POST', body: { reason: cancelReason.value.trim() || undefined } },
    );
    replaceAppointment(updated);
    showCancel.value = false;
    cancelReason.value = '';
    success.value = 'Appointment cancelled.';
  } catch (cause) {
    actionError.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
useHead({ title: 'Appointments' });
</script>

<template>
  <div>
    <AppPageHeader title="Appointments" description="Scheduled visits and customer bookings." eyebrow="Calendar">
      <button class="button button--secondary" type="button" @click="load">
        Refresh
      </button>
    </AppPageHeader>
    <div class="split-list" :class="{ 'split-list--single': !selected }">
      <section class="surface surface--flush" aria-label="Appointments list">
        <div class="toolbar">
          <div class="field field--compact">
            <label for="appointment-filter">Status</label><select id="appointment-filter" v-model="status" @change="reset">
              <option value="">
                All statuses
              </option><option v-for="item in APPOINTMENT_STATUSES" :key="item" :value="item">
                {{ humanize(item) }}
              </option>
            </select>
          </div>
        </div>
        <div v-if="loading" class="loading-lines" role="status" aria-label="Loading appointments">
          <span /><span /><span /><span />
        </div><div v-else-if="error" class="notice notice--error" role="alert">
          {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
            Retry
          </button>
        </div><AppEmpty v-else-if="!page?.items.length" title="No appointments here." detail="Booked appointments will appear in this schedule." />
        <template v-else>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    Appointment
                  </th><th scope="col">
                    Customer
                  </th><th scope="col">
                    When
                  </th><th scope="col">
                    Status
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="appointment in page.items" :key="appointment.id">
                  <td>
                    <button class="text-button" type="button" @click="selectAppointment(appointment)">
                      {{ appointment.title }}
                    </button>
                  </td><td>{{ contactName(contacts[appointment.contactId]) }}</td><td class="small">
                    {{ dateTime(appointment.startsAt, appointment.timezone) }}<br><span class="muted">{{ appointment.timezone }}</span>
                  </td><td><AppBadge :value="appointment.status" /></td>
                </tr>
              </tbody>
            </table>
          </div><AppPagination :has-next="Boolean(page.nextCursor)" :has-previous="cursors.length > 0" @next="next" @previous="previous" />
        </template>
      </section>
      <aside v-if="selected" class="detail-panel" aria-label="Appointment details">
        <div class="detail-panel__head">
          <div>
            <p class="eyebrow">
              Appointment detail
            </p><h2>{{ selected.title }}</h2><span class="small muted">{{ contactName(contacts[selected.contactId]) }}</span>
          </div><button class="close-button" type="button" aria-label="Close details" @click="selected = null">
            <AppIcon name="close" />
          </button>
        </div><div class="detail-panel__body">
          <AppBadge :value="selected.status" /><dl class="detail-list">
            <dt>Starts</dt><dd>{{ dateTime(selected.startsAt, selected.timezone) }}</dd><dt>Ends</dt><dd>{{ dateTime(selected.endsAt, selected.timezone) }}</dd><dt>Time zone</dt><dd>{{ selected.timezone }}</dd><dt>Location</dt><dd>{{ selected.locationId || 'Not set' }}</dd><dt>Provider</dt><dd>{{ selected.provider || 'Local booking' }}</dd><dt>Description</dt><dd>{{ selected.description || 'Not set' }}</dd>
          </dl><p v-if="actionError" class="inline-error" role="alert">
            {{ actionError }}
          </p><p v-if="success" class="inline-success" role="status">
            {{ success }}
          </p>
          <template v-if="can('appointment.write') && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(selected.status)">
            <hr class="divider"><div>
              <h3>Reschedule</h3><p class="small muted">
                Check available times for the next 14 days.
              </p><button class="button button--secondary" type="button" :disabled="busy || !selected.leadId || !selected.appointmentTypeId" @click="checkSlots">
                {{ busy ? 'Checking…' : 'Check availability' }}
              </button><p v-if="!selected.leadId || !selected.appointmentTypeId" class="small muted">
                This appointment has no linked lead or appointment type for availability checks.
              </p>
            </div><form v-if="slots" class="form-stack" @submit.prevent="reschedule">
              <div class="field">
                <label for="available-slot">Available time</label><select id="available-slot" v-model="slotChoice" required>
                  <option value="">
                    Choose a time
                  </option><option v-for="slot in slots.slots" :key="slot.startsAt" :value="slot.startsAt">
                    {{ dateTime(slot.startsAt, selected.timezone) }} · {{ selected.timezone }}
                  </option>
                </select>
              </div><p v-if="!slots.slots.length" class="small muted">
                No available slots in this period.
              </p><button class="button button--primary" type="submit" :disabled="busy || !slotChoice">
                Confirm new time
              </button>
            </form><hr class="divider"><div v-if="!showCancel">
              <button class="button button--danger" type="button" @click="showCancel = true">
                Cancel appointment
              </button>
            </div><form v-else class="form-stack" @submit.prevent="cancelAppointment">
              <p class="notice notice--warning">
                Cancelling changes this appointment's status. Any provider event is handled by the booking service.
              </p><div class="field">
                <label for="cancel-reason">Reason (optional)</label><textarea id="cancel-reason" v-model="cancelReason" maxlength="500" />
              </div><div class="form-actions">
                <button class="button button--danger" type="submit" :disabled="busy">
                  Confirm cancellation
                </button><button class="button button--secondary" type="button" @click="showCancel = false">
                  Keep appointment
                </button>
              </div>
            </form>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>
