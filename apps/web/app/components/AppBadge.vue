<script setup lang="ts">
import { humanize, statusTone } from '~/utils/presentation';

const props = defineProps<{ value: string; label?: string }>();
</script>

<template>
  <span class="badge" :class="`badge--${statusTone(props.value)}`">{{ props.label ?? humanize(props.value) }}</span>
</template>
