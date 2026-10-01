<script setup lang="ts">
import type {
  AppointmentPageResponse,
  BusinessProfileResponse,
  ConversationPageResponse,
  LeadDashboardResponse,
  LeadPageResponse,
} from '@vautrin/contracts';
import { dateTime, humanize } from '~/utils/presentation';

const { request, can, session } = useSession();
const dashboard = ref<LeadDashboardResponse | null>(null);
const leads = ref<LeadPageResponse | null>(null);
const conversations = ref<ConversationPageResponse | null>(null);
const appointments = ref<AppointmentPageResponse | null>(null);
const loading = ref(true);
const error = ref('');
const timezone = ref<string | null>(null);
const stages = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'ESTIMATE_PENDING',
  'ESTIMATE_SENT',
  'FOLLOW_UP',
  'WON',
  'LOST',
] as const;
const activeTenant = computed(() =>
  session.value?.memberships.find((item) => item.tenantId === session.value?.activeTenantId),
);
const waiting = computed(
  () => (dashboard.value?.byStatus.NEW ?? 0) + (dashboard.value?.byStatus.FOLLOW_UP ?? 0),
);
const todayAppointments = computed(() => {
  const zone = timezone.value;
  if (!zone) return null;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    appointments.value?.items.filter(
      (item) =>
        item.status !== 'CANCELLED' &&
        item.status !== 'NO_SHOW' &&
        new Intl.DateTimeFormat('en-CA', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(item.startsAt)) === today,
    ).length ?? null
  );
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    dashboard.value = await request<LeadDashboardResponse>('/crm/dashboard');
    const [leadResult, conversationResult, appointmentResult, profileResult] =
      await Promise.allSettled([
        request<LeadPageResponse>('/leads', { query: { limit: 5 } }),
        can('conversation.read')
          ? request<ConversationPageResponse>('/conversations', { query: { limit: 5 } })
          : Promise.resolve(null),
        can('appointment.read')
          ? request<AppointmentPageResponse>('/appointments', { query: { limit: 100 } })
          : Promise.resolve(null),
        can('business.read')
          ? request<BusinessProfileResponse>('/business/profile')
          : Promise.resolve(null),
      ]);
    leads.value = leadResult.status === 'fulfilled' ? leadResult.value : null;
    conversations.value =
      conversationResult.status === 'fulfilled' ? conversationResult.value : null;
    appointments.value = appointmentResult.status === 'fulfilled' ? appointmentResult.value : null;
    timezone.value =
      profileResult.status === 'fulfilled' ? (profileResult.value?.timezone ?? null) : null;
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
useHead({ title: 'Overview' });
</script>

<template>
  <div>
    <AppPageHeader title="Overview" :description="`An operational view of ${activeTenant?.name ?? 'your business'} · All time`" eyebrow="Revenue workspace">
      <NuxtLink v-if="can('lead.write')" class="button button--primary" to="/leads?new=1">
        Add lead
      </NuxtLink>
    </AppPageHeader>
    <div v-if="loading" class="surface loading-lines" role="status" aria-label="Loading overview">
      <span /><span /><span /><span />
    </div>
    <div v-else-if="error" class="notice notice--error" role="alert">
      {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
        Retry
      </button>
    </div>
    <template v-else-if="dashboard">
      <section aria-labelledby="attention-title">
        <div class="section-head">
          <h2 id="attention-title">
            Needs attention
          </h2><span class="small muted">Current pipeline</span>
        </div>
        <div class="metrics-strip">
          <div class="metric">
            <span class="metric__label">New leads</span><span class="metric__value">{{ dashboard.byStatus.NEW }}</span><span class="metric__foot">Awaiting first contact</span>
          </div>
          <div class="metric">
            <span class="metric__label">Follow-up stage</span><span class="metric__value">{{ dashboard.byStatus.FOLLOW_UP }}</span><span class="metric__foot">Check next steps</span>
          </div>
          <div class="metric">
            <span class="metric__label">Attention total</span><span class="metric__value">{{ waiting }}</span><span class="metric__foot">New + follow-up leads</span>
          </div>
          <div class="metric">
            <span class="metric__label">Appointments today</span><span class="metric__value">{{ todayAppointments ?? '—' }}</span><span class="metric__foot">{{ timezone ? `${timezone} · First 100 scheduled` : 'Business time zone unavailable' }}</span>
          </div>
        </div>
      </section>
      <div class="overview-grid">
        <section aria-labelledby="pipeline-title">
          <div class="section-head">
            <h2 id="pipeline-title">
              Lead pipeline
            </h2><NuxtLink class="link small" to="/leads">
              View leads →
            </NuxtLink>
          </div>
          <div class="surface surface__body">
            <AppEmpty v-if="dashboard.total === 0" title="No leads yet." detail="Add a lead to begin tracking the revenue pipeline.">
              <NuxtLink v-if="can('lead.write')" class="button button--secondary" to="/leads?new=1">
                Add lead
              </NuxtLink>
            </AppEmpty>
            <template v-else>
              <p class="small muted">
                {{ dashboard.total }} leads across all stages
              </p>
              <ul class="stage-list">
                <li v-for="stage in stages" :key="stage">
                  <span class="stage-list__label">{{ humanize(stage) }}</span><span class="stage-list__bar" aria-hidden="true"><span class="stage-list__fill" :style="{ width: `${Math.max(0, dashboard.byStatus[stage] / dashboard.total * 100)}%` }" /></span><span class="stage-list__count">{{ dashboard.byStatus[stage] }}</span>
                </li>
              </ul>
            </template>
          </div>
        </section>
        <section aria-labelledby="recent-title">
          <div class="section-head">
            <h2 id="recent-title">
              Recent activity
            </h2><span class="small muted">Latest records</span>
          </div>
          <div class="surface surface__body">
            <AppEmpty v-if="!leads?.items.length && !conversations?.items.length" title="No recent activity." />
            <ul v-else class="activity-list">
              <li v-for="lead in leads?.items ?? []" :key="lead.id">
                <span class="activity-list__text"><NuxtLink class="link" :to="`/leads?lead=${lead.id}`">{{ lead.title || 'Untitled lead' }}</NuxtLink><br><span class="small muted">Lead · {{ humanize(lead.status) }}</span></span><span class="activity-list__time">{{ dateTime(lead.createdAt, timezone ?? undefined) }}</span>
              </li>
              <li v-for="conversation in conversations?.items ?? []" :key="conversation.id">
                <span class="activity-list__text"><NuxtLink class="link" to="/conversations">{{ conversation.subject || 'Customer conversation' }}</NuxtLink><br><span class="small muted">{{ humanize(conversation.channel) }} · {{ humanize(conversation.status) }}</span></span><span class="activity-list__time">{{ dateTime(conversation.lastMessageAt, timezone ?? undefined) }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
