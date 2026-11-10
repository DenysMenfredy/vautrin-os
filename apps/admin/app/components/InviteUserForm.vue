<script setup lang="ts">
import type { InvitationResponse, TenantRoleName } from '@vautrin/contracts';

const props = defineProps<{ tenantId?: string }>();
const emit = defineEmits<{ issued: [] }>();
const api = useAdminApi();
const tenant = ref(props.tenantId ?? '');
const email = ref('');
const role = ref<TenantRoleName>(props.tenantId ? 'OWNER' : 'STAFF');
const reissue = ref(false);
const invitation = ref<InvitationResponse | null>(null);
const busy = ref(false);
const error = ref('');
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    invitation.value = await api<InvitationResponse>('/invitations', {
      method: 'POST',
      body: {
        tenantId: tenant.value,
        email: email.value,
        role: role.value,
        reissue: reissue.value,
      },
    });
    emit('issued');
  } catch (cause) {
    error.value = adminError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <InvitationResult v-if="invitation" :invitation="invitation" /><form v-else class="form-stack" @submit.prevent="submit">
    <p class="small muted">
      Create an invitation, not a password. The recipient accepts it in the customer application.
    </p><TenantPicker v-if="!tenantId" v-model="tenant" required /><div class="field">
      <label for="invite-email">Customer email</label><input
        id="invite-email"
        v-model="email"
        type="email"
        maxlength="320"
        required
      >
    </div><div class="field">
      <label for="invite-role">Tenant role</label><select id="invite-role" v-model="role">
        <option v-for="option in ['OWNER','ADMIN','MANAGER','STAFF','READ_ONLY']" :key="option" :value="option">
          {{ option.replaceAll('_', ' ') }}
        </option>
      </select>
    </div><label class="checkbox-field"><input v-model="reissue" type="checkbox">Replace an existing pending invitation and invalidate its old link</label><p v-if="error" class="notice notice--error" role="alert">
      {{ error }}
    </p><button class="button button--primary" :disabled="busy || !tenant">
      {{ busy ? 'Generating…' : 'Generate invitation' }}
    </button>
  </form>
</template>
