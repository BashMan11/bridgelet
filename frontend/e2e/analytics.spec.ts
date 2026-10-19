/**
 * Analytics e2e (#856).
 *
 * Instrumentation is otherwise invisible to the suite: a refactor can delete a
 * `track()` call and every existing test still passes, because nothing asserts
 * that an event fired. These tests install a recording `window.plausible` and
 * assert both that key funnel events fire and that they fire in the right
 * order.
 *
 * `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is intentionally unset in
 * `playwright.config.ts`, so nothing is sent to a real provider — the stub
 * installed here is the only sink. A test at the end asserts that.
 *
 * Scope note: this covers the events that are wired today. Events still
 * landing in other branches (`Send Form Started`, `Payment Success Viewed`,
 * `Wallet Address Screen Viewed` / `Entered`) should be added here as those
 * changes merge — that is the point of the file.
 */

import type { Page } from '@playwright/test';
import { test, expect, CLAIM_DESTINATION } from './fixtures';

/** One recorded `window.plausible(name, { props })` call. */
interface RecordedEvent {
  name: string;
  props: Record<string, unknown>;
}

type PlausibleFn = (name: string, options?: { props?: Record<string, unknown> }) => void;

interface AnalyticsWindow {
  plausible?: PlausibleFn;
  __recordedAnalytics?: RecordedEvent[];
}

function analyticsWindow(): AnalyticsWindow {
  return window as unknown as AnalyticsWindow;
}

/**
 * Installs the recording sink before any application code runs.
 *
 * `addInitScript` runs in the page before the app's own scripts, so events
 * fired during hydration are captured too — which matters for `Page Viewed`,
 * the first stage of the Sender Activation Funnel.
 */
async function recordAnalytics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recorded: RecordedEvent[] = [];
    const target = window as unknown as AnalyticsWindow;
    target.__recordedAnalytics = recorded;
    target.plausible = (name: string, options?: { props?: Record<string, unknown> }) => {
      recorded.push({ name, props: options?.props ?? {} });
    };
  });
}

function readEvents(page: Page): Promise<RecordedEvent[]> {
  return page.evaluate(() => {
    const target = window as unknown as AnalyticsWindow;
    return target.__recordedAnalytics ?? [];
  });
}

function namesOf(events: RecordedEvent[]): string[] {
  return events.map((event) => event.name);
}

test.describe('Analytics instrumentation', () => {
  test('the claim funnel fires in order and carries the §3.1 base payload', async ({
    claimPage,
    page,
  }) => {
    await recordAnalytics(page);

    await claimPage.goto('valid-claim-token');
    await claimPage.waitForClaimCard();
    await claimPage.claimFunds(CLAIM_DESTINATION);
    await expect(page.getByText(/payment claimed!/i)).toBeVisible({ timeout: 15_000 });

    const events = await readEvents(page);
    const names = namesOf(events);

    // Order matters as much as presence: a claim event firing before the page
    // was opened would make every funnel query nonsense.
    const openedIndex = names.indexOf('Claim Page Opened');
    const submittedIndex = names.indexOf('Claim Submitted');
    const succeededIndex = names.indexOf('Claim Succeeded');

    expect(openedIndex).toBeGreaterThanOrEqual(0);
    expect(submittedIndex).toBeGreaterThan(openedIndex);
    expect(succeededIndex).toBeGreaterThan(submittedIndex);

    const opened = events[openedIndex]!;
    expect(opened.props.journey).toBe('recipient');
    expect(opened.props.claim_id).toBe('valid-claim-token');
    expect(opened.props.entry_channel).toEqual(expect.any(String));
    expect(opened.props.platform).toBe('web');
    expect(opened.props.anonymous_id).toEqual(expect.any(String));
    expect(opened.props.session_id).toEqual(expect.any(String));
    expect(opened.props.device_type).toEqual(expect.stringMatching(/^(mobile|tablet|desktop)$/));
    // §9.4: the pipeline deduplicates on this.
    expect(opened.props.message_id).toEqual(expect.any(String));
  });

  test('the same anonymous_id and session_id are shared across a visit', async ({
    claimPage,
    page,
  }) => {
    await recordAnalytics(page);

    await claimPage.goto('valid-claim-token');
    await claimPage.waitForClaimCard();
    await claimPage.claimFunds(CLAIM_DESTINATION);
    await expect(page.getByText(/payment claimed!/i)).toBeVisible({ timeout: 15_000 });

    const events = await readEvents(page);
    expect(events.length).toBeGreaterThan(1);

    const anonymousIds = new Set(events.map((event) => event.props.anonymous_id));
    const sessionIds = new Set(events.map((event) => event.props.session_id));
    expect(anonymousIds.size).toBe(1);
    expect(sessionIds.size).toBe(1);

    // Distinct events must not share a deduplication key.
    const messageIds = new Set(events.map((event) => event.props.message_id));
    expect(messageIds.size).toBe(events.length);
  });

  test('an invalid address is reported without the address reaching the payload', async ({
    claimPage,
    page,
  }) => {
    await recordAnalytics(page);

    await claimPage.goto('valid-claim-token');
    await claimPage.waitForClaimCard();
    await page.getByLabel(/your stellar wallet address/i).fill('not-a-real-address');

    await expect(page.getByText(/enter a valid stellar public key/i)).toBeVisible({
      timeout: 10_000,
    });

    const events = await readEvents(page);
    const failed = events.filter((event) => event.name === 'Wallet Address Validation Failed');

    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.props.journey).toBe('recipient');
    expect(failed[0]!.props.validation_error).toMatch(
      /invalid_prefix|invalid_length|invalid_checksum/,
    );
    expect(JSON.stringify(failed[0]!.props)).not.toContain('not-a-real-address');
  });

  test('a failed claim reports §6 with the failure, and the destination never leaks', async ({
    claimPage,
    page,
  }) => {
    await recordAnalytics(page);

    await claimPage.goto('fail-claim-token');
    await claimPage.waitForClaimCard();
    await claimPage.claimFunds(CLAIM_DESTINATION);

    await expect(
      page.getByRole('alert').filter({ hasText: /claim could not be completed/i }),
    ).toBeVisible({ timeout: 15_000 });

    const events = await readEvents(page);
    const names = namesOf(events);

    // Intent first, then the failure — the funnel ordering the spec relies on.
    expect(names.indexOf('Claim Submitted')).toBeLessThan(names.indexOf('Claim Failed'));
    expect(names).toContain('Error Displayed');

    for (const event of events) {
      expect(JSON.stringify(event.props)).not.toContain(CLAIM_DESTINATION);
    }
  });

  test('the sender funnel fires stage by stage', async ({ sendPage, page }) => {
    await recordAnalytics(page);

    await sendPage.submitFullFlow();

    const events = await readEvents(page);
    const names = namesOf(events);

    for (const expected of [
      'Send Form Viewed',
      'Send Form Completed',
      'Payment Confirmation Viewed',
      'Payment Confirmed',
      'Payment Created',
    ]) {
      expect(names).toContain(expected);
    }

    // `Payment Confirmed` is user intent, `Payment Created` is the created
    // account. The spec is explicit that only the latter may be counted as a
    // successful payment, so the order is asserted to keep that visible.
    const confirmedIndex = names.indexOf('Payment Confirmed');
    const createdIndex = names.indexOf('Payment Created');
    expect(createdIndex).toBeGreaterThan(confirmedIndex);

    const created = events[createdIndex]!;
    expect(created.props.journey).toBe('sender');
    expect(created.props.claim_id).toEqual(expect.any(String));
    expect(created.props.message_id).toEqual(expect.any(String));
  });

  test('nothing is sent to a real provider when the domain is unconfigured', async ({
    claimPage,
    page,
  }) => {
    const outbound: string[] = [];
    page.on('request', (request) => {
      if (/plausible|analytics|segment|posthog/i.test(request.url())) outbound.push(request.url());
    });

    await recordAnalytics(page);
    await claimPage.goto('valid-claim-token');
    await claimPage.waitForClaimCard();

    expect(outbound).toEqual([]);
  });
});