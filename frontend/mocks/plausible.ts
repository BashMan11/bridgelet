/**
 * Mock `window.plausible` for local development and tests.
 *
 * `lib/analytics.ts` dispatches to `window.plausible` first. The real Plausible
 * script only loads when `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set
 * (`components/plausible-script.tsx`), and it never loads in a test
 * environment. So without a mock, `track()`'s success path cannot be exercised
 * at all - events fall through to `console.debug` in development and are
 * silently dropped in production.
 *
 * Two entry points, over one shared recording buffer:
 *
 * - `initMocks()` (see `./index.ts`) installs it in development when the real
 *   script is not configured, via `initAnalyticsMock()`.
 * - Tests call `installMockPlausible()` and assert on the returned handle.
 *
 * The recorder keeps the exact `(eventName, { props })` shape that `track()`
 * calls, so tests validate the real payload rather than a reduced one.
 *
 * ```ts
 * // in a dev-only bootstrap, alongside initMocks()
 * const { initAnalyticsMock } = await import('@/mocks');
 * initAnalyticsMock();
 * ```
 *
 * Nothing is sent anywhere: the stub is a recording sink, not a client.
 */

/** One recorded call to `window.plausible(name, { props })`. */
export interface RecordedEvent {
  name: string;
  props: Record<string, unknown>;
}

/** Alias kept for the handle-based API. */
export type CapturedAnalyticsEvent = RecordedEvent;

/**
 * Handle returned by {@link installMockPlausible}.
 *
 * `events` is the shared recording buffer, so a test that installs the mock
 * and a story that reads {@link getRecordedEvents} observe the same calls.
 */
export interface MockPlausible {
  /** Captured events, in dispatch order. Mutated in place as events arrive. */
  readonly events: RecordedEvent[];
  /** Clears the captured events without uninstalling. */
  reset(): void;
  /** Removes `window.plausible` (if it is still this mock) and clears events. */
  uninstall(): void;
}

type PlausibleFunction = (
  eventName: string,
  options?: { props?: Record<string, unknown> },
) => void;

/** Events recorded since the last reset. */
const recorded: RecordedEvent[] = [];

/** The function currently installed by this module, if any. */
let installedMock: PlausibleFunction | null = null;

/** Narrows the globally-installed `window.plausible` without augmenting `Window`. */
function windowWithPlausible(): { plausible?: unknown } | null {
  return typeof window === 'undefined' ? null : (window as unknown as { plausible?: unknown });
}

const plausibleMock: PlausibleFunction = (eventName, options) => {
  // Clone the props so a later mutation at a call site cannot rewrite history.
  const props = { ...(options?.props ?? {}) };
  recorded.push({ name: eventName, props });
  // Printed so a developer sees the payload without opening devtools.
  if (process.env.NODE_ENV === 'development') {
    console.info('[analytics:mock]', eventName, props);
  }
};

/**
 * Installs the recording stub and returns a handle to it.
 *
 * Safe to call more than once: every call reuses the single shared buffer, which
 * is what a test's `beforeEach` wants. Returns a handle even during SSR (where no
 * `window` exists) so a caller never has to branch.
 */
export function installMockPlausible(): MockPlausible {
  const target = windowWithPlausible();
  if (target) {
    target.plausible = plausibleMock;
    installedMock = plausibleMock;
  }

  return {
    events: recorded,
    reset() {
      recorded.length = 0;
    },
    uninstall() {
      recorded.length = 0;
      const current = windowWithPlausible();
      if (current && current.plausible === plausibleMock) {
        delete current.plausible;
      }
      if (installedMock === plausibleMock) {
        installedMock = null;
      }
    },
  };
}

/**
 * Installs the recording stub for the dev bootstrap.
 *
 * Idempotent, and never replaces a real Plausible implementation: if the actual
 * script has already loaded this is a no-op, so adding it to a dev bootstrap can
 * never shadow production behaviour.
 */
export function initAnalyticsMock(): void {
  if (typeof window === 'undefined') return;
  if (installedMock !== null) return;
  if (typeof window.plausible === 'function') return;
  window.plausible = plausibleMock;
  installedMock = plausibleMock;
}

/** Events recorded since the last {@link resetPlausibleMock}. */
export function getRecordedEvents(): RecordedEvent[] {
  return recorded;
}

/** The names recorded so far, in order. Handy for asserting a sequence. */
export function getRecordedEventNames(): string[] {
  return recorded.map((event) => event.name);
}

/** Events recorded for one name. */
export function getRecordedEventsByName(name: string): RecordedEvent[] {
  return recorded.filter((event) => event.name === name);
}

/** Clears the recording buffer. Does not uninstall the stub. */
export function resetPlausibleMock(): void {
  recorded.length = 0;
}

/** Removes the stub and the buffer, restoring the pre-mock behaviour. */
export function uninstallPlausibleMock(): void {
  installMockPlausible().uninstall();
}