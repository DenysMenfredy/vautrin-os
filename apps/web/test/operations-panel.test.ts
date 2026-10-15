import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import OperationsPanel from '../app/components/OperationsPanel.vue';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
mockNuxtImport('useSession', () => () => ({ can: () => true, request }));
const run = {
  id: 'run-1',
  workflowKey: 'missed_call_recovery_v1',
  workflowVersion: 1,
  triggerEvent: 'call.missed',
  status: 'WAITING',
  currentStepId: 'recover',
  error: null,
  correlationId: null,
  createdAt: '2026-10-14T12:00:00.000Z',
  completedAt: null,
};
const summary = {
  workflowRuns: 2,
  failedWorkflows: 0,
  waitingWorkflows: 1,
  agentRuns: 1,
  handoffs: 1,
  inputTokens: 10,
  outputTokens: 5,
  cachedInputTokens: 0,
  outboundMessages: 1,
  failedMessages: 0,
  bookedAppointments: 0,
  missedCalls: 1,
  pendingEvents: 0,
  oldestPendingEventAgeSeconds: null,
};
describe('automation operations', () => {
  it('loads all runs without an empty status filter and allows return from the final page', async () => {
    request.mockImplementation(
      (path: string, options?: { query?: { cursor?: string; status?: string } }) => {
        if (path === '/operations/summary') return Promise.resolve(summary);
        if (options?.query?.status === '') return Promise.reject(new Error('status is invalid'));
        return Promise.resolve({
          items: [run],
          nextCursor: options?.query?.cursor ? null : 'page-two',
        });
      },
    );
    const wrapper = await mountSuspended(OperationsPanel);
    await vi.waitFor(() => expect(wrapper.text()).toContain('missed_call_recovery_v1'));
    const next = wrapper.findAll('button').find((button) => button.text() === 'Next page');
    await next?.trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.findAll('button').some((button) => button.text() === 'Next page')).toBe(false),
    );
    expect(wrapper.findAll('button').some((button) => button.text() === 'First page')).toBe(true);
    expect(request).toHaveBeenCalledWith('/operations/runs', {
      query: { limit: 10, status: undefined, cursor: undefined },
    });
  });
  it('inspects persisted telemetry and cancels the selected run', async () => {
    request.mockImplementation((path: string) => {
      if (path === '/operations/summary') return Promise.resolve(summary);
      if (path === '/operations/runs') return Promise.resolve({ items: [run], nextCursor: null });
      return Promise.resolve({
        ...run,
        status: path.endsWith('/cancel') ? 'CANCELLED' : 'WAITING',
        steps: [],
        agents: [],
      });
    });
    const wrapper = await mountSuspended(OperationsPanel);
    await vi.waitFor(() => expect(wrapper.text()).toContain('missed_call_recovery_v1'));
    await wrapper.find('button.link').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cancel remaining work'));
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel remaining work')
      ?.trigger('click');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('/operations/runs/run-1/cancel', { method: 'POST' }),
    );
  });
});
