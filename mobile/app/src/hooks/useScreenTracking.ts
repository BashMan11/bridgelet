import { useEffect } from 'react';
import { trackScreenView } from '../analytics/analytics';

/**
 * Records a screen view when the screen mounts.
 *
 * The event is `Screen Viewed` rather than the previous `screen_view`: the
 * mobile app follows the same Title Case naming as
 * `docs/analytics-spec.md` so mobile and web events can be joined in one
 * dataset. The old name was also not a member of the `AnalyticsEvent` union,
 * so this hook could not type-check against it.
 *
 * The hook is now called from the app's top-level screens; before this it was
 * defined and never used, which is why no screen view was ever recorded.
 */
export function useScreenTracking(screen: string): void {
  useEffect(() => {
    trackScreenView(screen);
  }, [screen]);
}