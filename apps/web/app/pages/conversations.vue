<script setup lang="ts">
import type {
  BusinessProfileResponse,
  ContactResponse,
  ConversationPageResponse,
  ConversationResponse,
  ConversationStatus,
  LeadResponse,
  MessagePageResponse,
  MessageResponse,
} from '@vautrin/contracts';
import { CONVERSATION_STATUSES } from '@vautrin/contracts';
import { contactName, dateTime, humanize } from '~/utils/presentation';

const { request, can } = useSession();
const queue = ref<ConversationPageResponse | null>(null);
const selected = ref<ConversationResponse | null>(null);
const messages = ref<MessageResponse[]>([]);
const messageCursor = ref<string | null>(null);
const contacts = ref<Record<string, ContactResponse>>({});
const lead = ref<LeadResponse | null>(null);
const queueCursors = ref<string[]>([]);
const filterStatus = ref('');
const contextOpen = ref(false);
const loading = ref(true);
const threadLoading = ref(false);
const sending = ref(false);
const error = ref('');
const threadError = ref('');
const success = ref('');
const draft = ref('');
const pendingSendKey = ref<string | null>(null);
const pendingSendBody = ref('');
const statusChoice = ref<ConversationStatus>('OPEN');
const timezone = ref('UTC');

async function loadQueue() {
  loading.value = true;
  error.value = '';
  try {
    const result = await request<ConversationPageResponse>('/conversations', {
      query: { limit: 25, cursor: queueCursors.value.at(-1), status: filterStatus.value },
    });
    queue.value = result;
    if (can('contact.read')) {
      await Promise.allSettled(
        [...new Set(result.items.map((item) => item.contactId))]
          .filter((id) => !contacts.value[id])
          .map(async (id) => {
            contacts.value[id] = await request<ContactResponse>(`/contacts/${id}`);
          }),
      );
    }
    const firstConversation = result.items[0];
    if (!selected.value && firstConversation && !window.matchMedia('(max-width: 767px)').matches)
      await selectConversation(firstConversation);
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}

async function selectConversation(conversation: ConversationResponse) {
  selected.value = conversation;
  statusChoice.value = conversation.status;
  contextOpen.value = false;
  threadError.value = '';
  success.value = '';
  messages.value = [];
  messageCursor.value = null;
  lead.value = null;
  threadLoading.value = true;
  try {
    const [messageResult, contactResult, leadResult] = await Promise.allSettled([
      request<MessagePageResponse>(`/conversations/${conversation.id}/messages`, {
        query: { limit: 50 },
      }),
      can('contact.read') && !contacts.value[conversation.contactId]
        ? request<ContactResponse>(`/contacts/${conversation.contactId}`)
        : Promise.resolve(null),
      conversation.leadId && can('lead.read')
        ? request<LeadResponse>(`/leads/${conversation.leadId}`)
        : Promise.resolve(null),
    ]);
    if (selected.value?.id !== conversation.id) return;
    if (messageResult.status === 'rejected') throw messageResult.reason;
    messages.value = [...messageResult.value.items].reverse();
    messageCursor.value = messageResult.value.nextCursor;
    if (contactResult.status === 'fulfilled' && contactResult.value)
      contacts.value[conversation.contactId] = contactResult.value;
    if (leadResult.status === 'fulfilled') lead.value = leadResult.value;
  } catch (cause) {
    threadError.value = apiErrorMessage(cause);
  } finally {
    threadLoading.value = false;
  }
}

async function loadOlder() {
  if (!selected.value || !messageCursor.value) return;
  threadLoading.value = true;
  try {
    const result = await request<MessagePageResponse>(
      `/conversations/${selected.value.id}/messages`,
      { query: { limit: 50, cursor: messageCursor.value } },
    );
    messages.value = [...result.items].reverse().concat(messages.value);
    messageCursor.value = result.nextCursor;
  } catch (cause) {
    threadError.value = apiErrorMessage(cause);
  } finally {
    threadLoading.value = false;
  }
}

async function refreshThread() {
  if (selected.value) await selectConversation(selected.value);
}

async function send() {
  if (!selected.value || !draft.value.trim()) return;
  threadError.value = '';
  success.value = '';
  sending.value = true;
  const body = draft.value.trim();
  if (body !== pendingSendBody.value || !pendingSendKey.value) {
    pendingSendKey.value = crypto.randomUUID();
    pendingSendBody.value = body;
  }
  try {
    const message = await request<MessageResponse>(`/conversations/${selected.value.id}/messages`, {
      method: 'POST',
      body: { body, idempotencyKey: pendingSendKey.value },
    });
    if (!messages.value.some((item) => item.id === message.id)) messages.value.push(message);
    draft.value = '';
    pendingSendKey.value = null;
    pendingSendBody.value = '';
    success.value = `Message ${humanize(message.status).toLowerCase()}. Delivery is still being tracked.`;
    await loadQueue();
  } catch (cause) {
    threadError.value = apiErrorMessage(cause);
  } finally {
    sending.value = false;
  }
}

async function changeStatus() {
  if (!selected.value || selected.value.status === statusChoice.value) return;
  threadError.value = '';
  try {
    const updated = await request<ConversationResponse>(
      `/conversations/${selected.value.id}/status`,
      { method: 'PATCH', body: { status: statusChoice.value } },
    );
    selected.value = updated;
    if (queue.value)
      queue.value = {
        ...queue.value,
        items: queue.value.items.map((item) => (item.id === updated.id ? updated : item)),
      };
    success.value = 'Conversation status updated.';
  } catch (cause) {
    threadError.value = apiErrorMessage(cause);
  }
}

function resetQueue() {
  queueCursors.value = [];
  selected.value = null;
  void loadQueue();
}
function nextQueue() {
  if (queue.value?.nextCursor) {
    queueCursors.value.push(queue.value.nextCursor);
    void loadQueue();
  }
}
function previousQueue() {
  queueCursors.value.pop();
  void loadQueue();
}
onMounted(async () => {
  await loadQueue();
  if (can('business.read')) {
    try {
      timezone.value = (await request<BusinessProfileResponse>('/business/profile')).timezone;
    } catch {
      /* UTC is explicit until business time is available. */
    }
  }
});
useHead({ title: 'Conversations' });
</script>

<template>
  <div>
    <AppPageHeader title="Conversations" description="Customer messages and confirmed delivery states." eyebrow="Inbox">
      <button class="button button--secondary" type="button" @click="loadQueue">
        Refresh inbox
      </button>
    </AppPageHeader>
    <div v-if="error" class="notice notice--error" role="alert">
      {{ error }} <button class="button button--ghost button--small" type="button" @click="loadQueue">
        Retry
      </button>
    </div>
    <div v-else class="conversation-layout">
      <section class="conversation-queue" :class="{ 'conversation-queue--hidden': selected }" aria-label="Conversation queue">
        <div class="conversation-queue__head">
          <h2>Inbox</h2><label class="sr-only" for="conversation-filter">Filter by status</label><select id="conversation-filter" v-model="filterStatus" class="control" @change="resetQueue">
            <option value="">
              All conversations
            </option><option v-for="state in CONVERSATION_STATUSES" :key="state" :value="state">
              {{ humanize(state) }}
            </option>
          </select>
        </div>
        <div v-if="loading" class="loading-lines" role="status" aria-label="Loading inbox">
          <span /><span /><span />
        </div>
        <AppEmpty v-else-if="!queue?.items.length" title="No conversations here." detail="Incoming customer conversations appear in this queue." />
        <template v-else>
          <button
            v-for="conversation in queue.items"
            :key="conversation.id"
            class="queue-item"
            :class="{ 'queue-item--active': selected?.id === conversation.id }"
            type="button"
            @click="selectConversation(conversation)"
          >
            <span class="queue-item__top"><span class="queue-item__name">{{ contactName(contacts[conversation.contactId]) }}</span><span class="small muted">{{ dateTime(conversation.lastMessageAt || conversation.createdAt, timezone) }}</span></span><span class="queue-item__meta"><span>{{ humanize(conversation.channel) }}</span><span>·</span><span>{{ humanize(conversation.status) }}</span></span>
          </button><AppPagination :has-next="Boolean(queue.nextCursor)" :has-previous="queueCursors.length > 0" @next="nextQueue" @previous="previousQueue" />
        </template>
      </section>
      <section class="thread" :class="{ 'thread--hidden': !selected }" aria-label="Conversation thread">
        <template v-if="selected">
          <div class="thread__head">
            <div>
              <button class="button button--ghost button--small thread-back" type="button" @click="selected = null">
                <AppIcon name="back" /> Inbox
              </button><h2>{{ contactName(contacts[selected.contactId]) }}</h2><span class="small muted">{{ humanize(selected.channel) }} · {{ humanize(selected.status) }} · {{ timezone }}</span>
            </div><button class="button button--secondary button--small context-toggle" type="button" @click="contextOpen = true">
              Context
            </button>
          </div>
          <div class="thread__messages" aria-live="polite">
            <button
              v-if="messageCursor"
              class="button button--ghost button--small"
              type="button"
              :disabled="threadLoading"
              @click="loadOlder"
            >
              Load older messages
            </button><div v-if="threadLoading && !messages.length" class="loading-lines" role="status">
              <span /><span /><span />
            </div><AppEmpty v-else-if="!messages.length" title="No messages yet." detail="Messages in this conversation appear here after they are recorded." /><div v-for="message in messages" :key="message.id" class="message" :class="{ 'message--outbound': message.direction === 'OUTBOUND' }">
              <span class="message__meta"><span>{{ message.direction === 'INBOUND' ? 'Customer' : 'Outbound' }}</span><time :datetime="message.createdAt">{{ dateTime(message.createdAt, timezone) }}</time></span><div class="message__bubble">
                {{ message.body }}
              </div><span v-if="message.direction === 'OUTBOUND'" class="message__status"><AppBadge :value="message.status" /></span><span v-if="message.failureReason" class="inline-error">{{ message.failureReason }}</span>
            </div>
          </div>
          <form v-if="can('conversation.write') && selected.channel === 'SMS' && selected.status !== 'CLOSED'" class="composer" @submit.prevent="send">
            <label for="message-draft" class="sr-only">Message</label><textarea id="message-draft" v-model="draft" maxlength="1600" placeholder="Write an SMS message…" /><p v-if="threadError" class="inline-error" role="alert">
              {{ threadError }}
            </p><p v-if="success" class="inline-success" role="status">
              {{ success }}
            </p><div class="composer__foot">
              <span class="small muted">{{ draft.length }}/1600 · Delivery status updates after the provider responds.</span><button class="button button--primary" type="submit" :disabled="sending || !draft.trim()">
                {{ sending ? 'Queueing…' : 'Send message' }}
              </button>
            </div>
          </form>
          <div v-else class="composer">
            <p class="small muted">
              {{ selected.channel !== 'SMS' ? 'Sending is currently available for SMS conversations only.' : selected.status === 'CLOSED' ? 'Reopen this conversation to send a message.' : 'You can view this conversation, but cannot send messages.' }}
            </p><button class="button button--ghost button--small" type="button" @click="refreshThread">
              Refresh thread
            </button>
          </div>
        </template><AppEmpty v-else title="Select a conversation." detail="Choose a customer thread from the inbox." />
      </section>
      <aside class="conversation-context" :class="{ 'conversation-context--open': contextOpen }" aria-label="Conversation context">
        <div class="conversation-context__head">
          <div class="section-head">
            <h2>Context</h2><button class="close-button context-toggle" type="button" aria-label="Close context" @click="contextOpen = false">
              <AppIcon name="close" />
            </button>
          </div>
        </div><div v-if="selected" class="conversation-context__body">
          <div>
            <p class="eyebrow">
              Customer
            </p><h3>{{ contactName(contacts[selected.contactId]) }}</h3><dl class="detail-list">
              <dt>Phone</dt><dd>{{ contacts[selected.contactId]?.phone || 'Not set' }}</dd><dt>Email</dt><dd>{{ contacts[selected.contactId]?.email || 'Not set' }}</dd>
            </dl>
          </div><hr class="divider"><div>
            <p class="eyebrow">
              Lead
            </p><template v-if="lead">
              <h3>{{ lead.title || lead.service || 'Untitled lead' }}</h3><AppBadge :value="lead.status" />
            </template><p v-else class="small muted">
              No lead linked to this conversation.
            </p>
          </div><hr class="divider"><form v-if="can('conversation.write')" class="form-stack" @submit.prevent="changeStatus">
            <div class="field">
              <label for="conversation-status">Conversation status</label><select id="conversation-status" v-model="statusChoice">
                <option v-for="state in CONVERSATION_STATUSES" :key="state" :value="state">
                  {{ humanize(state) }}
                </option>
              </select>
            </div><button class="button button--secondary" type="submit" :disabled="statusChoice === selected.status">
              Update status
            </button>
          </form><div>
            <p class="eyebrow">
              Record
            </p><dl class="detail-list">
              <dt>Conversation ID</dt><dd class="mono">
                {{ selected.id }}
              </dd><dt>Assigned user</dt><dd>{{ selected.assignedUserId || 'Unassigned' }}</dd>
            </dl>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
