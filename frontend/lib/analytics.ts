// #118 – Privacy-respecting analytics events (Plausible-compatible, no PII)
// Event names must match `docs/analytics-spec.md` `#### \`Event Name\`` headings exactly.
import { getSessionIdWithInactivity } from './analytics-session';
type ClaimEvent =
  | 'Page Viewed'
  | 'Send Form Viewed'
  | 'Send Form Started'
  | 'Send Form Field Changed'
  | 'Send Form Completed'
  | 'Payment Confirmation Viewed'
  | 'Wallet Connected'
  | 'Wallet Connection Failed'
  | 'Payment Confirmed'
  | 'Payment Created'
  | 'Payment Creation Failed'
  | 'Payment Success Viewed'
  | 'Claim Link Copied'
  | 'Claim Link Shared'
  | 'Dashboard Viewed'
  | 'Dashboard Filter Applied'
  | 'Payment Details Viewed'
  | 'Payment Cancelled'
  | 'Funds Reclaimed'
  | 'Claim Page Opened'
  | 'Claim Verified'
  | 'Claim CTA Clicked'
  | 'Wallet Address Screen Viewed'
  | 'Wallet Address Entered'
  | 'Wallet Address Validation Failed'
  | 'Claim Confirmation Viewed'
  | 'Claim Submitted'
  | 'Claim Succeeded'
  | 'Claim Failed'
  | 'Claim Success Viewed'
  | 'Sender Signup CTA Clicked'
  | 'Explorer Link Clicked'
  | 'Error Displayed'
  | 'Retry Clicked'
  | 'Recovery Information Viewed'
  | 'Recovery Information Copied';

type EventProps = Record<string, string | number | boolean | null>;

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/**
 * The `platform` dimension (`docs/analytics-spec.md` §3.1).
 *
 * Every event carries this field, so it is defined once here rather than
 * repeated as a literal at each call site: a typo would split the dimension
 * in two (`'web'` and `'Web'`) and silently fragment every dashboard that
 * groups by platform. The mobile app has its own values (`ios`, `android`);
 * adding one there does not require changing anything here.
 */
export const PLATFORMS = {
  web: 'web',
} as const;

export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

/** The frontend's fixed §3.1 `platform` value. */
export const PLATFORM: Platform = PLATFORMS.web;

/**
 * The `journey` dimension (`docs/analytics-spec.md` §3.1) — the single most
 * important dimension for funnel segmentation, so every event carries it and
 * no emitter may spell it ad-hoc.
 */
export const JOURNEYS = {
  sender: 'sender',
  recipient: 'recipient',
  shared: 'shared',
} as const;

export type Journey = (typeof JOURNEYS)[keyof typeof JOURNEYS];

/**
 * The `network` dimension (`docs/analytics-spec.md` §3.1).
 *
 * `unknown` is a deliberate third member rather than a bug: it is what an
 * unconfigured or misspelled `NEXT_PUBLIC_CRYPTO_NETWORK` reports. Falling
 * back to `testnet` (as the rest of the app does when the variable is unset)
 * would file real traffic into the testnet bucket, which is exactly the
 * distinction §3.1 says exists so QA traffic can be excluded from
 * production dashboards.
 */
export const ANALYTICS_NETWORKS = {
  testnet: 'testnet',
  mainnet: 'mainnet',
  unknown: 'unknown',
} as const;

export type AnalyticsNetwork = (typeof ANALYTICS_NETWORKS)[keyof typeof ANALYTICS_NETWORKS];

/**
 * Resolves the §3.1 `network` field from `NEXT_PUBLIC_CRYPTO_NETWORK`, which
 * carries the SDK's network identifiers (`stellar-testnet` /
 * `stellar-mainnet`). Static member access keeps Next.js able to inline the
 * value into the browser bundle.
 */
export function currentNetwork(): AnalyticsNetwork {
  const configured = process.env['NEXT_PUBLIC_CRYPTO_NETWORK'];
  if (configured === 'stellar-mainnet') return ANALYTICS_NETWORKS.mainnet;
  if (configured === 'stellar-testnet') return ANALYTICS_NETWORKS.testnet;
  return ANALYTICS_NETWORKS.unknown;
}

/**
 * Coerces a caller-supplied `journey` into a valid §3.1 value. Anything
 * unrecognised (including `undefined`) becomes `shared`, the only value that
 * is truthful for an event not owned by one side of the flow.
 */
export function normalizeJourney(value: unknown): Journey {
  return typeof value === 'string' && value in JOURNEYS
    ? (value as Journey)
    : JOURNEYS.shared;
}

/**
 * App version correlated to a deploy (`docs/analytics-spec.md` §3.1
 * `app_version`). Inlined at build time from NEXT_PUBLIC_APP_VERSION so
 * dashboards can attribute event volume to a release. Falls back to
 * "unknown" rather than emitting an empty string.
 */
export function appVersion(): string {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return version && version.trim().length > 0 ? version : 'unknown';
}

/**
 * Classifies `mobile | tablet | desktop` from a user agent
 * (`docs/analytics-spec.md` §3.1 `device_type`). Accepts an explicit UA
 * string for testability; defaults to the runtime navigator user agent.
 * Desktop is the conservative default when no signal matches.
 */
export function detectDeviceType(userAgent?: string): DeviceType {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (/(tablet|ipad)/i.test(ua)) return 'tablet';
  if (/(mobile|iphone|ipod|android)/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Stellar network the build is pointed at (`docs/analytics-spec.md` §3.1
 * `network`), derived from NEXT_PUBLIC_CRYPTO_NETWORK (`stellar-testnet` |
 * `stellar-mainnet`). Accepts an explicit value for testability.
 *
 * Only an explicit mainnet setting reports `mainnet`; anything else —
 * unset, empty, a typo — reports `testnet`. Dashboards filter on
 * `network = mainnet` to exclude test traffic, so a misconfigured build
 * must fail towards being excluded rather than polluting production KPIs.
 */
export function detectNetwork(configured?: string): AnalyticsNetwork {
  const value = (configured ?? process.env.NEXT_PUBLIC_CRYPTO_NETWORK ?? '').trim().toLowerCase();
  return value === 'stellar-mainnet' || value === 'mainnet' || value === 'public'
    ? 'mainnet'
    : 'testnet';
}

/**
 * Base payload fields (`docs/analytics-spec.md` §3.1) shared by every
 * event: `journey`, `timestamp`, `network`, `app_version`, `user_agent` (the
 * raw navigator UA string), `device_type`, `referrer`, and the fixed frontend
 * `platform` value "web". Each field degrades gracefully when the browser API
 * it depends on is unavailable (SSR, unit tests without a DOM).
 *
 * `journey` is taken as an argument rather than read from a module-level value
 * because it is a property of the *event*, not of the session: the same visitor
 * is `sender` on `/send` and `recipient` on `/claim/[token]`. `track()` therefore
 * passes the journey the emitter declared and callers that omit one are recorded
 * as `shared`.
 */
export function buildBasePayload(journey: Journey = JOURNEYS.shared): EventProps {
  return {
    journey,
    timestamp: new Date().toISOString(),
    network: currentNetwork(),
    app_version: appVersion(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    device_type: detectDeviceType(),
    referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : null,
    platform: PLATFORM,
  };
}

// ─── Consent gate ─────────────────────────────────────────────────────────────

/**
 * Explicit opt-out, checked by `track()` before anything else happens.
 *
 * `docs/analytics-spec.md` §9.5 only covers Do Not Track, which is a
 * browser-level signal that Bridgelet cannot
 * influence; it is necessary but not sufficient. A wallet-connected product
 * handling claim tokens and payment amounts should also be able to honour a
 * decision the visitor made *on the site*, without asking them to configure
 * their browser, and without editing their browser settings after the fact.
 *
 * The value is intentionally one-way in storage terms: absent means "no
 * decision recorded yet", `'1'` means opted out. Opting back in clears the
 * key rather than writing `'0'`, so a stale `'0'` can never outlive the
 * reason it was written. Defaulting to allowed keeps today's behaviour for
 * existing visitors while making the gate available to a future consent UI
 * before any event ships.
 */
const OPT_OUT_KEY = 'bridgelet_analytics_opt_out';

/**
 * Reads the explicit opt-out flag.
 *
 * Returns `false` during SSR and when storage is unavailable (private
 * mode, blocked cookies, quota exceeded): an unreadable preference is not
 * the same as an expressed refusal, and failing open here matches the
 * §9.5 behaviour while still leaving the DNT signal to catch anyone who set
 * it at the browser level.
 */
export function isAnalyticsOptedOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Records or clears the explicit opt-out. Pass `true` to stop tracking,
 * `false` to resume. No-ops during SSR so a server render can never write
 * to a visitor's storage.
 */
export function setAnalyticsOptedOut(optedOut: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (optedOut) {
      localStorage.setItem(OPT_OUT_KEY, '1');
    } else {
      localStorage.removeItem(OPT_OUT_KEY);
    }
  } catch {
    // Storage unavailable — the preference cannot be persisted, so there is
    // nothing useful to do here. DNT still gates the event itself.
  }
}

// ─── §3.1 Base Payload Identity fields ───────────────────────────────────────

const ANONYMOUS_ID_KEY = 'bridgelet_anonymous_id';

/**
 * Generates a cryptographically-random UUID v4.
 * Falls back to a Math.random-based UUID when `crypto.randomUUID` is
 * unavailable (very old browsers, some SSR contexts).
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC-4122 §4.4 v4 UUID, fallback.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the persistent `anonymous_id` for this browser.
 * Generated once and stored in `localStorage`; survives browser restarts.
 * Returns an empty string in SSR or when storage is unavailable.
 */
export function getAnonymousId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage blocked (private mode strict setting, quota exceeded, etc.)
    return '';
  }
}

/**
 * Returns the session-scoped `session_id` for this browser visit
 * (`docs/analytics-spec.md` §9.3): minted on first use, rotated after
 * 30 minutes of inactivity, persisted in `sessionStorage`. Delegates to
 * `lib/analytics-session.ts` (#633/#846) so the inactivity rule has one
 * owner and its own tests. Empty string in SSR or when storage is
 * unavailable (unchanged contract).
 */
export function getSessionId(): string {
  return getSessionIdWithInactivity(generateUUID);
}

// ─── §6 Error taxonomy ────────────────────────────────────────────────────────

/**
 * All eight §6 `error_type` values, exported so every `Error Displayed`
 * emitter uses the exact spec string rather than an ad-hoc literal.
 */
export const ERROR_TYPES = {
  invalid_token: 'invalid_token',
  expired_token: 'expired_token',
  already_claimed: 'already_claimed',
  invalid_wallet_address: 'invalid_wallet_address',
  transaction_failed: 'transaction_failed',
  network_unavailable: 'network_unavailable',
  wallet_connection_failed: 'wallet_connection_failed',
  unknown: 'unknown',
} as const;

export type ErrorType = keyof typeof ERROR_TYPES;

// ─── §9.5 Do Not Track ─────────────────────────────────────────────────────────

/**
 * Interprets a single Do Not Track signal. §9.5 names `1` as the opt-in
 * value; browsers report `navigator.doNotTrack` and legacy IE's
 * `navigator.msDoNotTrack` as the strings `"1"` / `"0"`, or `null` when the
 * user expressed no preference. A numeric `1` is also accepted because a
 * few privacy extensions assign a number rather than a string. Everything
 * else — `"0"`, `"unspecified"`, `""`, `null`, non-string junk — means the
 * user did not opt out, so the event is allowed.
 */
function isDntSignalEnabled(value: unknown): boolean {
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.trim() === '1';
  return false;
}

/**
 * Browser-level Do Not Track opt-out (`docs/analytics-spec.md` §9.5).
 *
 * When the browser reports `DNT: 1` the event is suppressed entirely — not
 * reduced, not anonymised further, just dropped. This matters most in the
 * recipient flow, where someone opening a claim link may have no prior
 * relationship with Bridgelet and never asked to be measured.
 *
 * Sources are checked in order: `navigator.doNotTrack` (the standard),
 * `navigator.msDoNotTrack` (legacy IE), and `window.doNotTrack` (a handful
 * of extensions set it there rather than on `navigator`). Every read is
 * feature-detected and wrapped in try/catch: these are vendor-prefixed
 * properties on objects that can be frozen, proxied or simply absent, and a
 * throw here must never break the page. A throw is reported as "not opted
 * out", which is the layer's pre-#635 behaviour.
 *
 * This function deliberately touches no storage. `track()` calls it *before*
 * `getAnonymousId()` / `getSessionId()` so that a visitor who opted out
 * never has a UUID minted and persisted on their behalf — writing an
 * identifier to `localStorage` is itself a durable tracking artefact, so
 * checking later would be too late.
 *
 * @returns `true` when the browser asks not to be tracked; `false` during
 * SSR, where there is no browser to ask.
 */
export function isDoNotTrackEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const nav: (Navigator & { msDoNotTrack?: unknown }) | undefined =
      typeof navigator === 'undefined' ? undefined : navigator;
    return (
      isDntSignalEnabled(nav?.doNotTrack) ||
      isDntSignalEnabled(nav?.msDoNotTrack) ||
      isDntSignalEnabled((window as unknown as { doNotTrack?: unknown }).doNotTrack)
    );
  } catch {
    // Vendor-prefixed property access threw (frozen/proxied navigator).
    return false;
  }
}

// ─── §9.4 Event deduplication ──────────────────────────────────────────────────

/**
 * The only two events §9.4 requires to be idempotent on `claim_id`:
 * `Payment Created` (sender) and `Claim Succeeded` (recipient). Every other
 * event is deliberately left un-deduplicated — a second `Page Viewed` in the
 * same tick, or a recipient copying the claim link twice, are distinct real
 * interactions that must all be counted.
 *
 * **The double-click case is not covered here.** The originating issue also
 * asks about `Payment Confirmed` firing twice when a sender double-clicks
 * "Confirm & Send". That event carries no `claim_id`: it fires *before* the
 * ephemeral account exists, so there is nothing stable to key on, and a
 * generic "same event twice within N ms" rule would silently swallow
 * legitimate repeats (two `Page Viewed` events in one tick, a user
 * retrying a copy). That guard belongs in the UI — `ConfirmStep` already
 * disables its button via `submitting` — so this layer leaves
 * `Payment Confirmed` un-deduplicated and the gap is recorded as a UI one.
 */
export const DEDUPLICATED_EVENTS = ['Payment Created', 'Claim Succeeded'] as const;

export type DeduplicatedEvent = (typeof DEDUPLICATED_EVENTS)[number];

/** Narrows an event name to the two §9.4 deduplication candidates. */
function isDeduplicatedEvent(event: ClaimEvent): event is DeduplicatedEvent {
  return (DEDUPLICATED_EVENTS as readonly ClaimEvent[]).includes(event);
}

/**
 * Upper bound on retained dedup keys. The store is a per-tab in-memory Map
 * in a long-lived SPA, so an unbounded Set would leak for the life of the
 * tab. 200 keys is several orders of magnitude more than any realistic
 * burst (a sender session creates a handful of claims) and costs a few tens
 * of kilobytes in the worst case, so the cap should never be the thing that
 * lets a duplicate through in practice.
 */
export const DEDUP_MAX_ENTRIES = 200;

/**
 * How long a `claim_id` counts as "already sent" for a §9.4 event. A
 * duplicate always arrives within a render cycle or a network retry — both
 * are seconds — so one hour is generous, while short enough that the Map
 * reclaims its entries during normal use. The TTL is a safety valve against
 * over-suppression (a genuinely distinct second `Claim Succeeded` for a
 * partially-swept claim), not the primary mechanism.
 */
export const DEDUP_TTL_MS = 60 * 60 * 1000;

/**
 * Bounded, self-expiring key store. Expiry is evaluated lazily on access
 * rather than on a timer, so an analytics helper never schedules background
 * work in the page.
 */
export interface DeduplicationStore {
  /** `true` when `key` was already recorded within the TTL window. */
  isDuplicate(key: string, now?: number): boolean;
  /** Keys currently retained. Exposed for diagnostics and tests. */
  size(): number;
}

/**
 * Creates a bounded LRU + TTL store for deduplicating analytics events.
 *
 * Eviction policy: entries expire after `ttlMs`; survivors beyond
 * `maxEntries` are evicted least-recently-used (a hit refreshes recency).
 * The Map is the bound — there is no persistent backing store.
 */
export function createDeduplicationStore(
  maxEntries: number = DEDUP_MAX_ENTRIES,
  ttlMs: number = DEDUP_TTL_MS,
): DeduplicationStore {
  const seen = new Map<string, number>();

  function prune(now: number): void {
    for (const [key, recordedAt] of seen) {
      if (now - recordedAt >= ttlMs) seen.delete(key);
    }
  }

  return {
    isDuplicate(key, now = Date.now()) {
      prune(now);
      if (seen.has(key)) {
        // Refresh recency so a hot claim is not evicted by the cap while
        // older idle claims are, but preserve recordedAt so TTL expiry is preserved.
        const recordedAt = seen.get(key)!;
        seen.delete(key);
        seen.set(key, recordedAt);
        return true;
      }
      seen.set(key, now);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next();
        if (oldest.done) break;
        seen.delete(oldest.value);
      }
      return false;
    },
    size() {
      return seen.size;
    },
  };
}

/**
 * The single §9.4 store used by `track()`.
 *
 * **Honest limitations.** This reduces double-counting; it does not
 * eliminate it. Being in-memory and per-tab, it cannot see a retry that
 * arrives from a different process, in a second tab, or after a page
 * reload — the real guarantee has to come from the pipeline deduplicating on
 * the `message_id` / `claim_id` this module now attaches to every payload.
 * The store is deliberately not persisted to `localStorage`:
 * `claim_id` values identify a payment, and writing them durably would
 * create cross-session state in a layer whose contract is "no PII".
 */
const claimEventDedupStore = createDeduplicationStore();

/**
 * `true` when this §9.4 event for this `claim_id` was already dispatched
 * inside the TTL window and must therefore be dropped. Returns `false` for
 * every other event, and for a §9.4 event with no usable `claim_id` — an
 * event without a key is never deduped, because guessing would risk
 * suppressing a distinct event.
 */
function isDuplicateClaimEvent(event: ClaimEvent, claimId: unknown): boolean {
  if (!isDeduplicatedEvent(event)) return false;
  if (typeof claimId !== 'string' || claimId === '') return false;
  return claimEventDedupStore.isDuplicate(`${event}::${claimId}`);
}

/**
 * Whether this browser has opened a claim link before (§5.1
 * `is_returning_visit`).
 *
 * This is deliberately a counter of claim opens, not a set of claim ids. The
 * question Claim Conversion Rate needs answered is "is this recipient new to
 * Bridgelet, or someone who has been thinking about it for a week?", and that
 * is answerable without ever writing a claim token to storage. Storing the
 * tokens would put bearer credentials for real money in `localStorage`, which
 * `bridgelet-product-audit/checklists/localstorage-data-exposure-checklist.md`
 * exists to prevent.
 *
 * The value is therefore browser-scoped rather than per-claim: opening two
 * different claim links from one browser reports `true` on the second. That is
 * the intended trade-off and is documented in the spec.
 *
 * Bounded on purpose — a visitor who opens thousands of links would otherwise
 * grow an ever-larger integer for no extra signal.
 */
const CLAIM_OPENS_KEY = 'bridgelet_claim_opens';
const CLAIM_OPENS_CAP = 1000;

export function isReturningClaimVisitor(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(CLAIM_OPENS_KEY);
    const previous = raw == null ? 0 : Number.parseInt(raw, 10);
    const count = Number.isFinite(previous) ? Math.min(previous, CLAIM_OPENS_CAP) : 0;
    localStorage.setItem(CLAIM_OPENS_KEY, String(Math.min(count + 1, CLAIM_OPENS_CAP)));
    return count > 0;
  } catch {
    // Storage unavailable: report a first visit rather than inventing history.
    return false;
  }
}

// ─── track() ──────────────────────────────────────────────────────────────────

// ─── Provider availability queue ───────────────────────────────────────────────

/**
 * Events captured before a provider was ready, waiting to be replayed.
 *
 * `Page Viewed` and `Claim Page Opened` are page-load events, and
 * `PlausibleScript` injects the provider script with `async defer`
 * (`components/plausible-script.tsx`) — so on a cold load the provider is
 * routinely absent for the first few hundred milliseconds and those events
 * used to be dropped on the floor. Queueing them and replaying once the
 * provider appears is the pattern Plausible itself documents for exactly
 * this race.
 *
 * The queue is bounded: it is per-tab in-memory state that an analytics
 * helper must never let grow without limit, and the entries it holds are
 * the *earliest* events of a visit, which are also the least useful once
 * stale. On overflow the oldest entry is dropped, so a tab left open with
 * no provider degrades to keeping the most recent events rather than
 * growing without bound.
 */
export const PENDING_QUEUE_MAX_EVENTS = 50;

/**
 * How long to keep retrying a flush while no provider has appeared.
 *
 * Bounded on purpose: a queue that retries forever keeps a timer alive for
 * the life of the tab. 30 attempts at 500ms is 15s, comfortably longer than
 * a slow third-party script on a poor connection, and after that the events
 * are dropped rather than retained indefinitely in memory.
 */
export const PENDING_FLUSH_INTERVAL_MS = 500;
export const PENDING_FLUSH_ATTEMPTS = 30;

interface PendingEvent {
  event: ClaimEvent;
  payload: EventProps;
}

const pendingEvents: PendingEvent[] = [];
let pendingFlushAttempts = 0;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** Events waiting for a provider. Exposed for diagnostics and tests. */
export function pendingEventCount(): number {
  return pendingEvents.length;
}

/** Discards queued events. Exposed for tests and for an explicit opt-out. */
export function clearPendingEvents(): void {
  pendingEvents.length = 0;
  if (pendingFlushTimer !== null) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  pendingFlushAttempts = 0;
}

function queuePendingEvent(event: ClaimEvent, payload: EventProps): void {
  pendingEvents.push({ event, payload });
  while (pendingEvents.length > PENDING_QUEUE_MAX_EVENTS) {
    pendingEvents.shift();
  }
  schedulePendingFlush();
}

function schedulePendingFlush(): void {
  if (pendingFlushTimer !== null) return;
  if (pendingFlushAttempts >= PENDING_FLUSH_ATTEMPTS) return;
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    flushPendingEvents();
  }, PENDING_FLUSH_INTERVAL_MS);
}

/**
 * Replays queued events through Plausible, if it has become available.
 *
 * Returns `true` when the queue was drained. Stops at the first failure so
 * ordering is preserved and a provider that throws mid-replay cannot cause
 * the remaining events to be silently reordered.
 */
function flushPendingEvents(): boolean {
  if (typeof window === 'undefined') return false;
  const plausible = window.plausible;
  if (typeof plausible !== 'function' || pendingEvents.length === 0) return false;

  while (pendingEvents.length > 0) {
    const next = pendingEvents[0] as PendingEvent;
    try {
      plausible(next.event, { props: next.payload });
    } catch {
      return false;
    }
    pendingEvents.shift();
  }

  pendingFlushAttempts = 0;
  return true;
}

// ─── Payload verification (§3.1 shape check) ──────────────────────────────────

/**
 * Base-payload fields that must be present on every event, with the value
 * type §3.1 specifies. Used by the local verification mode below so a
 * malformed payload is caught at the point it is created rather than by a
 * dashboard months later.
 */
const REQUIRED_BASE_FIELDS: Record<string, 'string' | 'number' | 'boolean'> = {
  journey: 'string',
  timestamp: 'string',
  network: 'string',
  platform: 'string',
  app_version: 'string',
  user_agent: 'string',
  device_type: 'string',
  referrer: 'string',
  anonymous_id: 'string',
  session_id: 'string',
  message_id: 'string',
};

/**
 * Checks a payload against §3.1 and returns the problems found, empty when
 * the payload is well-formed. Pure: it never throws, so it is safe to call
 * from the dispatch path.
 */
export function validatePayload(payload: EventProps): string[] {
  const problems: string[] = [];

  for (const [field, expected] of Object.entries(REQUIRED_BASE_FIELDS)) {
    const value = payload[field];
    if (value === undefined) {
      problems.push(`missing §3.1 field "${field}"`);
      continue;
    }
    // `referrer` is legitimately `null` when there is no referring page,
    // which the spec documents as its own value rather than an absence.
    if (field === 'referrer' && value === null) continue;
    if (typeof value !== expected) {
      problems.push(`field "${field}" should be ${expected}, got ${typeof value}`);
    }
  }

  const timestamp = payload['timestamp'];
  if (typeof timestamp === 'string' && Number.isNaN(Date.parse(timestamp))) {
    problems.push('field "timestamp" is not an ISO 8601 date string');
  }
  if (!Object.values(JOURNEYS).includes(payload['journey'] as Journey)) {
    problems.push(`field "journey" is not one of ${Object.values(JOURNEYS).join(' | ')}`);
  }
  if (!Object.values(ANALYTICS_NETWORKS).includes(payload['network'] as AnalyticsNetwork)) {
    problems.push(`field "network" is not one of ${Object.values(ANALYTICS_NETWORKS).join(' | ')}`);
  }

  return problems;
}

/**
 * Local verification mode, enabled with `NEXT_PUBLIC_ANALYTICS_VERIFY=true`.
 *
 * Without it, a developer verifying instrumentation locally sees a
 * `console.debug` line and has to eyeball the payload against
 * `docs/analytics-spec.md` by hand. With it, every payload is checked
 * against the §3.1 shape on the way out and violations are reported
 * explicitly, so a missing `network` or a mistyped `journey` fails loudly in
 * the browser instead of quietly skewing a dashboard.
 */
export function isVerificationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS_VERIFY === 'true';
}

/**
 * Whether a provider has taken responsibility for delivery. Tracked so a
 * production build with no provider configured can say so once instead of
 * dropping every event in total silence.
 */
let warnedNoProvider = false;

// ─── track() ──────────────────────────────────────────────────────────────────

/**
 * Core dispatch function. Merges the §3.1 base payload (including the
 * `journey`, `timestamp` and `network` dimensions) plus the identity fields
 * (`anonymous_id`, `session_id`) into every event payload so every
 * downstream event carries them without any per-call plumbing.
 *
 * This is the only place an event reaches a provider, so the consent gate,
 * Do Not Track (§9.5) and deduplication (§9.4) are enforced here rather
 * than at call sites — no emitter can forget them.
 *
 * Dispatch targets, in priority order:
 * 1. `window.plausible` — populated by the Plausible script loaded in the
 *    root layout when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is configured (§9.1).
 *    Anything queued from before the script arrived is replayed first.
 * 2. `window.posthog` — capture fallback when PostHog is wired up instead.
 * 3. An in-memory queue, replayed once a provider appears.
 * 4. Console output in development, with payload-shape verification when
 *    NEXT_PUBLIC_ANALYTICS_VERIFY is enabled.
 *
 * Emission side (§9.2): every event is client-emitted today. The four
 * "server-side preferred" events (`Payment Created`, `Claim Verified`,
 * `Claim Succeeded`, `Claim Failed`) and the `Payment Confirmed` →
 * `Payment Signed` rename are planned — with the client-context
 * (session_id/device_type) contract — in
 * `docs/analytics-server-vs-client-decision.md` (#845). Nothing moves until
 * the SDK owns emission; do not dual-emit.
 */
function track<E extends ClaimEvent>(event: E, props: EventPayloadMap[E]): void {
  if (typeof window === 'undefined') return;

  // Consent gate — before anything else, and before the §9.5 DNT check,
  // because an explicit on-site opt-out is a more specific statement of
  // intent than a browser-level header that predates this visit.
  if (isAnalyticsOptedOut()) return;

  // #635 (§9.5) — second, still before any payload is built.
  // `getAnonymousId()` and `getSessionId()` below *persist* a UUID to
  // localStorage/sessionStorage; minting one for a visitor who asked not to
  // be tracked would itself be a privacy violation, so suppression has to
  // happen before identifier generation, not just before the provider call.
  if (isDoNotTrackEnabled()) return;

  // Narrow at the call boundary only; inside, the payload is the open §3.1
  // record that gets merged with the base payload (#854).
  const eventProps = props as EventProps;

  // #634 (§9.4) — third, so a suppressed duplicate also avoids burning a
  // `message_id`.
  if (isDuplicateClaimEvent(event, eventProps.claim_id)) return;

  // §3.1 `journey` is resolved from the emitter's props so it is populated
  // centrally rather than trusted as a free-form string, then the emitter's
  // own value is applied on top — same value, but the base payload is never
  // missing the field.
  const journey = normalizeJourney(eventProps.journey);

  // Base payload is merged in first so event-specific props can override.
  const payload: EventProps = {
    ...buildBasePayload(journey),
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
    ...eventProps,
    journey,
    // §9.4: a per-event UUID for the analytics pipeline to deduplicate on.
    // Applied after `...props` so no call site can override or blank it.
    message_id: generateUUID(),
  };

  if (isVerificationEnabled()) {
    const problems = validatePayload(payload);
    if (problems.length > 0) {
      console.warn(
        `[analytics] payload for "${event}" does not match docs/analytics-spec.md §3.1:`,
        problems,
      );
    }
  }

  // Plausible custom event API. Flushing first means an event queued
  // during page load is delivered before the event being tracked now, which
  // keeps funnel ordering intact.
  const plausible = window.plausible;
  if (typeof plausible === 'function') {
    flushPendingEvents();
    plausible(event, { props: payload });
    return;
  }

  // PostHog capture fallback (§9.1 self-hosted option).
  const posthog = window.posthog;
  if (typeof posthog?.capture === 'function') {
    clearPendingEvents();
    posthog.capture(event, payload);
    return;
  }

  // No provider yet. Queue rather than drop: page-load events routinely
  // race the third-party script, and `Page Viewed` is the first entry in
  // the Sender Activation Funnel (§7.1).
  queuePendingEvent(event, payload);

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[analytics]', event, payload);
    return;
  }

  if (!warnedNoProvider) {
    warnedNoProvider = true;
    console.warn(
      '[analytics] no analytics provider is configured, so events are buffered in memory and discarded. Set NEXT_PUBLIC_PLAUSIBLE_DOMAIN (§9.1).',
    );
  }
}

export type ShareMethod = 'sms' | 'email' | 'whatsapp' | 'qr_code';

export type EntrySource = 'direct' | 'referral' | 'shared_link' | 'unknown';

/**
 * How a recipient arrived at the claim link (§5.1 `entry_channel`).
 *
 * `qr_scan` is a mobile-only entry path and `deep_link` distinguishes an
 * opened app-link from a pasted URL; both are separate acquisition channels
 * for §8.2's Recipient Entry Channel Distribution, so neither can be folded
 * into `direct`.
 */
export type ClaimEntryChannel =
  | 'sms'
  | 'email'
  | 'whatsapp'
  | 'qr_scan'
  | 'deep_link'
  | 'direct'
  | 'unknown';

export const CLAIM_ENTRY_CHANNELS: readonly ClaimEntryChannel[] = [
  'sms',
  'email',
  'whatsapp',
  'qr_scan',
  'deep_link',
  'direct',
  'unknown',
];

export type PaymentClaimStatus = 'unclaimed' | 'claimed' | 'expired';

/**
 * Conditional payload properties (`docs/analytics-spec.md` §3.2) are
 * included only on the events where they are relevant. Each helper below
 * returns the exact property key the spec expects, so event handlers can
 * spread the fields they need without re-typing the snake_case names.
 */

/**
 * Allowed `expiry_days` windows: `1`, `3`, `7`, `30`, `90`, or `null`
 * (never).
 *
 * `3` is not in the original spec list, but it is a real product option:
 * `expiry-step.tsx` offers 24h / 72h / 168h, so a sender choosing the middle
 * option produced `expiry_days: 3` — a value the old list declared invalid.
 * Rather than round a real choice into a different one, the vocabulary now
 * admits it. See `expiryDaysFromHours` below, which is the only sanctioned
 * way to produce this field.
 */
export const VALID_EXPIRY_WINDOWS = [1, 3, 7, 30, 90] as const;

export type ExpiryDays = (typeof VALID_EXPIRY_WINDOWS)[number] | null;

const HOURS_PER_DAY = 24;

/**
 * Converts the send form's expiry choice (in hours) into the §3.2
 * `expiry_days` value.
 *
 * Previously each call site did `expiresInHours / 24` itself, which could
 * produce a fractional or off-list value and let different call sites round
 * the same choice differently. This rounds once, snaps to a value the spec
 * admits, and returns `null` for "never" (a zero or negative window) — the
 * spec documents `null` as its own value rather than an omission.
 */
export function expiryDaysFromHours(expiresInHours: number | null | undefined): ExpiryDays {
  if (expiresInHours == null) return null;
  if (expiresInHours <= 0) return null; // "never expires"
  const days = Math.max(1, Math.round(expiresInHours / HOURS_PER_DAY));
  return VALID_EXPIRY_WINDOWS.reduce((best, window) =>
    Math.abs(window - days) < Math.abs(best - days) ? window : best,
  );
}

/**
 * §4.3 `wallet_provider` vocabulary.
 *
 * A closed set, so a dashboard can group by provider without a normalisation
 * pass. `generated` covers a wallet Bridgelet provisions on the user's behalf
 * rather than one they connected; `unknown` is the honest value when the
 * failure happened before the provider could be identified.
 */
export const WALLET_PROVIDERS = {
  freighter: 'freighter',
  lobstr: 'lobstr',
  generated: 'generated',
  unknown: 'unknown',
} as const;

export type WalletProvider = (typeof WALLET_PROVIDERS)[keyof typeof WALLET_PROVIDERS];

/**
 * Maps the sender flow's error codes onto the §6 `error_type` taxonomy.
 *
 * The send flow classifies failures into three overlapping code vocabularies
 * — `AccountCreationErrorCode` (`lib/account-errors.ts`), `FundingError.code`
 * (`lib/fund-ephemeral-account.ts`) and `FreighterSenderSigningError.code`
 * (`lib/freighter-sender-signing.ts`) — and before this mapping existed none
 * of them reached a dashboard. The sender's largest error surface, a failed
 * confirm-and-send, emitted no `Error Displayed` at all, leaving §8.2's
 * failure-rate KPIs unmeasurable on the sender side.
 *
 * Keyed by raw code string rather than by importing those enums, so this
 * module keeps no dependency on the SDK client. Anything unrecognised falls
 * back to `unknown`, which is what §6 defines that value as.
 */
export const SENDER_ERROR_TYPE_BY_CODE: Readonly<Record<string, ErrorType>> = {
  // AccountCreationErrorCode
  NETWORK_FAILURE: ERROR_TYPES.network_unavailable,
  SERVER_ERROR: ERROR_TYPES.network_unavailable,
  RATE_LIMITED: ERROR_TYPES.network_unavailable,
  STELLAR_CREATION_FAILURE: ERROR_TYPES.transaction_failed,
  INSUFFICIENT_FUNDS: ERROR_TYPES.transaction_failed,
  UNAUTHORIZED: ERROR_TYPES.wallet_connection_failed,
  INVALID_REQUEST: ERROR_TYPES.unknown,
  UNKNOWN_ERROR: ERROR_TYPES.unknown,
  // FundingError.code
  UNSUPPORTED_ASSET: ERROR_TYPES.transaction_failed,
  MISSING_TRUSTLINE: ERROR_TYPES.transaction_failed,
  INSUFFICIENT_BALANCE: ERROR_TYPES.transaction_failed,
  SUBMIT_FAILED: ERROR_TYPES.transaction_failed,
  // FreighterSenderSigningError.code
  USER_REJECTED: ERROR_TYPES.wallet_connection_failed,
  SIGNER_MISMATCH: ERROR_TYPES.wallet_connection_failed,
  SIGNING_FAILED: ERROR_TYPES.unknown,
};

/** Resolves a sender-flow error code to its §6 `error_type`. */
export function senderErrorType(code: string | undefined): ErrorType {
  if (!code) return ERROR_TYPES.unknown;
  return SENDER_ERROR_TYPE_BY_CODE[code] ?? ERROR_TYPES.unknown;
}

/** §4.2 `first_field` values for `Send Form Started` / `Send Form Field Changed`. */
export const SEND_FORM_FIELDS = {
  amount: 'amount',
  asset: 'asset',
  recipient_name: 'recipient_name',
  message: 'message',
  expiration: 'expiration',
} as const;

export type SendFormField = (typeof SEND_FORM_FIELDS)[keyof typeof SEND_FORM_FIELDS];

/**
 * Normalises an asset identifier to the §3.2 `asset_type` form (`"XLM"`,
 * `"USDC"`, …) so the Asset Distribution metric (§8.2) never splits one
 * asset across several spellings. Accepts the backend's `"native"` /
 * `"CODE:ISSUER"` identifiers (§5.1 mapping) as well as bare codes.
 * Returns `undefined` for empty input so callers can omit the property.
 */
export function normalizeAssetType(asset: string | null | undefined): string | undefined {
  if (typeof asset !== 'string') return undefined;
  const code = (asset.split(':')[0] ?? '').trim();
  if (code === '') return undefined;
  return code.toLowerCase() === 'native' ? 'XLM' : code.toUpperCase();
}

/** Assets treated as pegged 1:1 to USD for `amount_usd_equiv`. */
const USD_PEGGED_ASSETS: readonly string[] = ['USDC'];

/**
 * USD equivalent of an amount at the time of the event (§3.2
 * `amount_usd_equiv`), rounded to cents.
 *
 * - USD-pegged assets (USDC) convert 1:1 and need no rate.
 * - XLM converts at `xlmUsdRate` (see `getXlmUsdRate()` in `lib/xlm-price`).
 * - Anything else, a missing/zero rate, or an unparseable or negative
 *   amount returns `undefined` — the property is "(if available)", and
 *   emitting a guessed `0` would silently corrupt volume KPIs.
 */
export function toAmountUsdEquiv(
  amount: number | string | null | undefined,
  assetType: string | null | undefined,
  xlmUsdRate?: number | null,
): number | undefined {
  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;

  const asset = normalizeAssetType(assetType);
  let usd: number;
  if (asset && USD_PEGGED_ASSETS.includes(asset)) {
    usd = value;
  } else if (asset === 'XLM' && typeof xlmUsdRate === 'number' && xlmUsdRate > 0) {
    usd = value * xlmUsdRate;
  } else {
    return undefined;
  }
  return Math.round(usd * 100) / 100;
}

/**
 * Spreads the asset-related §3.2 properties (`asset_type`,
 * `amount_usd_equiv`) for an event, omitting each one that is unavailable.
 */
function assetProps(assetType?: string | null, usdEquiv?: number | null): EventProps {
  const asset = normalizeAssetType(assetType);
  return {
    ...(asset ? { asset_type: asset } : {}),
    ...(typeof usdEquiv === 'number' && Number.isFinite(usdEquiv)
      ? { amount_usd_equiv: usdEquiv }
      : {}),
  };
}
export const conditional = {
  // Return types are inferred rather than annotated as EventProps. Spreading an
  // index-signature type into an object literal erases the known keys from the
  // literal's inferred type, which defeats the per-event payload map (#854).
  // #936's normalizeAssetType() is applied inside assetType so the emitted
  // `asset_type` is the canonical code rather than the raw token.
  claimId: (claimId: string) => ({ claim_id: claimId }),
  assetType: (assetType: string) => ({
    asset_type: normalizeAssetType(assetType) ?? assetType,
  }),
  amountUsdEquiv: (amountUsdEquiv: number) => ({
    amount_usd_equiv: amountUsdEquiv,
  }),
  expiryDays: (expiryDays: ExpiryDays | number) => ({ expiry_days: expiryDays }),
  errorType: <T extends ErrorType | string>(errorType: T) => ({ error_type: errorType }),
  errorCode: (errorCode: string) => ({ error_code: errorCode }),
};

export type SendFormFieldName =
  | 'amount'
  | 'asset'
  | 'expiration'
  | 'recipient_name'
  | 'message';

export interface SendFormFieldChangedProps {
  fieldName: SendFormFieldName;
  assetType?: string;
  expiryDays?: ExpiryDays | number;
}

interface ClaimVerifiedProps {
  claimId: string;
  assetType?: string;
  /** §3.2 `amount_usd_equiv`; see `toAmountUsdEquiv()`. Omitted when unknown. */
  amountUsdEquiv?: number;
  expiryDaysRemaining?: number;
  verificationTimeMs: number;
}

interface ClaimCtaClickedProps {
  claimId: string;
  assetType?: string;
  /** §3.2 `amount_usd_equiv`; see `toAmountUsdEquiv()`. Omitted when unknown. */
  amountUsdEquiv?: number;
}

interface ErrorDisplayedProps {
  journey: Journey;
  /** Claim ID if available; omitted otherwise. */
  claimId?: string | null;
  errorType: ErrorType;
  /** Machine-readable error identifier; defaults to 'unknown'. */
  errorCode?: string;
  /** Screen where the error appeared. */
  sourceScreen: string;
}

interface RetryClickedProps {
  journey: Journey;
  /** Claim ID if available; omitted otherwise. */
  claimId?: string | null;
  /** Error type that triggered the retry prompt. */
  errorType: ErrorType;
  /** §3.2 `error_code` for the error being retried; defaults to `unknown`. */
  errorCode?: string;
  /** Which retry attempt this is (1-based). */
  attemptNumber: number;
}

/**
 * §5.3 `Claim Failed` error type taxonomy.
 * Matches the spec-defined values exactly.
 */
export type ClaimFailedErrorType =
  | 'network_error'
  | 'token_expired'
  | 'already_claimed'
  | 'transaction_failed'
  | 'unknown';

/** All valid §5.3 Claim Failed error_type values. */
export const CLAIM_FAILED_ERROR_TYPES: Record<ClaimFailedErrorType, ClaimFailedErrorType> = {
  network_error: 'network_error',
  token_expired: 'token_expired',
  already_claimed: 'already_claimed',
  transaction_failed: 'transaction_failed',
  unknown: 'unknown',
} as const;

interface ClaimFailedProps {
  claimId: string;
  assetType?: string;
  /** §3.2 `amount_usd_equiv`; see `toAmountUsdEquiv()`. Omitted when unknown. */
  amountUsdEquiv?: number;
  /** Stellar error code or 'unknown'. */
  errorCode?: string;
  /** §5.3 error_type taxonomy value. */
  errorType: ClaimFailedErrorType;
  /** How many times the recipient has tried on this claim. */
  attemptNumber: number;
}

interface ClaimSuccessViewedProps {
  claimId: string;
  assetType?: string;
  /** §3.2 `amount_usd_equiv`; see `toAmountUsdEquiv()`. Omitted when unknown. */
  amountUsdEquiv?: number;
}

interface SenderSignupCtaClickedProps {
  claimId: string;
}

/** §5.4/§6 source_screen values for Explorer Link Clicked. */
export type ExplorerSourceScreen = 'claim_success' | 'payment_details';

/**
 * Which block explorer the link pointed at (§5.4 `explorer`).
 *
 * The explorer differs by network, so the value is recorded rather than
 * inferred by whoever reads the report later.
 */
export const EXPLORERS = {
  stellar_expert: 'stellar_expert',
} as const;

export type Explorer = (typeof EXPLORERS)[keyof typeof EXPLORERS];

/** §2.3 journey values for Explorer Link Clicked. */
export type ExplorerJourney = Exclude<Journey, 'shared'>;

/**
 * §5.4 `explorer` values — the block explorer the clicked link opened.
 * Closed set; see `docs/analytics-spec.md` §5.4.
 */
export type ExplorerName = 'stellar_expert' | 'stellar_chain';

/** §5.4 `network` values for the explorer URL (testnet and mainnet explorers differ). */
export type ExplorerNetwork = 'testnet' | 'mainnet';

interface ExplorerLinkClickedProps {
  journey: ExplorerJourney;
  claimId: string;
  sourceScreen: ExplorerSourceScreen;
  /**
   * Which explorer the link opened. Defaults to `stellar_expert`.
   */
  explorer?: ExplorerName;
  /**
   * Transaction the link pointed at. Omitted when the frontend has no
   * transaction hash for the sweep - see 5.4 for why an absent hash is not
   * the same as a zero one, and why a claim id must never be substituted
   * for it.
   */
  txHash?: string;
  /** 5.4 `network` - the network the explorer URL targets. */
  network?: ExplorerNetwork;
}

interface WalletAddressScreenViewedProps {
  claimId: string;
  /** Whether a previously-used address was offered as a suggestion. */
  hasPreviousAddress?: boolean;
}

interface WalletAddressEnteredProps {
  claimId: string;
  /** Whether the recipient reused a previously suggested address. */
  usedPreviousAddress: boolean;
}

/** Client-side address-validation failure reasons (`docs/analytics-spec.md` §5.2). */
export type ValidationError = 'invalid_prefix' | 'invalid_length' | 'invalid_checksum';

interface WalletAddressValidationFailedProps {
  claimId?: string;
  validationError: ValidationError;
  attemptNumber: number;
}

interface ClaimSucceededProps {
  claimId: string;
  assetType?: string;
  /** §3.2 `amount_usd_equiv`; see `toAmountUsdEquiv()`. Omitted when unknown. */
  amountUsdEquiv?: number;
  /** Hours between `Payment Created` (sender) and `Claim Succeeded` (recipient). */
  timeToClaimHours?: number;
  /** Time in ms from `Claim Submitted` to on-chain confirmation. */
  sweepDurationMs?: number;
  entryChannel?: string;
}

/**
 * §4.5 `recovery_method` values for the recovery information events. Closed
 * set — see `docs/analytics-spec.md` §4.5.
 */
export type RecoveryMethod = 'reclaim_expired' | 'reclaim_cancelled' | 'self_custody_backup';

/**
 * §4.5 `copy_target` values for `Recovery Information Copied`. Records *what*
 * was copied, never its value.
 */
export type RecoveryCopyTarget = 'claim_link' | 'recovery_address' | 'wallet_secret';

interface RecoveryInformationViewedProps {
  claimId: string;
  recoveryMethod: RecoveryMethod;
}

interface RecoveryInformationCopiedProps {
  claimId: string;
  recoveryMethod: RecoveryMethod;
  copyTarget: RecoveryCopyTarget;
}

export function daysRemainingUntil(iso: string): number | undefined {
  const expiresAt = Date.parse(iso);
  if (Number.isNaN(expiresAt)) return undefined;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
}

// ─── §3.2 Per-event payload map (#854) ────────────────────────────────────────

/**
 * Exact wire payload (snake_case keys, i.e. what `track()` receives after the
 * camelCase emitter params are converted) for each `ClaimEvent`. Mirrors
 * `mobile/app/src/analytics/analytics.ts`'s `AnalyticsEvent` union.
 *
 * `journey` is optional everywhere: `track()` normalizes it centrally via
 * `normalizeJourney()`, so no emitter is required to repeat it.
 * Shapes for events with no emitter yet are taken from their §4–§6 tables;
 * the first real emitter may tighten them.
 */
type WalletProviderPath = 'freighter' | 'lobstr' | 'generated' | 'unknown';
type DashboardFilter = 'all' | 'unclaimed' | 'claimed' | 'expired';

type EventPayloadShapes = {
  'Page Viewed': { page: string; entry_source?: EntrySource; journey?: Journey };
  'Send Form Viewed': { journey?: Journey };
  'Send Form Started': { journey?: Journey; first_field: SendFormField };
  'Send Form Field Changed': { journey?: Journey; field_name: SendFormField; asset_type?: string; expiry_days?: number | null };
  'Send Form Completed': { journey?: Journey; asset_type?: string; expiry_days?: number | null; has_recipient_name: boolean; has_message: boolean };
  'Payment Confirmation Viewed': { journey?: Journey; asset_type?: string; expiry_days?: number | null };
  'Wallet Connected': { journey?: Journey; wallet_type?: string; wallet_provider: WalletProviderPath };
  'Wallet Connection Failed': { journey?: Journey; wallet_type?: string; wallet_provider?: WalletProviderPath; error_code?: string };
  'Payment Confirmed': { journey?: Journey; asset_type?: string; expiry_days?: number | null; wallet_type?: string; wallet_provider?: WalletProviderPath };
  'Payment Created': { journey?: Journey; claim_id: string; asset_type?: string; expiry_days?: number | null; confirmation_time_ms: number };
  'Payment Creation Failed': { journey?: Journey; asset_type?: string; error_code?: string };
  'Payment Success Viewed': { journey?: Journey; claim_id: string; asset_type?: string };
  'Claim Link Copied': { journey?: Journey; claim_id: string; copy_location: 'success_screen' | 'dashboard_detail' };
  'Claim Link Shared': { journey?: Journey; claim_id: string; share_method: ShareMethod };
  'Dashboard Viewed': { journey?: Journey; total_payments: number; active_filter: DashboardFilter };
  'Dashboard Filter Applied': { journey?: Journey; filter: DashboardFilter };
  'Payment Details Viewed': { journey?: Journey; claim_id: string; claim_status: PaymentClaimStatus };
  'Payment Cancelled': { journey?: Journey; claim_id: string; asset_type?: string; time_since_creation_hours: number };
  'Funds Reclaimed': { journey?: Journey; claim_id: string; asset_type?: string; reclaim_reason: 'expired' | 'cancelled'; days_expired?: number };
  'Recovery Information Viewed': { journey?: Journey; claim_id: string; recovery_method: RecoveryMethod };
  'Recovery Information Copied': { journey?: Journey; claim_id: string; recovery_method: RecoveryMethod; copy_target: RecoveryCopyTarget };
  'Claim Page Opened': { journey?: Journey; claim_id: string; entry_channel: ClaimEntryChannel; is_returning_visit?: boolean };
  'Claim Verified': { journey?: Journey; claim_id: string; asset_type?: string; expiry_days_remaining?: number; verification_time_ms: number };
  'Claim CTA Clicked': { journey?: Journey; claim_id: string; asset_type?: string };
  'Wallet Address Screen Viewed': { journey?: Journey; claim_id: string; has_previous_address: boolean };
  'Wallet Address Entered': { journey?: Journey; claim_id: string; used_previous_address: boolean };
  'Wallet Address Validation Failed': { journey?: Journey; claim_id?: string; validation_error: ValidationError; attempt_number: number };
  'Claim Confirmation Viewed': { journey?: Journey; claim_id: string; asset_type?: string };
  'Claim Submitted': { journey?: Journey; claim_id: string; asset_type?: string };
  'Claim Succeeded': { journey?: Journey; claim_id: string; asset_type?: string; time_to_claim_hours?: number; sweep_duration_ms?: number; entry_channel?: string };
  'Claim Failed': { journey?: Journey; claim_id: string; asset_type?: string; error_code?: string; error_type: ClaimFailedErrorType; attempt_number: number };
  'Claim Success Viewed': { journey?: Journey; claim_id: string; asset_type?: string };
  'Sender Signup CTA Clicked': { journey?: Journey; claim_id: string; source: 'claim_success_screen' };
  'Explorer Link Clicked': { journey?: ExplorerJourney; claim_id: string; source_screen: ExplorerSourceScreen; tx_hash?: string; explorer?: ExplorerName; network?: ExplorerNetwork };
  'Error Displayed': { journey?: Journey; claim_id?: string | null; error_type: ErrorType; error_code?: string; source_screen: string };
  'Retry Clicked': { journey?: Journey; claim_id?: string | null; error_type: ErrorType; attempt_number: number };
};

/**
 * `ClaimEvent` → payload, enforced in both directions by construction:
 *  - a `ClaimEvent` with no shape above maps to `never` (every payload for it
 *    is a compile error until the shape is written);
 *  - a shape key that is not a `ClaimEvent` (typo) collapses the whole map to
 *    `{ [E in ClaimEvent]: never }`, so *every* `track()` call fails.
 * The `type ClaimEvent` union above stays the single source of truth (CI's
 * analytics-spec-diff.yml parses it textually).
 */
type EventPayloadMap = [Exclude<keyof EventPayloadShapes, ClaimEvent>] extends [never]
  ? { [E in ClaimEvent]: E extends keyof EventPayloadShapes ? EventPayloadShapes[E] : never }
  : { [E in ClaimEvent]: never };

// ─── Public analytics surface ─────────────────────────────────────────────────

export const analytics = {
  /**
   * Legacy aliases (#849) predating the spec-aligned methods further down
   * (`claimPageOpened`, `claimCtaClicked`, `claimSucceeded`, `claimFailed`),
   * which are what the claim page, claim status card, send flow and error
   * boundaries actually call. These emit the same Title Case §5 events, so
   * nothing is instrumented differently; they are retained because tests
   * assert against them. New call sites should use the spec-aligned method.
   */
  claimPageViewed: ({ claimId, entryChannel }: { claimId: string; entryChannel: ClaimEntryChannel }) =>
    track('Claim Page Opened', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      entry_channel: entryChannel,
    }),
  claimInitiated: ({ claimId, assetType, amountUsdEquiv }: { claimId: string; assetType?: string; amountUsdEquiv?: number }) =>
    track('Claim CTA Clicked', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),
  claimSuccess: ({ claimId, assetType, amountUsdEquiv }: { claimId: string; assetType?: string; amountUsdEquiv?: number }) =>
    track('Claim Succeeded', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),
  claimError: ({ claimId, assetType, amountUsdEquiv, errorCode = 'unknown', errorType, attemptNumber }: ClaimFailedProps) =>
    track('Claim Failed', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
      ...conditional.errorCode(errorCode),
      ...conditional.errorType(errorType),
      attempt_number: attemptNumber,
    }),
  /**
   * §4.2 Send Form Field Changed — fires when the sender changes a field value
   * and moves focus away (blur). Not fired on every keystroke.
   */
  sendFormFieldChanged: ({
    fieldName,
    assetType,
    expiryDays,
  }: SendFormFieldChangedProps) =>
    track('Send Form Field Changed', {
      journey: 'sender',
      field_name: fieldName,
      ...(fieldName === 'asset' && assetType ? conditional.assetType(assetType) : {}),
      ...(fieldName === 'expiration' && expiryDays !== undefined
        ? conditional.expiryDays(expiryDays)
        : {}),
    }),
  sendFormCompleted: ({
    assetType,
    amountUsdEquiv,
    expiryDays,
    hasRecipientName,
    hasMessage,
  }: {
    assetType?: string;
    amountUsdEquiv?: number;
    expiryDays?: number | null;
    hasRecipientName: boolean;
    hasMessage: boolean;
  }) =>
    track('Send Form Completed', {
      journey: 'sender',
      ...assetProps(assetType, amountUsdEquiv),
      ...(expiryDays !== undefined ? conditional.expiryDays(expiryDays) : {}),
      has_recipient_name: hasRecipientName,
      has_message: hasMessage,
    }),
  /**
   * §4.2 `Send Form Started` — fires once per form view, on the sender's
   * first interaction with any field. `firstField` names that field so a
   * funnel that never completes can be attributed to where it stalled.
   */
  sendFormStarted: ({ firstField }: { firstField: SendFormField }) =>
    track('Send Form Started', {
      journey: 'sender',
      first_field: firstField,
    }),
  paymentConfirmationViewed: ({
    assetType,
    amountUsdEquiv,
    expiryDays,
  }: {
    assetType?: string;
    amountUsdEquiv?: number;
    expiryDays?: number | null;
  }) =>
    track('Payment Confirmation Viewed', {
      journey: 'sender',
      ...assetProps(assetType, amountUsdEquiv),
      ...(expiryDays !== undefined ? conditional.expiryDays(expiryDays) : {}),
    }),
  paymentConfirmed: ({
    assetType,
    amountUsdEquiv,
    expiryDays,
    walletType,
    walletProvider = WALLET_PROVIDERS.unknown,
  }: {
    assetType?: string;
    amountUsdEquiv?: number;
    expiryDays?: number | null;
    walletType?: string;
    walletProvider?: WalletProvider;
  }) =>
    track('Payment Confirmed', {
      journey: 'sender',
      ...assetProps(assetType, amountUsdEquiv),
      ...(expiryDays !== undefined ? conditional.expiryDays(expiryDays) : {}),
      ...(walletType ? { wallet_type: walletType } : {}),
      wallet_provider: walletProvider,
    }),
  /**
   * §4.3 `Wallet Connection Failed` — fires when a connection attempt fails,
   * alongside the `Error Displayed` that reports the same failure to §6.
   * The two answer different questions: `Error Displayed` says an error was
   * shown, this says a connect attempt was lost, which is what provider-level
   * connection-failure rates are computed from.
   */
  walletConnectionFailed: ({
    walletProvider = WALLET_PROVIDERS.unknown,
    errorCode = 'unknown',
  }: {
    walletProvider?: WalletProvider;
    errorCode?: string;
  } = {}) =>
    track('Wallet Connection Failed', {
      journey: 'sender',
      wallet_provider: walletProvider,
      error_code: errorCode,
    }),
  /**
   * 4.4 Payment Success Viewed - fires when the success screen with the
   * claim link is rendered, i.e. once the sender has an account created and a
   * link to share.
   */
  paymentSuccessViewed: ({
    claimId,
    assetType,
    amountUsdEquiv,
  }: {
    claimId: string;
    assetType?: string;
    amountUsdEquiv?: number;
  }) =>
    track('Payment Success Viewed', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),

  paymentCreated: ({
    claimId,
    assetType,
    amountUsdEquiv,
    expiryDays,
    confirmationTimeMs,
  }: {
    claimId: string;
    assetType?: string;
    amountUsdEquiv?: number;
    expiryDays?: number | null;
    confirmationTimeMs: number;
  }) =>
    track('Payment Created', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
      ...(expiryDays !== undefined ? conditional.expiryDays(expiryDays) : {}),
      confirmation_time_ms: confirmationTimeMs,
    }),
  /**
   * §4.4 Payment Creation Failed — fires when payment creation transaction fails.
   */
  paymentCreationFailed: ({
    errorCode = 'unknown',
    assetType,
  }: {
    errorCode?: string;
    assetType?: string;
  } = {}) =>
    track('Payment Creation Failed', {
      journey: 'sender',
      ...conditional.errorCode(errorCode),
      ...(assetType ? conditional.assetType(assetType) : {}),
    }),
  claimLinkCopied: ({
    claimId,
    copyLocation,
  }: {
    claimId: string;
    copyLocation: 'success_screen' | 'dashboard_detail';
  }) =>
    track('Claim Link Copied', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      copy_location: copyLocation,
    }),
  claimLinkShared: ({ claimId, shareMethod }: { claimId: string; shareMethod: ShareMethod }) =>
    track('Claim Link Shared', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      share_method: shareMethod,
    }),
  claimPageOpened: ({
    claimId,
    entryChannel,
    isReturningVisit,
  }: {
    claimId: string;
    entryChannel: ClaimEntryChannel;
    /**
     * Whether this browser had already opened a claim link before. Defaults to
     * the locally-observed value — see `isReturningClaimVisitor`.
     */
    isReturningVisit?: boolean;
  }) =>
    track('Claim Page Opened', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      entry_channel: entryChannel,
      is_returning_visit: isReturningVisit ?? isReturningClaimVisitor(),
    }),

  /**
   * §5.2 `Wallet Address Screen Viewed` — fires when the address-entry panel
   * is rendered, i.e. when the recipient has a claim to enter an address for.
   * The panel is the only place in the app that asks for a wallet address.
   */
  walletAddressScreenViewed: ({
    claimId,
    hasPreviousAddress = false,
  }: WalletAddressScreenViewedProps) =>
    track('Wallet Address Screen Viewed', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      has_previous_address: hasPreviousAddress,
    }),

  /**
   * §5.2 `Wallet Address Entered` — fires when the recipient submits an
   * address that passes client-side validation, i.e. at the moment the address
   * becomes the destination for the sweep.
   *
   * The address itself is never included: it is a third party's public key and
   * has no place in an analytics payload. `usedPreviousAddress` is therefore
   * always derivable from the event without carrying the value.
   */
  walletAddressEntered: ({
    claimId,
    usedPreviousAddress = false,
  }: WalletAddressEnteredProps) =>
    track('Wallet Address Entered', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      used_previous_address: usedPreviousAddress,
    }),
  paymentDetailsViewed: ({
    claimId,
    claimStatus,
  }: {
    claimId: string;
    claimStatus: PaymentClaimStatus;
  }) =>
    track('Payment Details Viewed', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      claim_status: claimStatus,
    }),
  pageViewed: ({ page, entrySource }: { page: string; entrySource?: EntrySource }) =>
    track('Page Viewed', {
      journey: 'sender',
      page,
      ...(entrySource ? { entry_source: entrySource } : {}),
    }),
  sendFormViewed: () => track('Send Form Viewed', { journey: 'sender' }),
  claimVerified: ({
    claimId,
    assetType,
    amountUsdEquiv,
    expiryDaysRemaining,
    verificationTimeMs,
  }: ClaimVerifiedProps) =>
    track('Claim Verified', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
      ...(expiryDaysRemaining != null ? { expiry_days_remaining: expiryDaysRemaining } : {}),
      verification_time_ms: verificationTimeMs,
    }),
  claimCtaClicked: ({ claimId, assetType, amountUsdEquiv }: ClaimCtaClickedProps) =>
    track('Claim CTA Clicked', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),
  errorDisplayed: ({
    journey,
    claimId,
    errorType,
    errorCode,
    sourceScreen,
  }: ErrorDisplayedProps) =>
    track('Error Displayed', {
      journey,
      ...(claimId ? conditional.claimId(claimId) : {}),
      ...conditional.errorType(errorType),
      ...conditional.errorCode(errorCode ?? 'unknown'),
      source_screen: sourceScreen,
    }),
  walletAddressValidationFailed: ({
    claimId,
    validationError,
    attemptNumber,
  }: WalletAddressValidationFailedProps) =>
    track('Wallet Address Validation Failed', {
      journey: 'recipient',
      ...(claimId ? conditional.claimId(claimId) : {}),
      validation_error: validationError,
      attempt_number: attemptNumber,
    }),
  claimConfirmationViewed: ({ claimId, assetType, amountUsdEquiv }: ClaimCtaClickedProps) =>
    track('Claim Confirmation Viewed', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),

  /**
   * §6 Retry Clicked — fires when a user clicks Try Again/Retry on an error
   * screen, recording which error prompted the retry and how many attempts
   * have been made.
   */
  retryClicked: ({
    journey,
    claimId,
    errorType,
    errorCode,
    attemptNumber,
  }: RetryClickedProps) =>
    track('Retry Clicked', {
      journey,
      ...(claimId != null ? conditional.claimId(claimId) : {}),
      ...conditional.errorType(errorType),
      ...conditional.errorCode(errorCode ?? 'unknown'),
      attempt_number: attemptNumber,
    }),

  /**
   * §5.3 Claim Failed — fires when the sweep fails after the recipient confirmed.
   * `error_type` must be one of the five §5.3 taxonomy values.
   */
  claimFailed: ({
    claimId,
    assetType,
    amountUsdEquiv,
    errorCode = 'unknown',
    errorType,
    attemptNumber,
  }: ClaimFailedProps) =>
    track('Claim Failed', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
      ...conditional.errorCode(errorCode),
      ...conditional.errorType(errorType),
      attempt_number: attemptNumber,
    }),

  /**
   * §5.4 Claim Success Viewed — fires when the post-claim success screen is displayed.
   */
  claimSuccessViewed: ({ claimId, assetType, amountUsdEquiv }: ClaimSuccessViewedProps) =>
    track('Claim Success Viewed', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),

  /**
   * §5.4 Sender Signup CTA Clicked — fires when a recipient clicks "Create your account →"
   * on the success screen, measuring viral growth potential.
   */
  senderSignupCtaClicked: ({ claimId }: SenderSignupCtaClickedProps) =>
    track('Sender Signup CTA Clicked', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      source: 'claim_success_screen',
    }),

  /**
   * §5.4/§6 Explorer Link Clicked — fires when a user (sender or recipient) clicks a
   * Stellar Explorer transaction link.
   */
  explorerLinkClicked: ({
    journey,
    claimId,
    sourceScreen,
    txHash,
    explorer = EXPLORERS.stellar_expert,
    network,
  }: ExplorerLinkClickedProps) =>
    track('Explorer Link Clicked', {
      journey,
      ...conditional.claimId(claimId),
      source_screen: sourceScreen,
      // Omitted rather than null: no hash means the frontend could not
      // attribute the click to a transaction, which is different from an
      // empty hash on a real one.
      ...(txHash ? { tx_hash: txHash } : {}),
      ...(explorer ? { explorer } : {}),
      ...(network ? { network } : {}),
    }),
  claimSubmitted: ({ claimId, assetType, amountUsdEquiv }: ClaimCtaClickedProps) =>
    track('Claim Submitted', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
    }),
  claimSucceeded: ({
    claimId,
    assetType,
    amountUsdEquiv,
    timeToClaimHours,
    sweepDurationMs,
    entryChannel = 'unknown',
  }: ClaimSucceededProps) =>
    track('Claim Succeeded', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...assetProps(assetType, amountUsdEquiv),
      ...(timeToClaimHours !== undefined ? { time_to_claim_hours: timeToClaimHours } : {}),
      ...(sweepDurationMs !== undefined ? { sweep_duration_ms: sweepDurationMs } : {}),
      entry_channel: entryChannel,
    }),

  /**
   * §4.5 Recovery Information Viewed — fires when a sender opens the surface
   * that shows their recovery information (reclaim instructions or a
   * self-custody backup). The recovery material itself is never in the payload.
   */
  recoveryInformationViewed: ({ claimId, recoveryMethod }: RecoveryInformationViewedProps) =>
    track('Recovery Information Viewed', {
      journey: 'sender',
      claim_id: claimId,
      recovery_method: recoveryMethod,
    }),

  /**
   * §4.5 Recovery Information Copied — fires when a sender copies recovery
   * information to the clipboard. `copy_target` records what was copied, never
   * its value.
   */
  recoveryInformationCopied: ({
    claimId,
    recoveryMethod,
    copyTarget,
  }: RecoveryInformationCopiedProps) =>
    track('Recovery Information Copied', {
      journey: 'sender',
      claim_id: claimId,
      recovery_method: recoveryMethod,
      copy_target: copyTarget,
    }),
};
