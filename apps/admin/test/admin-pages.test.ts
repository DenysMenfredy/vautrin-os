import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import type { PlatformRoleName, PlatformSessionResponse, PlatformUser } from '@vautrin/contracts';
import { createError, getQuery, readBody } from 'h3';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import AdminActionDialog from '../app/components/AdminActionDialog.vue';
import { usePlatformSession } from '../app/composables/usePlatformSession';
import DashboardPage from '../app/pages/dashboard.vue';
import UsersPage from '../app/pages/users/index.vue';

const now = '2026-11-10T12:00:00.000Z';
const tenantId = '11111111-1111-4111-8111-111111111111';
let submitted: Record<string, unknown> | null = null;
let query: Record<string, unknown> = {};
let dashboardError = false;
const user: PlatformUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'accepted@example.test',
  name: 'Accepted customer',
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
  lastLoginAt: null,
  disabledAt: null,
  deletedAt: null,
  memberships: [],
  protectedIdentity: false,
};
registerEndpoint('/api/admin/session', () => session('OPERATOR'));
registerEndpoint('/api/admin/users', (event) => {
  query = getQuery(event);
  return { items: [user], nextCursor: query.cursor ? null : 'next-page-cursor' };
});
registerEndpoint('/api/admin/tenants', () => ({
  items: [{ id: tenantId, name: 'Sample business', slug: 'sample', status: 'ACTIVE' }],
  nextCursor: null,
}));
registerEndpoint('/api/admin/invitations', async (event) => {
  submitted = await readBody(event);
  return {
    invitationId: '33333333-3333-4333-8333-333333333333',
    token: 'a'.repeat(43),
    expiresAt: '2026-11-17T00:00:00.000Z',
  };
});
registerEndpoint('/api/admin/dashboard', () => {
  if (dashboardError)
    throw createError({ statusCode: 503, message: 'Metrics temporarily unavailable.' });
  return {
    generatedAt: now,
    timezone: 'UTC',
    summary: {
      usersTotal: 0,
      usersActive: 0,
      usersDisabled: 0,
      usersDeleted: 0,
      tenantsTotal: 0,
      tenantsActive: 0,
      usersCreatedThisMonth: 0,
      tenantsCreatedThisMonth: 0,
      pendingInvitations: 0,
    },
  };
});
for (const path of [
  '/api/admin/analytics/users-per-month',
  '/api/admin/analytics/tenants-per-month',
])
  registerEndpoint(path, () => ({
    timezone: 'UTC',
    series: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      count: 0,
    })),
  }));
registerEndpoint('/api/admin/audit', () => ({ items: [], nextCursor: null }));
function session(role: PlatformRoleName): PlatformSessionResponse {
  return {
    user: {
      id: '44444444-4444-4444-8444-444444444444',
      email: 'operator@example.test',
      name: 'Operator',
    },
    platformRole: role,
    permissions:
      role === 'SUPPORT_READ_ONLY'
        ? ['read']
        : [
            'read',
            'user.invite',
            'user.edit',
            'user.disable',
            'membership.manage',
            'tenant.manage',
          ],
    expiresAt: '2026-11-11T00:00:00.000Z',
  };
}
function withSession(component: typeof UsersPage, role: PlatformRoleName) {
  return defineComponent({
    setup() {
      usePlatformSession().session.value = session(role);
      return () => h(component);
    },
  });
}

describe('platform users UI', () => {
  it('hides mutations for read-only support while retaining inspection', async () => {
    const wrapper = await mountSuspended(withSession(UsersPage, 'SUPPORT_READ_ONLY'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Accepted customer'));
    expect(wrapper.text()).not.toContain('Invite user');
    expect(wrapper.text()).not.toContain('Disable');
    expect(wrapper.find('a[href*="/users/"]').exists()).toBe(true);
    wrapper.unmount();
  });
  it('submits search and cursor pagination to the API', async () => {
    const wrapper = await mountSuspended(withSession(UsersPage, 'OPERATOR'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Accepted customer'));
    await wrapper.find('input[placeholder="Name or email"]').setValue('accepted');
    await wrapper.find('form.admin-filters').trigger('submit');
    await vi.waitFor(() => expect(query.q).toBe('accepted'));
    await vi.waitFor(() =>
      expect(
        wrapper
          .findAll('button')
          .find((button) => button.text() === 'Next')
          ?.attributes('disabled'),
      ).toBeUndefined(),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Next')
      ?.trigger('click');
    await vi.waitFor(() => expect(query.cursor).toBe('next-page-cursor'));
    wrapper.unmount();
  });
  it('generates an invitation without requesting or sending a customer password', async () => {
    const wrapper = await mountSuspended(withSession(UsersPage, 'OPERATOR'));
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Invite user')
      ?.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('#invite-email').exists()).toBe(true));
    await vi.waitFor(() =>
      expect(
        wrapper.findAll('option').some((option) => option.text().includes('Sample business')),
      ).toBe(true),
    );
    const select = wrapper
      .findAll('select')
      .find((candidate) => candidate.find(`option[value="${tenantId}"]`).exists());
    await select?.setValue(tenantId);
    await wrapper.find('#invite-email').setValue('new@example.test');
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    await wrapper.find('section.admin-inline-form form').trigger('submit');
    await vi.waitFor(() =>
      expect(submitted).toMatchObject({ email: 'new@example.test', tenantId, role: 'STAFF' }),
    );
    expect(submitted).not.toHaveProperty('password');
    await vi.waitFor(() => expect(wrapper.find('#issued-invitation-link').exists()).toBe(true));
    expect((wrapper.find('#issued-invitation-link').element as HTMLInputElement).value).toContain(
      'http://localhost:8080/invitation?token=',
    );
    wrapper.unmount();
  });
});
describe('platform dashboard feedback', () => {
  it('renders zero counts and zero-filled charts without fabricating activity', async () => {
    dashboardError = false;
    const wrapper = await mountSuspended(withSession(DashboardPage, 'SUPPORT_READ_ONLY'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Registered users'));
    expect(wrapper.findAll('.admin-metric')).toHaveLength(4);
    expect(wrapper.findAll('svg')).toHaveLength(2);
    expect(wrapper.text()).toContain('No platform activity yet.');
    wrapper.unmount();
  });
  it('shows a retry action when metrics are unavailable', async () => {
    dashboardError = true;
    const wrapper = await mountSuspended(withSession(DashboardPage, 'SUPPORT_READ_ONLY'));
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true));
    expect(wrapper.text()).toContain('Try again');
    wrapper.unmount();
    dashboardError = false;
  });
});
describe('high-risk confirmation', () => {
  it('requires both a reason and the exact DELETE text before confirming', async () => {
    const wrapper = await mountSuspended(AdminActionDialog, {
      props: {
        title: 'Delete customer?',
        description: 'Preserve history and revoke sessions.',
        confirmation: 'DELETE',
        busy: false,
      },
    });
    const confirm = () =>
      wrapper.findAll('button').find((button) => button.text() === 'Confirm action');
    expect(confirm()?.attributes('disabled')).toBeDefined();
    await wrapper.find('#action-reason').setValue('Requested closure');
    await wrapper.find('#action-confirmation').setValue('delete');
    expect(confirm()?.attributes('disabled')).toBeDefined();
    await wrapper.find('#action-confirmation').setValue('DELETE');
    expect(confirm()?.attributes('disabled')).toBeUndefined();
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('confirm')?.[0]).toEqual([
      { reason: 'Requested closure', confirmation: 'DELETE' },
    ]);
    wrapper.unmount();
  });
});
