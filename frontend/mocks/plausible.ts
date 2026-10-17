/**
 * Mock `window.plausible` for local development and tests.
 *
 * `lib/analytics.ts` dispatches to `window.plausible` and does nothing at all
 * when it is absent, so without this there is no way to verify instrumentation
 * without either loading the real Plausible script (which needs a registered
 * domain and sends real traffic) or reading `console.debug` output and
 * comparing it against `docs/analytics-spec.md` by eye.
 *
 * With this stub installed, every event lands in a recorded array and is
 * printed with its payload, so a developer can confirm both that an event
 * fires and that its payload matches the spec.
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

const recorded: RecordedEvent[] = [];

let installed = false;

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
  delete (window as unknown as { plausible?: unknown }).plausible;
  recorded.length = 0;
  installed = false;
}

/**
 * Installs the recording stub. Idempotent, and never replaces a real Plausible
 * implementation: if the actual script has loaded, this is a no-op, so adding
 * it to a dev bootstrap can never shadow production behaviour.
 */
export function initAnalyticsMock(): void {
  if (typeof window === 'undefined') return;
  if (installed) return;
  if (typeof window.plausible === 'function') return;

  const plausible = (name: string, options?: { props?: Record<string, unknown> }): void => {
    const props = options?.props ?? {};
    recorded.push({ name, props });
    // Printed so the developer sees the payload without opening devtools.
    console.info('[analytics:mock]', name, props);
  };

  window.plausible = plausible;
  installed = true;
}