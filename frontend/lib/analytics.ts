// #118 – Privacy-respecting analytics events (Plausible-compatible, no PII)
// Event names must match `docs/analytics-spec.md` `#### \`Event Name\`` headings exactly.
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
  | 'Retry Clicked';

type EventProps = Record<string, string | number | boolean | null>;

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

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
 * Base payload fields (`docs/analytics-spec.md` §3.1) shared by every
 * event: `app_version`, `user_agent`, `device_type`, `referrer`, and the
 * fixed frontend `platform` value "web". Each field degrades gracefully
 * when the browser API it depends on is unavailable (SSR, unit tests
 * without a DOM).
 */
export function buildBasePayload(): EventProps {
  return {
    app_version: appVersion(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    device_type: detectDeviceType(),
    referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : null,
    platform: 'web',
  };
}

// ─── §3.1 Base Payload Identity fields ───────────────────────────────────────

const ANONYMOUS_ID_KEY = 'bridgelet_anonymous_id';
const SESSION_ID_KEY = 'bridgelet_session_id';

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
 * Returns the session-scoped `session_id` for this browser tab/visit.
 * Generated once per session and stored in `sessionStorage`; reset when
 * the tab or browser session ends.
 * Returns an empty string in SSR or when storage is unavailable.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = generateUUID();
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable.
    return '';
  }
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
        // older idle claims are.
        seen.delete(key);
        seen.set(key, now);
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

// ─── track() ──────────────────────────────────────────────────────────────────

/**
 * Core dispatch function. Merges the §3.1 identity fields (`anonymous_id`,
 * `session_id`) into every event payload so every downstream event carries
 * them without any per-call plumbing.
 *
 * This is the only place an event reaches the provider, so both opt-out
 * (§9.5) and deduplication (§9.4) are enforced here rather than at call
 * sites — no emitter can forget them.
 *
 * Dispatch targets, in priority order:
 * 1. `window.plausible` — populated by the Plausible script loaded in the
 *    root layout when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is configured (§9.1).
 * 2. `window.posthog` — capture fallback when PostHog is wired up instead.
 * 3. Console debug output in development builds.
 */
function track(event: ClaimEvent, props?: EventProps): void {
  if (typeof window === 'undefined') return;

  // #635 (§9.5) — first, before any payload is built. `getAnonymousId()`
  // and `getSessionId()` below *persist* a UUID to localStorage/
  // sessionStorage; minting one for a visitor who asked not to be tracked
  // would itself be a privacy violation, so suppression has to happen
  // before identifier generation, not just before the provider call.
  if (isDoNotTrackEnabled()) return;

  // #634 (§9.4) — second, so a suppressed duplicate also avoids burning a
  // `message_id`.
  if (isDuplicateClaimEvent(event, props?.claim_id)) return;

  // Base payload is merged in first so event-specific props can override.
  const payload: EventProps = {
    ...buildBasePayload(),
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
    ...props,
    // §9.4: a per-event UUID for the analytics pipeline to deduplicate on.
    // Applied after `...props` so no call site can override or blank it.
    message_id: generateUUID(),
  };

  // Plausible custom event API
  const plausible = (window as unknown as { plausible?: Function }).plausible;
  if (typeof plausible === 'function') {
    plausible(event, { props: payload });
    return;
  }

  // PostHog capture fallback (§9.1 self-hosted option).
  const posthog = (window as unknown as { posthog?: { capture?: Function } }).posthog;
  if (typeof posthog?.capture === 'function') {
    posthog.capture(event, payload);
    return;
  }

  // Fallback: console in development
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[analytics]', event, payload);
  }
}

/**
 * Reads the `Do Not Track` browser preference (§9.5). Accepts an explicit
 * header value for testability; checks `navigator.doNotTrack`,
 * `window.doNotTrack`, and the legacy `msDoNotTrack` prefixes.
 */
export function isDntEnabled(header?: string): boolean {
  if (header === '1') return true;
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = typeof window !== 'undefined' ? (window as unknown as { doNotTrack?: string }) : {};
  const raw = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack ?? '0';
  return raw === '1' || raw === 'yes';
}

export type ShareMethod = 'sms' | 'email' | 'whatsapp' | 'qr_code';

export type EntrySource = 'direct' | 'referral' | 'shared_link' | 'unknown';

export type ClaimEntryChannel = 'sms' | 'email' | 'whatsapp' | 'direct' | 'unknown';

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

export const conditional = {
  claimId: (claimId: string): EventProps => ({ claim_id: claimId }),
  assetType: (assetType: string): EventProps => ({ asset_type: assetType }),
  amountUsdEquiv: (amountUsdEquiv: number): EventProps => ({
    amount_usd_equiv: amountUsdEquiv,
  }),
  expiryDays: (expiryDays: ExpiryDays): EventProps => ({ expiry_days: expiryDays }),
  errorType: (errorType: ErrorType): EventProps => ({ error_type: errorType }),
  errorCode: (errorCode: string): EventProps => ({ error_code: errorCode }),
};

interface ClaimVerifiedProps {
  claimId: string;
  assetType?: string;
  expiryDaysRemaining?: number;
  verificationTimeMs: number;
}

interface ClaimCtaClickedProps {
  claimId: string;
  assetType?: string;
}

interface ErrorDisplayedProps {
  journey: 'sender' | 'recipient' | 'shared';
  /** Claim ID if available; omitted otherwise. */
  claimId?: string | null;
  errorType: ErrorType;
  /** Machine-readable error identifier; defaults to 'unknown'. */
  errorCode?: string;
  /** Screen where the error appeared. */
  sourceScreen: string;
}

interface RetryClickedProps {
  journey: 'sender' | 'recipient' | 'shared';
  /** Claim ID if available; omitted otherwise. */
  claimId?: string | null;
  /** Error type that triggered the retry prompt. */
  errorType: ErrorType;
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
}

interface SenderSignupCtaClickedProps {
  claimId: string;
}

/** §5.4/§6 source_screen values for Explorer Link Clicked. */
export type ExplorerSourceScreen = 'claim_success' | 'payment_details';

/** §2.3 journey values for Explorer Link Clicked. */
export type ExplorerJourney = 'sender' | 'recipient';

interface ExplorerLinkClickedProps {
  journey: ExplorerJourney;
  claimId: string;
  sourceScreen: ExplorerSourceScreen;
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
  /** Hours between `Payment Created` (sender) and `Claim Succeeded` (recipient). */
  timeToClaimHours?: number;
  /** Time in ms from `Claim Submitted` to on-chain confirmation. */
  sweepDurationMs?: number;
  entryChannel?: string;
}

export function daysRemainingUntil(iso: string): number | undefined {
  const expiresAt = Date.parse(iso);
  if (Number.isNaN(expiresAt)) return undefined;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
}

// ─── Public analytics surface ─────────────────────────────────────────────────

export const analytics = {
  claimPageViewed: ({ claimId, entryChannel }: { claimId: string; entryChannel: ClaimEntryChannel }) =>
    track('Claim Page Opened', {
      journey: 'recipient',
      claim_id: claimId,
      entry_channel: entryChannel,
    }),
  claimInitiated: ({ claimId, assetType }: { claimId: string; assetType?: string }) =>
    track('Claim CTA Clicked', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
    }),
  claimSuccess: ({ claimId, assetType }: { claimId: string; assetType?: string }) =>
    track('Claim Succeeded', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
    }),
  claimError: ({ claimId, assetType, errorCode = 'unknown', errorType, attemptNumber }: ClaimFailedProps) =>
    track('Claim Failed', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
      error_code: errorCode,
      error_type: errorType,
      attempt_number: attemptNumber,
    }),
  sendFormCompleted: ({
    assetType,
    expiryDays,
    amountUsdEquiv,
    hasRecipientName,
    hasMessage,
  }: {
    assetType?: string;
    expiryDays?: ExpiryDays;
    amountUsdEquiv?: number;
    hasRecipientName: boolean;
    hasMessage: boolean;
  }) =>
    track('Send Form Completed', {
      journey: 'sender',
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(expiryDays != null ? conditional.expiryDays(expiryDays) : {}),
      ...(amountUsdEquiv != null ? conditional.amountUsdEquiv(amountUsdEquiv) : {}),
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
    expiryDays,
    amountUsdEquiv,
  }: {
    assetType?: string;
    expiryDays?: ExpiryDays;
    amountUsdEquiv?: number;
  }) =>
    track('Payment Confirmation Viewed', {
      journey: 'sender',
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(expiryDays != null ? conditional.expiryDays(expiryDays) : {}),
      ...(amountUsdEquiv != null ? conditional.amountUsdEquiv(amountUsdEquiv) : {}),
    }),
  paymentConfirmed: ({
    assetType,
    expiryDays,
    amountUsdEquiv,
    walletType,
    walletProvider = WALLET_PROVIDERS.unknown,
  }: {
    assetType?: string;
    expiryDays?: ExpiryDays;
    amountUsdEquiv?: number;
    walletType?: string;
    walletProvider?: WalletProvider;
  }) =>
    track('Payment Confirmed', {
      journey: 'sender',
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(expiryDays != null ? conditional.expiryDays(expiryDays) : {}),
      ...(amountUsdEquiv != null ? conditional.amountUsdEquiv(amountUsdEquiv) : {}),
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
  }) =>
    track('Wallet Connection Failed', {
      journey: 'sender',
      wallet_provider: walletProvider,
      error_code: errorCode,
    }),
  paymentCreated: ({
    claimId,
    assetType,
    expiryDays,
    amountUsdEquiv,
    confirmationTimeMs,
  }: {
    claimId: string;
    assetType?: string;
    expiryDays?: ExpiryDays;
    amountUsdEquiv?: number;
    confirmationTimeMs: number;
  }) =>
    track('Payment Created', {
      journey: 'sender',
      ...conditional.claimId(claimId),
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(expiryDays != null ? conditional.expiryDays(expiryDays) : {}),
      ...(amountUsdEquiv != null ? conditional.amountUsdEquiv(amountUsdEquiv) : {}),
      confirmation_time_ms: confirmationTimeMs,
    }),
  /**
   * §4.4 `Payment Success Viewed` — fires when the success screen with the
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
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(amountUsdEquiv != null ? conditional.amountUsdEquiv(amountUsdEquiv) : {}),
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
      claim_id: claimId,
      copy_location: copyLocation,
    }),
  claimLinkShared: ({ claimId, shareMethod }: { claimId: string; shareMethod: ShareMethod }) =>
    track('Claim Link Shared', {
      journey: 'sender',
      claim_id: claimId,
      share_method: shareMethod,
    }),
  claimPageOpened: ({
    claimId,
    entryChannel,
  }: {
    claimId: string;
    entryChannel: ClaimEntryChannel;
  }) =>
    track('Claim Page Opened', {
      journey: 'recipient',
      claim_id: claimId,
      entry_channel: entryChannel,
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
      claim_id: claimId,
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
    expiryDaysRemaining,
    verificationTimeMs,
  }: ClaimVerifiedProps) =>
    track('Claim Verified', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...(assetType ? conditional.assetType(assetType) : {}),
      ...(expiryDaysRemaining != null ? { expiry_days_remaining: expiryDaysRemaining } : {}),
      verification_time_ms: verificationTimeMs,
    }),
  claimCtaClicked: ({ claimId, assetType }: ClaimCtaClickedProps) =>
    track('Claim CTA Clicked', {
      journey: 'recipient',
      ...conditional.claimId(claimId),
      ...(assetType ? conditional.assetType(assetType) : {}),
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
      ...(claimId ? { claim_id: claimId } : {}),
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
      ...(claimId ? { claim_id: claimId } : {}),
      validation_error: validationError,
      attempt_number: attemptNumber,
    }),
  claimConfirmationViewed: ({ claimId, assetType }: ClaimCtaClickedProps) =>
    track('Claim Confirmation Viewed', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
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
    attemptNumber,
  }: RetryClickedProps) =>
    track('Retry Clicked', {
      journey,
      ...(claimId != null ? { claim_id: claimId } : {}),
      error_type: errorType,
      attempt_number: attemptNumber,
    }),

  /**
   * §5.3 Claim Failed — fires when the sweep fails after the recipient confirmed.
   * `error_type` must be one of the five §5.3 taxonomy values.
   */
  claimFailed: ({
    claimId,
    assetType,
    errorCode = 'unknown',
    errorType,
    attemptNumber,
  }: ClaimFailedProps) =>
    track('Claim Failed', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
      error_code: errorCode,
      error_type: errorType,
      attempt_number: attemptNumber,
    }),

  /**
   * §5.4 Claim Success Viewed — fires when the post-claim success screen is displayed.
   */
  claimSuccessViewed: ({ claimId, assetType }: ClaimSuccessViewedProps) =>
    track('Claim Success Viewed', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
    }),

  /**
   * §5.4 Sender Signup CTA Clicked — fires when a recipient clicks "Create your account →"
   * on the success screen, measuring viral growth potential.
   */
  senderSignupCtaClicked: ({ claimId }: SenderSignupCtaClickedProps) =>
    track('Sender Signup CTA Clicked', {
      journey: 'recipient',
      claim_id: claimId,
      source: 'claim_success_screen',
    }),

  /**
   * §5.4/§6 Explorer Link Clicked — fires when a user (sender or recipient) clicks a
   * Stellar Explorer transaction link.
   */
  explorerLinkClicked: ({ journey, claimId, sourceScreen }: ExplorerLinkClickedProps) =>
    track('Explorer Link Clicked', {
      journey,
      claim_id: claimId,
      source_screen: sourceScreen,
    }),
  claimSubmitted: ({ claimId, assetType }: ClaimCtaClickedProps) =>
    track('Claim Submitted', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
    }),
  claimSucceeded: ({
    claimId,
    assetType,
    timeToClaimHours,
    sweepDurationMs,
    entryChannel = 'unknown',
  }: ClaimSucceededProps) =>
    track('Claim Succeeded', {
      journey: 'recipient',
      claim_id: claimId,
      ...(assetType ? { asset_type: assetType } : {}),
      ...(timeToClaimHours !== undefined ? { time_to_claim_hours: timeToClaimHours } : {}),
      ...(sweepDurationMs !== undefined ? { sweep_duration_ms: sweepDurationMs } : {}),
      entry_channel: entryChannel,
    }),
};
