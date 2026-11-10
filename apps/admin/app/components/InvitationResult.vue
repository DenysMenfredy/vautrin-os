<script setup lang="ts">
import type { InvitationResponse } from '@vautrin/contracts';

const props = defineProps<{ invitation: InvitationResponse }>();
const base = useRuntimeConfig().public.applicationBaseUrl;
const link = computed(
  () => `${base}/invitation?token=${encodeURIComponent(props.invitation.token)}`,
);
const copied = ref(false);
const error = ref('');
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
  } catch {
    error.value = 'Select and copy the invitation link manually.';
  }
}
</script>
<template>
  <section class="invitation-result" aria-label="Generated invitation">
    <p class="eyebrow">
      Invitation generated
    </p><h3>Deliver this link privately.</h3><p class="small muted">
      The recipient sets their own password when accepting. Existing users confirm their current password. No email has been sent.
    </p><div class="field">
      <label for="issued-invitation-link">One-time invitation link</label><input
        id="issued-invitation-link"
        :value="link"
        readonly
        autocomplete="off"
        @focus="($event.target as HTMLInputElement).select()"
      >
    </div><div class="form-actions">
      <button class="button button--secondary" type="button" @click="copy">
        {{ copied ? 'Copied' : 'Copy invitation link' }}
      </button><span class="small muted">Expires {{ adminDate(invitation.expiresAt) }}</span>
    </div><p class="small muted">
      This token is shown only now. Copy it before closing this view.
    </p><p v-if="error" class="inline-error">
      {{ error }}
    </p>
  </section>
</template>
