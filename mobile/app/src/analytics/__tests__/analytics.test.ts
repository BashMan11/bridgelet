/**
 * Tests for the mobile analytics module.
 *
 * Conventions follow `app/src/utils/__tests__/apiClient.test.ts`: relative
 * imports, `jest.mock` with an inline factory, and a single top-level
 * `describe(moduleName)`.
 */

// AsyncStorage is a native module; without this mock every call throws.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      __store: store,
    },
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    platform: 'ios',
    appOwnership: 'standalone',
    expoConfig: { version: '1.4.2' },
  },
}));

// The real module reads EXPO_PUBLIC_ENV at import time, so the environment has
// to be set before it is required.
jest.mock('../../config/env', () => ({
  __esModule: true,
  isDev: false,
  isProd: true,
  default: { environment: 'production' },
}));

const storage = require('@react-native-async-storage/async-storage').default;

const ANALYTICS_PATH = '../analytics';

// Imported inside the tests so each one controls the module-level state
// (cached identifiers, the "no endpoint configured" warning) through
// `jest.resetModules`.
type AnalyticsModule = typeof import('../analytics/analytics');

async function loadAnalytics(): Promise<AnalyticsModule> {
  let mod!: AnalyticsModule;
  await jest.isolateModulesAsync(async () => {
    mod = require(ANALYTICS_PATH) as AnalyticsModule;
  });
  return mod;
}

/** Lets the fire-and-forget promise chain inside `track()` settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('analytics', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    storage.__store.clear();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT;
    jest.restoreAllMocks();
  });

  describe('identity', () => {
    it('mints an anonymous_id once and reuses it', async () => {
      const { track, JOURNEYS } = await loadAnalytics();

      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'home' } });
      await flush();
      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'send' } });
      await flush();

      expect(storage.setItem).toHaveBeenCalledTimes(1);
      const stored = storage.__store.get('bridgelet_anonymous_id');
      const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(stored).toMatch(UUID_V4);

      const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
      expect(bodies[0].anonymous_id).toBe(stored);
      expect(bodies[1].anonymous_id).toBe(stored);
    });

    it('gives every event in one app run the same session_id', async () => {
      const { track, JOURNEYS } = await loadAnalytics();

      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'a' } });
      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'b' } });
      await flush();

      const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
      expect(bodies[0].session_id).toBe(bodies[1].session_id);
      expect(bodies[0].session_id).toBeTruthy();
    });

    it('starts a new session_id after a cold start', async () => {
      const first = await loadAnalytics();
      first.track({
        name: 'Screen Viewed',
        params: { journey: first.JOURNEYS.shared, screen: 'a' },
      });
      await flush();
      const firstSession = JSON.parse(fetchMock.mock.calls[0][1].body).session_id;

      jest.resetModules();
      storage.__store.clear();
      fetchMock.mockClear();
      const second = await loadAnalytics();
      second.track({
        name: 'Screen Viewed',
        params: { journey: second.JOURNEYS.shared, screen: 'a' },
      });
      await flush();
      const secondSession = JSON.parse(fetchMock.mock.calls[0][1].body).session_id;

      expect(secondSession).not.toBe(firstSession);
    });

    it('never persists a session id', async () => {
      const { track, JOURNEYS } = await loadAnalytics();
      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'a' } });
      await flush();

      expect(storage.__store.has('bridgelet_session_id')).toBe(false);
    });
  });

  describe('base payload', () => {
    it('carries every §3.1 field on every event', async () => {
      process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT = 'https://example.test/events';
      const { track, JOURNEYS } = await loadAnalytics();

      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.sender, screen: 'send' } });
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual(
        expect.objectContaining({
          name: 'Screen Viewed',
          journey: 'sender',
          screen: 'send',
          platform: 'ios',
          device_type: 'mobile',
          app_version: '1.4.2',
          anonymous_id: expect.any(String),
          session_id: expect.any(String),
        }),
      );
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    it('exposes the same journey vocabulary as the web app', async () => {
      const { JOURNEYS } = await loadAnalytics();
      expect(Object.values(JOURNEYS)).toEqual(['sender', 'recipient', 'shared']);
    });

    it('lets event params sit on top of the base payload', async () => {
      process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT = 'https://example.test/events';
      const { track, JOURNEYS } = await loadAnalytics();

      track({
        name: 'Notification Opened',
        params: { journey: JOURNEYS.shared, notification_type: 'payment' },
      });
      await flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.notification_type).toBe('payment');
      expect(body.journey).toBe('shared');
    });
  });

  describe('dispatch', () => {
    it('does not send anything when no endpoint is configured', async () => {
      const { track, JOURNEYS, isAnalyticsEnabled } = await loadAnalytics();

      expect(isAnalyticsEnabled()).toBe(false);
      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'a' } });
      await flush();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends when a production build has an endpoint', async () => {
      process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT = 'https://example.test/events';
      const { track, JOURNEYS, isAnalyticsEnabled } = await loadAnalytics();

      expect(isAnalyticsEnabled()).toBe(true);
      track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'a' } });
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/events');
    });

    it('never lets a failed send throw at the call site', async () => {
      process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT = 'https://example.test/events';
      fetchMock.mockRejectedValue(new Error('offline'));
      const { track, JOURNEYS } = await loadAnalytics();

      expect(() =>
        track({ name: 'Screen Viewed', params: { journey: JOURNEYS.shared, screen: 'a' } }),
      ).not.toThrow();
      await flush();
    });
  });

  describe('trackScreenView', () => {
    it('records the screen name', async () => {
      process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT = 'https://example.test/events';
      const { trackScreenView } = await loadAnalytics();

      trackScreenView('claim_success');
      await flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.name).toBe('Screen Viewed');
      expect(body.screen).toBe('claim_success');
    });
  });
});