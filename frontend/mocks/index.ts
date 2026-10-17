/**
 * Bootstraps MSW in development.
 *
 * Import this module once at the app entry point (e.g. layout.tsx) when
 * `process.env.NODE_ENV === 'development'`.
 *
 * Usage:
 *   if (process.env.NODE_ENV === 'development') {
 *     const { initMocks } = await import('@/mocks');
 *     await initMocks();
 *   }
 */
export async function initMocks(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const { worker } = await import('./browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

export {
  getRecordedEvents,
  getRecordedEventNames,
  getRecordedEventsByName,
  initAnalyticsMock,
  resetPlausibleMock,
  uninstallPlausibleMock,
  type RecordedEvent,
} from './plausible';