import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `PageViewTracker` is the homepage / entry-point call site for the spec's
 * §4.1 `Page Viewed` event (`docs/analytics-spec.md`). Issue #771 read as
 * unfixed because nothing asserted that the tracker actually fires; these tests
 * lock in the trigger, the `page` value and every §4.1 `entry_source` value.
 *
 * See `bridgelet-product-audit/postmortems/issue-771-page-viewed-already-implemented.md`.
 */
const { pageViewed } = vi.hoisted(() => ({ pageViewed: vi.fn() }));

vi.mock('@/lib/analytics', () => ({
  analytics: { pageViewed },
}));

import { PageViewTracker } from './page-view-tracker';

/** Overrides the (read-only) `document.referrer` for a single test. */
function setReferrer(referrer: string): void {
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    get: () => referrer,
  });
}

function clearReferrer(): void {
  delete (document as unknown as { referrer?: string }).referrer;
}

describe('PageViewTracker (§4.1 Page Viewed)', () => {
  beforeEach(() => {
    pageViewed.mockClear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearReferrer();
    window.history.replaceState({}, '', '/');
  });

  it('fires Page Viewed exactly once on mount, with page="homepage"', () => {
    render(<PageViewTracker page="homepage" />);

    expect(pageViewed).toHaveBeenCalledTimes(1);
    expect(pageViewed).toHaveBeenCalledWith({ page: 'homepage', entrySource: 'direct' });
  });

  it('does not re-fire when re-rendered with the same page value', () => {
    const { rerender } = render(<PageViewTracker page="homepage" />);

    rerender(<PageViewTracker page="homepage" />);

    expect(pageViewed).toHaveBeenCalledTimes(1);
  });

  it('re-fires with the new page when the page prop changes', () => {
    const { rerender } = render(<PageViewTracker page="homepage" />);

    rerender(<PageViewTracker page="entry" />);

    expect(pageViewed).toHaveBeenCalledTimes(2);
    expect(pageViewed).toHaveBeenLastCalledWith({ page: 'entry', entrySource: 'direct' });
  });

  it('reports entry_source="referral" for a cross-origin referrer', () => {
    setReferrer('https://example.com/some/page');

    render(<PageViewTracker page="homepage" />);

    expect(pageViewed).toHaveBeenCalledWith({ page: 'homepage', entrySource: 'referral' });
  });

  it('reports entry_source="direct" for a same-origin referrer', () => {
    setReferrer(`${window.location.origin}/previous`);

    render(<PageViewTracker page="homepage" />);

    expect(pageViewed).toHaveBeenCalledWith({ page: 'homepage', entrySource: 'direct' });
  });

  it.each(['ref=campaign', 'utm_source=newsletter'])(
    'reports entry_source="shared_link" when ?%s is present',
    (query) => {
      window.history.replaceState({}, '', `/?${query}`);

      render(<PageViewTracker page="homepage" />);

      expect(pageViewed).toHaveBeenCalledWith({ page: 'homepage', entrySource: 'shared_link' });
    },
  );

  it('reports entry_source="unknown" when the referrer cannot be parsed', () => {
    setReferrer('not a valid absolute url');

    render(<PageViewTracker page="homepage" />);

    expect(pageViewed).toHaveBeenCalledWith({ page: 'homepage', entrySource: 'unknown' });
  });
});
