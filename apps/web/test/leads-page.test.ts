import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { getQuery, readBody } from 'h3';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import LeadsPage from '../app/pages/leads.vue';

const leadId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const createdLeadId = '33333333-3333-4333-8333-333333333333';
const createdContactId = '44444444-4444-4444-8444-444444444444';
const lead = {
  id: leadId,
  contactId,
  status: 'NEW',
  sourceId: null,
  service: 'Kitchen remodeling',
  assignedUserId: null,
  title: 'Kitchen renovation',
  description: null,
  estimatedValue: '18000.00',
  lastContactedAt: null,
  version: 1,
  createdAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
};
let transitions = 0;
let createdLeadBody: Record<string, unknown> | null = null;
let submittedSearches: string[] = [];

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

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
  capabilities: ['lead.read', 'lead.write', 'contact.read', 'business.read'],
  memberships: [{ tenantId: 'tenant-1', name: 'Acme Remodeling', slug: 'acme', role: 'OWNER' }],
}));
registerEndpoint('/api/leads', async (event) => {
  if (event.method === 'POST') {
    createdLeadBody = (await readBody(event)) as Record<string, unknown>;
    return {
      ...lead,
      id: createdLeadId,
      contactId: createdContactId,
      service: 'kitchen-remodel',
    };
  }
  const search = getQuery(event).search;
  if (typeof search === 'string' && search) submittedSearches.push(search);
  return { items: [lead], nextCursor: null };
});
registerEndpoint('/api/contacts', (event) => {
  if (event.method === 'POST') {
    return {
      id: createdContactId,
      firstName: 'New',
      lastName: 'Customer',
      email: 'new@example.com',
      phone: null,
      company: null,
      address: null,
      tags: [],
      notes: null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }
  return [];
});
registerEndpoint(`/api/leads/${leadId}/status`, () => {
  transitions += 1;
  return { ...lead, status: 'CONTACTED', version: 2 };
});
registerEndpoint(`/api/contacts/${contactId}`, () => ({
  id: contactId,
  firstName: 'Maria',
  lastName: 'Johnson',
  email: 'maria@example.com',
  phone: '+15551234567',
  company: null,
  address: null,
  tags: [],
  notes: null,
  createdAt: lead.createdAt,
  updatedAt: lead.updatedAt,
}));
registerEndpoint(`/api/contacts/${createdContactId}`, () => ({
  id: createdContactId,
  firstName: 'New',
  lastName: 'Customer',
  email: 'new@example.com',
  phone: null,
  company: null,
  address: null,
  tags: [],
  notes: null,
  createdAt: lead.createdAt,
  updatedAt: lead.updatedAt,
}));
registerEndpoint('/api/lead-sources', () => ({ items: [], nextCursor: null }));
registerEndpoint('/api/business/services', () => ({
  items: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      key: 'kitchen-remodel',
      name: 'Kitchen remodeling',
      description: null,
      active: true,
      metadata: {},
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    },
  ],
  nextCursor: null,
}));
registerEndpoint('/api/business/profile', () => ({
  id: 'business-1',
  displayName: 'Acme Remodeling',
  legalName: null,
  phone: null,
  email: null,
  website: null,
  description: null,
  timezone: 'America/New_York',
  locale: 'en-US',
  currency: 'USD',
  businessHours: {},
  createdAt: lead.createdAt,
  updatedAt: lead.updatedAt,
}));

describe('leads workspace', () => {
  it('uses contact details and confirms a lead stage change', async () => {
    const wrapper = await mountSuspended(LeadsPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Maria Johnson'));
    await wrapper.find('button.text-button').trigger('click');
    expect(wrapper.text()).toContain('$18,000.00');
    await wrapper.find('#detail-stage').setValue('CONTACTED');
    await wrapper.find('.detail-panel form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Lead stage updated.'));
    expect(transitions).toBe(1);
    expect(wrapper.find('.detail-panel').text()).toContain('Contacted');
  });

  it('submits the active service key selected from the tenant catalog', async () => {
    createdLeadBody = null;
    const wrapper = await mountSuspended(LeadsPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Maria Johnson'));
    await wrapper.find('button.button--primary').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('#new-service').text()).toContain('Kitchen remodeling'),
    );
    await wrapper.find('#new-first').setValue('New');
    await wrapper.find('#new-last').setValue('Customer');
    await wrapper.find('#new-email').setValue('new@example.com');
    await wrapper.find('#new-title').setValue('Kitchen renovation');
    await wrapper.find('#new-service').setValue('kitchen-remodel');
    await wrapper.find('.modal form').trigger('submit');
    await vi.waitFor(() => expect(createdLeadBody).not.toBeNull());
    expect(createdLeadBody).toMatchObject({ service: 'kitchen-remodel' });
  });

  it('submits the customer search term to the lead API', async () => {
    submittedSearches = [];
    const wrapper = await mountSuspended(LeadsPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Maria Johnson'));
    await wrapper.find('#lead-search').setValue('Maria Johnson');
    await wrapper.find('form.toolbar').trigger('submit');
    await vi.waitFor(() => expect(submittedSearches).toContain('Maria Johnson'));
  });
});
