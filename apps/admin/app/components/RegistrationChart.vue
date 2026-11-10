<script setup lang="ts">
const props = defineProps<{ title: string; series: readonly { month: string; count: number }[] }>();
const ceiling = computed(() => Math.max(1, ...props.series.map((point) => point.count)));
const points = computed(() =>
  props.series.map((point, index) => ({
    ...point,
    x: 40 + index * (520 / Math.max(1, props.series.length - 1)),
    y: 150 - (point.count / ceiling.value) * 125,
  })),
);
const line = computed(() => points.value.map((point) => `${point.x},${point.y}`).join(' '));
const total = computed(() => props.series.reduce((sum, point) => sum + point.count, 0));
</script>
<template>
  <section class="admin-panel admin-chart">
    <div class="admin-panel-heading">
      <div>
        <h2>{{ title }}</h2><p class="small muted">
          Last {{ series.length }} calendar months · UTC
        </p>
      </div><span class="admin-chart-total">{{ total.toLocaleString() }}<small>Total registrations</small></span>
    </div><svg viewBox="0 0 600 185" role="img" :aria-label="`${title}: ${total} registrations`"><g v-for="level in [0, 0.5, 1]" :key="level"><line
      x1="40"
      x2="570"
      :y1="150 - level * 125"
      :y2="150 - level * 125"
      stroke="var(--v-border)"
      stroke-dasharray="3 5"
    /><text x="5" :y="155 - level * 125" class="chart-label">{{ Math.round(ceiling * level) }}</text></g><polygon v-if="points.length" :points="`40,150 ${line} ${points.at(-1)?.x},150`" fill="var(--v-accent-soft)" /><polyline :points="line" fill="none" stroke="var(--v-accent)" stroke-width="2" /><g v-for="(point, index) in points" :key="point.month"><circle :cx="point.x" :cy="point.y" r="3" fill="var(--v-accent)"><title>{{ point.month }}: {{ point.count }}</title></circle><text
      v-if="index % 3 === 0 || index === points.length - 1"
      :x="point.x"
      y="178"
      text-anchor="middle"
      class="chart-label"
    >{{ point.month }}</text></g></svg><details>
      <summary class="small muted">
        View monthly counts
      </summary><table>
        <thead><tr><th>Month</th><th>Registrations</th></tr></thead><tbody>
          <tr v-for="point in series" :key="point.month">
            <td>{{ point.month }}</td><td>{{ point.count }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>
