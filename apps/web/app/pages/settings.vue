<script setup lang="ts">
import type {
  BusinessProfileResponse,
  LocationResponse,
  PageResponse,
  ServiceAreaResponse,
  ServiceAreaType,
  ServiceResponse,
} from '@vautrin/contracts';
import { humanize } from '~/utils/presentation';

const { request, can, session } = useSession();
const profile = ref<BusinessProfileResponse | null>(null);
const services = ref<ServiceResponse[]>([]);
const serviceCursor = ref<string | null>(null);
const areas = ref<ServiceAreaResponse[]>([]);
const areaCursor = ref<string | null>(null);
const locations = ref<LocationResponse[]>([]);
const locationCursor = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const success = ref('');
const displayName = ref('');
const phone = ref('');
const email = ref('');
const website = ref('');
const description = ref('');
const timezone = ref('');
const showServiceForm = ref(false);
const serviceKey = ref('');
const serviceName = ref('');
const serviceDescription = ref('');
const showAreaForm = ref(false);
const areaType = ref<ServiceAreaType>('CITY');
const areaValue = ref('');
const showLocationForm = ref(false);
const locationName = ref('');
const locationCity = ref('');
const locationRegion = ref('');

function fillProfile(value: BusinessProfileResponse) {
  profile.value = value;
  displayName.value = value.displayName;
  phone.value = value.phone ?? '';
  email.value = value.email ?? '';
  website.value = value.website ?? '';
  description.value = value.description ?? '';
  timezone.value = value.timezone;
}
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 404
  );
}
function initializeMissingProfile() {
  profile.value = null;
  const activeTenant = session.value?.memberships.find(
    (membership) => membership.tenantId === session.value?.activeTenantId,
  );
  displayName.value = activeTenant?.name ?? '';
  timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const profileRequest = request<BusinessProfileResponse>('/business/profile').then(
      (value) => ({ value }),
      (cause: unknown) => {
        if (isNotFound(cause)) return { value: null };
        throw cause;
      },
    );
    const [profileResult, serviceResult, areaResult, locationResult] = await Promise.all([
      profileRequest,
      request<PageResponse<ServiceResponse>>('/business/services', { query: { limit: 50 } }),
      request<PageResponse<ServiceAreaResponse>>('/business/service-areas', {
        query: { limit: 50 },
      }),
      request<PageResponse<LocationResponse>>('/business/locations', { query: { limit: 50 } }),
    ]);
    if (profileResult.value) fillProfile(profileResult.value);
    else initializeMissingProfile();
    services.value = [...serviceResult.items];
    serviceCursor.value = serviceResult.nextCursor;
    areas.value = [...areaResult.items];
    areaCursor.value = areaResult.nextCursor;
    locations.value = [...locationResult.items];
    locationCursor.value = locationResult.nextCursor;
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}
async function loadMore(kind: 'services' | 'areas' | 'locations') {
  const path =
    kind === 'services'
      ? '/business/services'
      : kind === 'areas'
        ? '/business/service-areas'
        : '/business/locations';
  const cursor =
    kind === 'services'
      ? serviceCursor.value
      : kind === 'areas'
        ? areaCursor.value
        : locationCursor.value;
  if (!cursor) return;
  error.value = '';
  try {
    if (kind === 'services') {
      const result = await request<PageResponse<ServiceResponse>>(path, {
        query: { limit: 50, cursor },
      });
      services.value.push(...result.items);
      serviceCursor.value = result.nextCursor;
    } else if (kind === 'areas') {
      const result = await request<PageResponse<ServiceAreaResponse>>(path, {
        query: { limit: 50, cursor },
      });
      areas.value.push(...result.items);
      areaCursor.value = result.nextCursor;
    } else {
      const result = await request<PageResponse<LocationResponse>>(path, {
        query: { limit: 50, cursor },
      });
      locations.value.push(...result.items);
      locationCursor.value = result.nextCursor;
    }
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  }
}
async function saveProfile() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    fillProfile(
      await request<BusinessProfileResponse>('/business/profile', {
        method: 'PATCH',
        body: {
          displayName: displayName.value.trim(),
          phone: phone.value.trim() || null,
          email: email.value.trim() || null,
          website: website.value.trim() || null,
          description: description.value.trim() || null,
          timezone: timezone.value.trim(),
        },
      }),
    );
    success.value = 'Business profile saved.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function createService() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await request<ServiceResponse>('/business/services', {
      method: 'POST',
      body: {
        key: serviceKey.value.trim(),
        name: serviceName.value.trim(),
        description: serviceDescription.value.trim() || null,
      },
    });
    services.value.unshift(result);
    serviceKey.value = '';
    serviceName.value = '';
    serviceDescription.value = '';
    showServiceForm.value = false;
    success.value = 'Service added.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function createArea() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await request<ServiceAreaResponse>('/business/service-areas', {
      method: 'POST',
      body: { type: areaType.value, value: areaValue.value.trim() },
    });
    areas.value.unshift(result);
    areaValue.value = '';
    showAreaForm.value = false;
    success.value = 'Service area added.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function createLocation() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await request<LocationResponse>('/business/locations', {
      method: 'POST',
      body: {
        name: locationName.value.trim(),
        city: locationCity.value.trim() || null,
        region: locationRegion.value.trim() || null,
      },
    });
    locations.value.unshift(result);
    locationName.value = '';
    locationCity.value = '';
    locationRegion.value = '';
    showLocationForm.value = false;
    success.value = 'Location added.';
  } catch (cause) {
    error.value = apiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
useHead({ title: 'Settings' });
</script>

<template>
  <div>
    <AppPageHeader title="Settings" description="Business details and the places you serve." eyebrow="Configuration" />
    <div v-if="loading" class="surface loading-lines" role="status" aria-label="Loading settings">
      <span /><span /><span />
    </div><div v-else-if="error && !profile" class="notice notice--error" role="alert">
      {{ error }} <button class="button button--ghost button--small" type="button" @click="load">
        Retry
      </button>
    </div>
    <div v-else class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">
        <a href="#profile" class="active">Business profile</a><a href="#services">Services</a><a href="#areas">Service areas</a><a href="#locations">Locations</a>
      </nav><div>
        <p v-if="error" class="notice notice--error" role="alert">
          {{ error }}
        </p><p v-if="success" class="inline-success" role="status">
          {{ success }}
        </p>
        <section id="profile" class="settings-section">
          <h2>Business profile</h2><p class="muted">
            These details describe the active business. Scheduling uses the configured time zone.
          </p><p v-if="!profile" class="notice">
            This tenant has no business profile yet. Add the business details and save to create it.
          </p><form class="form-stack" @submit.prevent="saveProfile">
            <div class="form-grid">
              <div class="field">
                <label for="business-name">Display name</label><input id="business-name" v-model="displayName" required :disabled="!can('business.manage')">
              </div><div class="field">
                <label for="business-timezone">Time zone</label><input
                  id="business-timezone"
                  v-model="timezone"
                  required
                  :disabled="!can('business.manage')"
                  placeholder="America/New_York"
                >
              </div><div class="field">
                <label for="business-phone">Phone</label><input id="business-phone" v-model="phone" type="tel" :disabled="!can('business.manage')">
              </div><div class="field">
                <label for="business-email">Email</label><input id="business-email" v-model="email" type="email" :disabled="!can('business.manage')">
              </div><div class="field">
                <label for="business-website">Website</label><input id="business-website" v-model="website" type="url" :disabled="!can('business.manage')">
              </div>
            </div><div class="field">
              <label for="business-description">Description</label><textarea id="business-description" v-model="description" :disabled="!can('business.manage')" />
            </div><div v-if="can('business.manage')" class="form-actions">
              <button class="button button--primary" type="submit" :disabled="busy">
                {{ busy ? 'Saving…' : 'Save profile' }}
              </button>
            </div>
          </form>
        </section>
        <section id="services" class="settings-section">
          <div class="section-head">
            <div>
              <h2>Services</h2><p class="muted">
                Work your team offers.
              </p>
            </div><button v-if="can('business.manage')" class="button button--secondary button--small" type="button" @click="showServiceForm = !showServiceForm">
              Add service
            </button>
          </div><form v-if="showServiceForm" class="form-stack config-form" @submit.prevent="createService">
            <div class="form-grid">
              <div class="field">
                <label for="service-key">Key</label><input
                  id="service-key"
                  v-model="serviceKey"
                  required
                  pattern="[a-z0-9][a-z0-9-]*"
                  placeholder="kitchen-remodeling"
                >
              </div><div class="field">
                <label for="service-name">Name</label><input id="service-name" v-model="serviceName" required>
              </div>
            </div><div class="field">
              <label for="service-description">Description</label><textarea id="service-description" v-model="serviceDescription" />
            </div><div class="form-actions">
              <button class="button button--primary" type="submit" :disabled="busy">
                Add service
              </button><button class="button button--ghost" type="button" @click="showServiceForm = false">
                Cancel
              </button>
            </div>
          </form><AppEmpty v-if="!services.length" title="No services configured." /><ul v-else class="config-list">
            <li v-for="service in services" :key="service.id">
              <span><strong>{{ service.name }}</strong><small>{{ service.description || service.key }}</small></span><AppBadge :value="service.active ? 'ACTIVE' : 'ARCHIVED'" />
            </li>
          </ul><button v-if="serviceCursor" class="button button--ghost button--small" type="button" @click="loadMore('services')">
            Load more services
          </button>
        </section>
        <section id="areas" class="settings-section">
          <div class="section-head">
            <div>
              <h2>Service areas</h2><p class="muted">
                Where customers can request work.
              </p>
            </div><button v-if="can('business.manage')" class="button button--secondary button--small" type="button" @click="showAreaForm = !showAreaForm">
              Add area
            </button>
          </div><form v-if="showAreaForm" class="form-stack config-form" @submit.prevent="createArea">
            <div class="form-grid">
              <div class="field">
                <label for="area-type">Type</label><select id="area-type" v-model="areaType">
                  <option value="CITY">
                    City
                  </option><option value="POSTAL_CODE">
                    Postal code
                  </option><option value="REGION">
                    Region
                  </option><option value="RADIUS">
                    Radius
                  </option>
                </select>
              </div><div class="field">
                <label for="area-value">Value</label><input id="area-value" v-model="areaValue" required>
              </div>
            </div><div class="form-actions">
              <button class="button button--primary" type="submit" :disabled="busy">
                Add area
              </button><button class="button button--ghost" type="button" @click="showAreaForm = false">
                Cancel
              </button>
            </div>
          </form><AppEmpty v-if="!areas.length" title="No service areas configured." /><ul v-else class="config-list">
            <li v-for="area in areas" :key="area.id">
              <span><strong>{{ area.value }}</strong><small>{{ humanize(area.type) }}</small></span><AppBadge :value="area.active ? 'ACTIVE' : 'ARCHIVED'" />
            </li>
          </ul><button v-if="areaCursor" class="button button--ghost button--small" type="button" @click="loadMore('areas')">
            Load more areas
          </button>
        </section>
        <section id="locations" class="settings-section">
          <div class="section-head">
            <div>
              <h2>Locations</h2><p class="muted">
                Business locations used for operations and scheduling.
              </p>
            </div><button v-if="can('business.manage')" class="button button--secondary button--small" type="button" @click="showLocationForm = !showLocationForm">
              Add location
            </button>
          </div><form v-if="showLocationForm" class="form-stack config-form" @submit.prevent="createLocation">
            <div class="form-grid">
              <div class="field">
                <label for="location-name">Name</label><input id="location-name" v-model="locationName" required>
              </div><div class="field">
                <label for="location-city">City</label><input id="location-city" v-model="locationCity">
              </div><div class="field">
                <label for="location-region">Region</label><input id="location-region" v-model="locationRegion">
              </div>
            </div><div class="form-actions">
              <button class="button button--primary" type="submit" :disabled="busy">
                Add location
              </button><button class="button button--ghost" type="button" @click="showLocationForm = false">
                Cancel
              </button>
            </div>
          </form><AppEmpty v-if="!locations.length" title="No locations configured." /><ul v-else class="config-list">
            <li v-for="location in locations" :key="location.id">
              <span><strong>{{ location.name }}</strong><small>{{ [location.city, location.region, location.country].filter(Boolean).join(', ') }}</small></span><AppBadge v-if="location.isPrimary" value="ACTIVE" label="Primary" />
            </li>
          </ul><button v-if="locationCursor" class="button button--ghost button--small" type="button" @click="loadMore('locations')">
            Load more locations
          </button>
        </section>
      </div>
    </div>
    <RevenueSetup v-if="can('business.manage') || can('integration.manage')" @installed="load" />
  </div>
</template>
