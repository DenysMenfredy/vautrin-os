import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { createError, readBody } from 'h3';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import AgentsPage from '../app/pages/agents.vue';
import SettingsPage from '../app/pages/settings.vue';
import WorkflowsPage from '../app/pages/workflows.vue';

const now = '2026-09-30T12:00:00.000Z';
let workflowInput: Record<string, unknown> | null = null;
let agentInput: Record<string, unknown> | null = null;
let settingsProfileInput: Record<string, unknown> | null = null;

registerEndpoint('/api/auth/refresh', () => ({
  accessToken: 'test-access',
  expiresIn: 900,
  refreshToken: 'ignored-in-browser',
  user: { id: 'user-1', email: 'owner@example.com', name: 'Alex' },
  activeTenantId: 'tenant-1',
  memberships: [{ tenantId: 'tenant-1', name: 'Acme Remodeling', slug: 'acme', role: 'OWNER' }],
}));
registerEndpoint('/api/auth/me', () => ({
  user: { id: 'user-1', email: 'owner@example.com', name: 'Alex' },
  activeTenantId: 'tenant-1',
  role: 'OWNER',
  capabilities: ['workflow.read', 'workflow.manage', 'business.read', 'business.manage'],
  memberships: [{ tenantId: 'tenant-1', name: 'Acme Remodeling', slug: 'acme', role: 'OWNER' }],
}));
registerEndpoint('/api/workflows', async (event) => {
  if (event.method === 'POST') {
    workflowInput = await readBody(event);
    return {
      id: '11111111-1111-4111-8111-111111111111',
      ...workflowInput,
      version: 1,
      status: 'DRAFT',
      conditions: [],
      retryPolicy: {},
      failurePolicy: {},
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  return { items: [], nextCursor: null };
});
registerEndpoint('/api/agents', async (event) => {
  if (event.method === 'POST') {
    agentInput = await readBody(event);
    return {
      id: '22222222-2222-4222-8222-222222222222',
      ...agentInput,
      version: 1,
      status: 'DRAFT',
      modelConfiguration: {},
      knowledgeStrategy: {},
      guardrails: {},
      handoffPolicy: {},
      createdAt: now,
      updatedAt: now,
    };
  }
  return { items: [], nextCursor: null };
});
registerEndpoint('/api/business/profile', async (event) => {
  if (event.method === 'PATCH') {
    settingsProfileInput = (await readBody(event)) as Record<string, unknown>;
    return {
      id: 'business-1',
      displayName: settingsProfileInput.displayName,
      legalName: null,
      phone: null,
      email: null,
      website: null,
      description: null,
      timezone: settingsProfileInput.timezone,
      locale: 'en-US',
      currency: 'USD',
      businessHours: {},
      createdAt: now,
      updatedAt: now,
    };
  }
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: { message: 'Business profile not found.' },
  });
});
registerEndpoint('/api/business/services', () => ({ items: [], nextCursor: null }));
registerEndpoint('/api/business/service-areas', () => ({ items: [], nextCursor: null }));
registerEndpoint('/api/business/locations', () => ({ items: [], nextCursor: null }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('configuration pages', () => {
  it('saves a draft workflow with an executable end step', async () => {
    const wrapper = await mountSuspended(WorkflowsPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('No workflows here.'));
    await wrapper.find('button.button--primary').trigger('click');
    await wrapper.find('#workflow-key').setValue('lead_follow_up');
    await wrapper.find('#workflow-name').setValue('Lead follow-up');
    await wrapper.find('.modal form').trigger('submit');
    await vi.waitFor(() => expect(workflowInput).not.toBeNull());
    expect(workflowInput).toMatchObject({
      key: 'lead_follow_up',
      trigger: 'lead.created',
      definition: { steps: [{ id: 'step_1', type: 'end', config: {} }] },
    });
  });

  it('saves a draft agent with explicit tool permissions', async () => {
    const wrapper = await mountSuspended(AgentsPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('No agents here.'));
    await wrapper.find('button.button--primary').trigger('click');
    await wrapper.find('#agent-key').setValue('receptionist');
    await wrapper.find('#agent-name').setValue('Receptionist');
    await wrapper.find('#agent-prompt-version').setValue('receptionist-v1');
    await wrapper.find('#agent-instructions').setValue('Only answer with verified business facts.');
    await wrapper.find('#agent-tools').setValue('lead.lookup\nlead.update');
    await wrapper.find('.modal form').trigger('submit');
    await vi.waitFor(() => expect(agentInput).not.toBeNull());
    expect(agentInput).toMatchObject({
      key: 'receptionist',
      promptVersion: 'receptionist-v1',
      allowedTools: ['lead.lookup', 'lead.update'],
    });
  });

  it('creates a missing business profile from settings', async () => {
    settingsProfileInput = null;
    const wrapper = await mountSuspended(SettingsPage);
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('This tenant has no business profile yet.'),
    );
    expect(wrapper.find('#business-name').element).toHaveProperty('value', 'Acme Remodeling');
    await wrapper.find('#business-name').setValue('Northstar Remodeling');
    await wrapper.find('.settings-section form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Business profile saved.'));
    expect(settingsProfileInput).toMatchObject({ displayName: 'Northstar Remodeling' });
  });
});
