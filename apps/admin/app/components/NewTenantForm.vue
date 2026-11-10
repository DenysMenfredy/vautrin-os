<script setup lang="ts">
import type { InvitationResponse } from '@vautrin/contracts';

const emit = defineEmits<{ created: [] }>();
const api = useAdminApi();
const name = ref('');
const slug = ref('');
const timezone = ref('UTC');
const template = ref('remodeling');
const ownerEmail = ref('');
const busy = ref(false);
const error = ref('');
const result = ref<{ tenantId: string; invitation: InvitationResponse | null } | null>(null);
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    result.value = await api('/tenants', {
      method: 'POST',
      body: {
        name: name.value,
        timezone: timezone.value,
        template: template.value,
        ...(slug.value.trim() ? { slug: slug.value.trim() } : {}),
        ...(ownerEmail.value.trim() ? { owner: { email: ownerEmail.value.trim() } } : {}),
      },
    });
    emit('created');
  } catch (cause) {
    error.value = adminError(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div v-if="result" class="form-stack">
    <p class="notice">
      Tenant created with its business profile and service configuration.
    </p><InvitationResult v-if="result.invitation" :invitation="result.invitation" /><p v-else class="muted">
      No owner was invited. Generate an OWNER invitation from the tenant detail when ready.
    </p><NuxtLink class="link" :to="`/tenants/${result.tenantId}`">
      Open tenant →
    </NuxtLink>
  </div><form v-else class="form-stack" @submit.prevent="submit">
    <div class="form-grid">
      <div class="field">
        <label for="tenant-name">Business name</label><input
          id="tenant-name"
          v-model="name"
          maxlength="200"
          minlength="2"
          required
        >
      </div><div class="field">
        <label for="tenant-slug">Slug · optional</label><input
          id="tenant-slug"
          v-model="slug"
          pattern="[a-z0-9][a-z0-9-]{1,62}"
          maxlength="63"
          placeholder="Derived from business name"
        >
      </div><div class="field">
        <label for="tenant-timezone">Timezone</label><input id="tenant-timezone" v-model="timezone" placeholder="America/Phoenix" required>
      </div><div class="field">
        <label for="tenant-template">Vertical template</label><select id="tenant-template" v-model="template">
          <option value="remodeling">
            Remodeling / home services
          </option><option value="generic-local-business">
            Local business
          </option>
        </select>
      </div>
    </div><div class="field">
      <label for="owner-email">Initial OWNER email · optional</label><input id="owner-email" v-model="ownerEmail" type="email" maxlength="320"><small>The owner receives a one-time invitation link and sets their own password.</small>
    </div><p v-if="error" class="notice notice--error" role="alert">
      {{ error }}
    </p><button class="button button--primary" :disabled="busy">
      {{ busy ? 'Creating…' : 'Create tenant' }}
    </button>
  </form>
</template>
