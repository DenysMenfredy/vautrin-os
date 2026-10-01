import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('./sample-data.json', import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const requiredCapabilities = [
  'business.manage',
  'contact.write',
  'lead.read',
  'lead.write',
  'conversation.read',
  'conversation.write',
  'workflow.manage',
];
const counters = { created: {}, reused: {} };

function requireDevelopmentConfiguration() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Sample seeding is allowed only when NODE_ENV=development.');
  }

  if (!process.env.SEED_OWNER_EMAIL || !process.env.SEED_OWNER_PASSWORD) {
    throw new Error(
      'Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD to an existing development tenant owner account.',
    );
  }

  if (process.env.SEED_OWNER_PASSWORD.length < 12) {
    throw new Error('SEED_OWNER_PASSWORD must contain at least 12 characters.');
  }
}

function getApiBaseUrl() {
  const port = process.env.API_PORT ?? '3000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? '/api';
  const candidate = process.env.SEED_API_BASE_URL ?? `http://127.0.0.1:${port}${prefix}`;
  let url;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error('SEED_API_BASE_URL must be a valid loopback URL.');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('Sample seeding only supports the local HTTP API on a loopback host.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('SEED_API_BASE_URL cannot contain credentials, a query, or a fragment.');
  }

  return url.toString().replace(/\/+$/, '');
}

class ApiError extends Error {
  constructor(method, path, status) {
    super(`${method} ${path} returned HTTP ${status}.`);
  }
}

function urlFor(path, query) {
  const url = new URL(`${apiBaseUrl}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function apiRequest(path, { method = 'GET', body, token, cookie, allow404 = false } = {}) {
  const headers = { accept: 'application/json', 'user-agent': 'vautrin-sample-seeder/1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;

  const response = await fetch(urlFor(path), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new ApiError(method, path, response.status);
  if (response.status === 204) return undefined;
  return response.json();
}

async function listAll(path, token, query = {}) {
  const items = [];
  let cursor;
  const seenCursors = new Set();

  do {
    const pageQuery = { ...query, limit: 100, ...(cursor ? { cursor } : {}) };
    const page = await requestWithQuery(path, token, pageQuery);
    if (!Array.isArray(page.items)) throw new Error(`Unexpected list response from ${path}.`);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error(`The API repeated a pagination cursor for ${path}.`);
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return items;
}

async function requestWithQuery(path, token, query) {
  const url = urlFor(path, query);
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'vautrin-sample-seeder/1',
    },
  });
  if (!response.ok) throw new ApiError('GET', path, response.status);
  return response.json();
}

function recordCount(bucket, type) {
  counters[bucket][type] = (counters[bucket][type] ?? 0) + 1;
}

async function ensureResource(type, found, create) {
  if (found) {
    recordCount('reused', type);
    return found;
  }
  const created = await create();
  recordCount('created', type);
  return created;
}

async function main() {
  requireDevelopmentConfiguration();
  apiBaseUrl = getApiBaseUrl();

  const readiness = await apiRequest('health/ready');
  if (readiness?.status !== 'ok' || readiness?.database?.status !== 'up') {
    throw new Error('The local API or its database is not ready.');
  }

  const login = await apiRequest('auth/login', {
    method: 'POST',
    body: {
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    },
  });
  let accessToken = login.accessToken;
  const refreshCookie = `vos_refresh=${encodeURIComponent(login.refreshToken)}`;

  try {
    const memberships = Array.isArray(login.memberships) ? login.memberships : [];
    if (memberships.length === 0) {
      throw new Error('The seed owner account has no active tenant membership.');
    }

    const requestedTenantId = process.env.SEED_TENANT_ID;
    let tenant = requestedTenantId
      ? memberships.find((membership) => membership.tenantId === requestedTenantId)
      : memberships.find((membership) => membership.tenantId === login.activeTenantId);

    if (!tenant && memberships.length === 1 && !requestedTenantId) tenant = memberships[0];
    if (!tenant) {
      throw new Error(
        'Set SEED_TENANT_ID to one of the seed owner account’s active memberships before seeding.',
      );
    }

    if (tenant.role !== 'OWNER') {
      throw new Error('Sample seeding requires an OWNER membership in the selected tenant.');
    }

    if (login.activeTenantId !== tenant.tenantId) {
      const switched = await apiRequest('auth/tenant', {
        method: 'POST',
        body: { tenantId: tenant.tenantId },
        token: accessToken,
        cookie: refreshCookie,
      });
      accessToken = switched.accessToken;
    }

    const session = await apiRequest('auth/me', { token: accessToken });
    if (session.activeTenantId !== tenant.tenantId || session.role !== 'OWNER') {
      throw new Error('The API session is not scoped to the requested owner tenant.');
    }
    const missingCapabilities = requiredCapabilities.filter(
      (capability) => !session.capabilities.includes(capability),
    );
    if (missingCapabilities.length > 0) {
      throw new Error(
        `The selected role is missing required API capabilities: ${missingCapabilities.join(', ')}.`,
      );
    }

    const workflows = await listAll('workflows', accessToken);
    const triggersFromSampleLeads = new Set(['lead.created', 'lead.status_changed']);
    const activeTriggers = workflows
      .filter(
        (workflow) =>
          workflow.status === 'ACTIVE' && triggersFromSampleLeads.has(workflow.trigger),
      )
      .map((workflow) => workflow.trigger);
    if (activeTriggers.length > 0) {
      throw new Error(
        'This tenant has active lead workflows. Use a clean development tenant so sample leads cannot start automations.',
      );
    }

    await seedTenant(accessToken, workflows);
    printSummary();
  } finally {
    await apiRequest('auth/logout', { method: 'POST', cookie: refreshCookie }).catch(() => {});
  }
}

async function seedTenant(token, workflows) {
  const existingProfile = await apiRequest('business/profile', {
    token,
    allow404: true,
  });
  await ensureResource('business profile', existingProfile, () =>
    apiRequest('business/profile', { method: 'PATCH', token, body: fixtures.profile }),
  );

  const locations = await listAll('business/locations', token);
  await ensureResource(
    'location',
    locations.find((location) => location.name === fixtures.location.name),
    () => apiRequest('business/locations', { method: 'POST', token, body: fixtures.location }),
  );

  const services = await listAll('business/services', token);
  const servicesByKey = new Map(services.map((service) => [service.key, service]));
  for (const service of fixtures.services) {
    servicesByKey.set(
      service.key,
      await ensureResource(
        'service',
        servicesByKey.get(service.key),
        () => apiRequest('business/services', { method: 'POST', token, body: service }),
      ),
    );
  }

  const areas = await listAll('business/service-areas', token);
  for (const area of fixtures.serviceAreas) {
    await ensureResource(
      'service area',
      areas.find((item) => item.type === area.type && item.value === area.value),
      () => apiRequest('business/service-areas', { method: 'POST', token, body: area }),
    );
  }

  const leadSources = await listAll('lead-sources', token, { active: true });
  const sourcesByKey = new Map(leadSources.map((source) => [source.key, source]));
  for (const source of fixtures.leadSources) {
    sourcesByKey.set(
      source.key,
      await ensureResource(
        'lead source',
        sourcesByKey.get(source.key),
        () => apiRequest('lead-sources', { method: 'POST', token, body: source }),
      ),
    );
  }

  const contacts = await listAll('contacts', token);
  const contactsByKey = new Map();
  for (const contact of fixtures.contacts) {
    const { key, ...contactInput } = contact;
    const existing = contacts.find((item) => item.email === contact.email);
    contactsByKey.set(
      key,
      await ensureResource(
        'contact',
        existing,
        () => apiRequest('contacts', { method: 'POST', token, body: contactInput }),
      ),
    );
  }

  const leads = await listAll('leads', token);
  const leadsByTitle = new Map(leads.map((lead) => [lead.title, lead]));
  const contactKeys = new Set(fixtures.contacts.map((contact) => contact.key));
  const sourceKeys = new Set(fixtures.leadSources.map((source) => source.key));

  for (const leadFixture of fixtures.leads) {
    if (!contactKeys.has(leadFixture.contactKey) || !sourceKeys.has(leadFixture.sourceKey)) {
      throw new Error(`The sample lead ${leadFixture.title} refers to an unknown fixture key.`);
    }
    const contact = contactsByKey.get(leadFixture.contactKey);
    const existing = leads.find(
      (lead) => lead.contactId === contact.id && lead.title === leadFixture.title,
    );
    const lead = await ensureResource('lead', existing, async () => {
      let created = await apiRequest('leads', {
        method: 'POST',
        token,
        body: {
          contactId: contact.id,
          sourceId: sourcesByKey.get(leadFixture.sourceKey).id,
          service: leadFixture.serviceKey,
          title: leadFixture.title,
          description: leadFixture.description,
          estimatedValue: leadFixture.estimatedValue,
        },
      });
      if (leadFixture.status !== 'NEW') {
        created = await apiRequest(`leads/${created.id}/status`, {
          method: 'PATCH',
          token,
          body: { version: created.version, status: leadFixture.status },
        });
      }
      return created;
    });
    leadsByTitle.set(leadFixture.title, lead);
  }

  for (const leadFixture of fixtures.leads) {
    const contact = contactsByKey.get(leadFixture.contactKey);
    const lead = leadsByTitle.get(leadFixture.title);
    const conversations = await listAll('conversations', token, { leadId: lead.id });
    await ensureResource(
      'conversation',
      conversations.find((conversation) => conversation.contactId === contact.id),
      () =>
        apiRequest('conversations', {
          method: 'POST',
          token,
          body: {
            contactId: contact.id,
            leadId: lead.id,
            channel: 'EMAIL',
            subject: `Sample thread — ${leadFixture.title}`,
          },
        }),
    );
  }

  await ensureResource(
    'draft workflow',
    workflows.find((workflow) => workflow.key === fixtures.workflow.key),
    () => apiRequest('workflows', { method: 'POST', token, body: fixtures.workflow }),
  );

  const agents = await listAll('agents', token);
  await ensureResource(
    'draft agent',
    agents.find((agent) => agent.key === fixtures.agent.key),
    () => apiRequest('agents', { method: 'POST', token, body: fixtures.agent }),
  );
}

function printSummary() {
  const format = (values) =>
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ') || 'none';

  console.log('Sample data was seeded through the tenant-scoped API.');
  console.log(`Created: ${format(counters.created)}`);
  console.log(`Reused: ${format(counters.reused)}`);
}

let apiBaseUrl;

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unexpected seeding error.';
  console.error(`Sample seeding failed: ${message}`);
  process.exitCode = 1;
});
