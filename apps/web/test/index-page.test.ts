import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';

import IndexPage from '../app/pages/index.vue';

let dashboardAvailable = true;

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
  capabilities: ['lead.read', 'lead.write', 'conversation.read', 'appointment.read'],
  memberships: [{ tenantId: 'tenant-1', name: 'Acme Remodeling', slug: 'acme', role: 'OWNER' }],
}));
registerEndpoint('/api/crm/dashboard', () => {
  if (!dashboardAvailable)
    throw createError({ statusCode: 503, statusMessage: 'Service unavailable' });
  return {
    total: 7,
    byStatus: {
      NEW: 3,
      CONTACTED: 1,
      QUALIFIED: 1,
      APPOINTMENT_BOOKED: 0,
      ESTIMATE_PENDING: 0,
      ESTIMATE_SENT: 0,
      FOLLOW_UP: 2,
      WON: 0,
      LOST: 0,
    },
  };
});
registerEndpoint('/api/leads', () => ({ items: [], nextCursor: null }));
registerEndpoint('/api/conversations', () => ({ items: [], nextCursor: null }));
registerEndpoint('/api/appointments', () => ({ items: [], nextCursor: null }));
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
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}));

describe('overview', () => {
  it('shows tenant-backed attention and pipeline values', async () => {
    dashboardAvailable = true;
    const wrapper = await mountSuspended(IndexPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Acme Remodeling'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('7 leads across all stages'));
    expect(wrapper.text()).toContain('Attention total');
    expect(wrapper.text()).toContain('New leads');
    expect(wrapper.text()).toContain('Follow-up stage');
    expect(wrapper.text()).not.toContain('missed calls recovered');
  });

  it('offers a retry when dashboard data is unavailable', async () => {
    dashboardAvailable = false;
    const wrapper = await mountSuspended(IndexPage);
    await vi.waitFor(() => expect(wrapper.text()).toContain('The request failed. Try again.'));
    expect(wrapper.find('button').text()).toContain('Retry');
  });
});
