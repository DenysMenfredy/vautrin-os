<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  confirmation?: string;
  busy: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  confirm: [payload: { reason: string; confirmation: string }];
  cancel: [];
}>();
const reason = ref('');
const typed = ref('');
const dialog = ref<HTMLDialogElement>();
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog ref="dialog" class="admin-dialog" aria-labelledby="action-title" @cancel.prevent="emit('cancel')">
    <form class="form-stack" @submit.prevent="emit('confirm', {reason: reason.trim(), confirmation: typed})">
      <div>
        <p class="eyebrow">
          Confirm management action
        </p><h2 id="action-title">
          {{ title }}
        </h2><p class="muted">
          {{ description }}
        </p>
      </div><div class="field">
        <label for="action-reason">Reason</label><textarea
          id="action-reason"
          v-model="reason"
          autofocus
          required
          minlength="3"
          maxlength="500"
        />
      </div><div v-if="confirmation" class="field">
        <label for="action-confirmation">Type {{ confirmation }} to continue</label><input id="action-confirmation" v-model="typed" autocomplete="off" required>
      </div><p v-if="error" class="notice notice--error" role="alert">
        {{ error }}
      </p><div class="form-actions">
        <button class="button button--secondary" type="button" :disabled="busy" @click="emit('cancel')">
          Cancel
        </button><button class="button button--primary admin-danger-button" :disabled="busy || reason.trim().length < 3 || Boolean(confirmation && typed !== confirmation)">
          {{ busy ? 'Applying…' : 'Confirm action' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
