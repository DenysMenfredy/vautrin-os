<script setup lang="ts">
import type { PlatformAudit } from '@vautrin/contracts';

defineProps<{ items: readonly PlatformAudit[] }>();
</script>
<template>
  <div class="admin-table-scroll">
    <table>
      <thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Reason</th><th>Time · UTC</th></tr></thead><tbody>
        <tr v-for="item in items" :key="item.id">
          <td><strong class="small">{{ item.action.replace('platform.', '').replaceAll('_', ' ') }}</strong><span class="table-subline">{{ item.outcome }}</span></td><td><span class="small">{{ item.actorRole.replaceAll('_', ' ') }}</span><span class="table-subline mono" :title="item.actorUserId">{{ item.actorUserId.slice(0, 8) }}</span></td><td>
            <NuxtLink v-if="item.targetId && ['user','tenant'].includes(item.targetType)" class="link" :to="`/${item.targetType === 'user' ? 'users' : 'tenants'}/${item.targetId}`">
              {{ item.targetType }} · {{ item.targetId.slice(0, 8) }}
            </NuxtLink><span v-else>{{ item.targetType }}</span>
          </td><td class="audit-reason">
            {{ item.reason ?? '—' }}
          </td><td class="small">
            {{ adminDate(item.createdAt) }}<span class="table-subline mono">{{ item.createdAt.slice(11, 19) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
