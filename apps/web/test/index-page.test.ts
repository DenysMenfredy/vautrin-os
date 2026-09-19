import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

import IndexPage from '../app/pages/index.vue';

/**
 * Renders the status page against a stubbed API.
 *
 * `registerEndpoint` intercepts inside Nuxt's own fetch layer, so the
 * component exercises its real `useFetch` path. A mocked composable would
 * still pass with the wrong URL or a broken contract.
 *
 * Two things make this fiddlier than it looks, both learned the hard way:
 *
 *   1. registerEndpoint does not override an earlier registration for the
 *      same path, so the endpoint is registered once and switches behaviour
 *      through `mode`.
 *   2. useFetch caches by `key`, so a second mount reuses the first
 *      response unless the cached entry is cleared first.
 */

let mode: 'healthy' | 'down' = 'healthy';

registerEndpoint('/api/health/ready', () => {
  if (mode === 'down') {
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' });
  }
  return { status: 'ok', database: { status: 'up', latencyMs: 4 } };
});

beforeEach(() => {
  clearNuxtData('api-health');
});

describe('status page', () => {
  it('reports both dependencies as healthy', async () => {
    mode = 'healthy';

    const text = (await mountSuspended(IndexPage)).text();

    expect(text).toContain('Platform status');
    expect(text).toContain('up · 4ms');
    // 'unreachable' contains 'reachable', so assert the negative too.
    expect(text).not.toContain('unreachable');
  });

  it('degrades to an unreachable state when the API fails', async () => {
    // A dashboard tile must not take the whole page down with it.
    mode = 'down';

    const text = (await mountSuspended(IndexPage)).text();

    expect(text).toContain('unreachable');
    expect(text).toContain('unavailable');
  });
});
