# Analytics KPI Query Definitions

> Companion to `analytics-spec.md` §7.3 and §8.1.
> Closes the "defined in the spec but undefined in practice" gap for the
> core KPI formulas. Each KPI below states the exact events, join keys, and
> query that will compute it **once its constituent events fire**.

## Readiness gate

None of these query definitions may be reported anywhere until both:

1. every constituent event fires from production app code (see per-event
   issues tracked by the per-journey funnel trackers), and
2. the query below has been run against a real event export and its shape
   verified (the `analytics-spec-vs-implementation-unverified` postmortem
   requirement: events exist, a query implements the formula, they agree).

While any constituent event is unimplemented, the corresponding KPI row in
the table below stays `blocked`; a dashboard claiming these numbers would be
showing zeros or stale data.

Status markers: `⬜ blocked` — a constituent event does not fire from
production code yet, so the formula has no inputs. `⏳ unverified` — every
constituent event does fire, but the query below has never been run against a
real event export, so readiness gate 2 is still open and the number may not be
reported anywhere yet. Neither marker means "ready".

| KPI | Spec | Formula | Constituent events | Status |
|-----|------|---------|--------------------|--------|
| Claim Conversion Rate (CCR) | §8.1 | `Claim Succeeded ÷ Claim Verified × 100` | `Claim Verified`, `Claim Succeeded` (both wired) | ⬜ blocked on `Claim Succeeded` |
| Time to Claim (TTC) | §8.1 | `median(Claim Succeeded.timestamp − Payment Created.timestamp)` matched on `claim_id` | `Payment Created`, `Claim Succeeded` (both wired) | ⏳ unverified |
| Expiry Rate | §8.1 | `payments status "expired" with no Claim Succeeded ÷ Payment Created × 100` | `Payment Created`, `Claim Succeeded` (both wired), payment records | ⏳ unverified |
| End-to-end conversion (§7.3) | §7.3 | `Claim Succeeded ÷ Page Viewed (homepage) × 100` | `Page Viewed`, `Claim Succeeded` (both wired) | ⏳ unverified |
| Claim Failure Rate | §8.2 | `Claim Failed ÷ Claim Submitted × 100` | `Claim Submitted`, `Claim Failed` (both implemented) | ⏳ unverified — query written, export check outstanding |
| Asset Distribution | §8.2 | `count(Payment Created) grouped by asset_type ÷ total Payment Created × 100` | `Payment Created` (implemented) | ⏳ unverified — query written, export check outstanding |
| Reclaim Rate | §8.1 | `Funds Reclaimed ÷ expired payments × 100` | `Funds Reclaimed` | ⬜ blocked — no reclaim UI exists |
| Sender Activation Rate | §8.1 | `Payment Created ÷ Page Viewed (homepage) × 100` | `Page Viewed`, `Payment Created` | ⏳ unverified — query written, export check outstanding |
| Share Method Distribution | §8.2 | `count(Claim Link Shared) grouped by share_method ÷ total Claim Link Shared × 100` | `Claim Link Shared` (fires; only `whatsapp` emitted) | ⏳ unverified — see channel-coverage note |
| Recipient Entry Channel Distribution | §8.2 | `count(Claim Page Opened) grouped by entry_channel ÷ total Claim Page Opened × 100` | `Claim Page Opened` | ⏳ unverified — query written, export check outstanding |
| Viral K-Factor | §8.2 | `Sender Signup CTA Clicked ÷ distinct claim_id that reached Claim Success Viewed` | `Claim Success Viewed`, `Sender Signup CTA Clicked` | ⏳ unverified — query written, export check outstanding |
| Wallet Address Validation Failure Rate | §8.2 | `Wallet Address Validation Failed ÷ Wallet Address Entered × 100` | `Wallet Address Entered`, `Wallet Address Validation Failed` | ⬜ blocked on `Wallet Address Entered` |

---

## CCR — Claim Conversion Rate

**Formula (§8.1):** `(Claim Succeeded events) / (Claim Verified events) × 100`

**Query shape (post-export, event-level):**

```sql
SELECT
  (SELECT count(*) FROM events WHERE name = 'Claim Succeeded') AS numerators,
  (SELECT count(*) FROM events WHERE name = 'Claim Verified')  AS denominators,
  ROUND(
    ((SELECT count(*) FROM events WHERE name = 'Claim Succeeded')::numeric
      / NULLIF((SELECT count(*) FROM events WHERE name = 'Claim Verified'), 0)) * 100,
    2
  ) AS ccr_percent
```

**Notes:** Both events carry `claim_id`; deduplicate repeated `Claim Verified`
emissions of the same `claim_id` per session before counting denominators
(§5.1 treats repeated opens as a single claim attempt for conversion
purposes). Report per-channel and per `days_remaining` band where useful.

## TTC — Time to Claim

**Formula (§8.1):** `median(Claim Succeeded.timestamp − Payment Created.timestamp)`
for all matched `claim_id` pairs.

**Query shape:**

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ttc_days) AS median_ttc_days
FROM (
  SELECT
    (s.timestamp - c.timestamp) AS ttc_days
  FROM events s
  JOIN events c ON c.name = 'Payment Created' AND c.props->>'claim_id' = s.props->>'claim_id'
  WHERE s.name = 'Claim Succeeded'
) t
```

**Requirement ahead of this query:** both events must emit a matching
`claim_id`. They do, so the query is runnable — but it has never been run
against a real export (readiness gate 2), so the number may not be reported
yet.

## Expiry Rate

**Formula (§8.1):** `(payments with status "expired" and no Claim Succeeded) / (total Payment Created) × 100`.

**Query shape:**

```sql
SELECT
  ROUND(
    (count(*) FILTER (
      WHERE status = 'expired'
        AND NOT EXISTS (
          SELECT 1 FROM events s
          WHERE s.name = 'Claim Succeeded'
            AND s.props->>'claim_id' = e.props->>'claim_id'
        )
    ))::numeric / NULLIF(count(*), 0) * 100,
    2
  ) AS expiry_rate_percent
FROM events e
WHERE e.name = 'Payment Created';
```

**Requirement ahead of this query:** the expiry source of truth is the
payment record's backend `status` (`expired`), not an analytics event, so
the numerator must be computed against payment records joined on `claim_id`
to `Claim Succeeded`. Both events emit `claim_id` today, so the query is
runnable — readiness gate 2 (a real export) is what is outstanding.

## End-to-end conversion (§7.3)

**Formula (§7.3):** `Claim Succeeded ÷ Page Viewed (homepage) × 100`.

This is the collapsed view of the full sender→recipient funnel:

```
Page Viewed (sender) → Payment Created → Claim Page Opened → Claim Succeeded
```

**Query shape:** ratio of the `Claim Succeeded` count to the homepage
`Page Viewed` count, filtered to a shared attribution window (e.g. day/week),
with no `claim_id` join available across journeys — the sender and recipient
events are linked only through the invite/referrer chain. Because of this,
§7.3 treats end-to-end conversion as an approximate census ratio, not a
per-claim join, unless a cross-journey `referrer`/`utm` join is added.

**Blocked on readiness gate 2.** All four events fire from production code;
the query has never been run against a real event export, so the ratio may not
be reported anywhere yet.

## Claim Failure Rate

**Formula (§8.2):** `(Claim Failed events) / (Claim Submitted events) × 100`,
broken down further by `error_type`.

**Events, verified against the implementation (not the spec prose):**

- `Claim Submitted` — emitter `analytics.claimSubmitted`
  (`frontend/lib/analytics.ts`), fired from
  `frontend/app/claim/[token]/claim-page-client.tsx:174` once per
  user-initiated submission, before the request is sent.
- `Claim Failed` — emitter `analytics.claimFailed`, fired from the same file
  at `:222` (`network_error`, safe-to-retry) and `:261` (`transaction_failed`,
  terminal rejection).

**Join key:** none — the spec formula counts both sides as raw event rows.
Both events do carry `claim_id`, so a per-claim variant is available, but the
§8.2 formula does not use it.

**Query shape (PostgreSQL, matching the dialect used above):**

```sql
SELECT
  count(*) FILTER (WHERE name = 'Claim Failed')    AS failures,
  count(*) FILTER (WHERE name = 'Claim Submitted') AS submissions,
  ROUND(
    (count(*) FILTER (WHERE name = 'Claim Failed'))::numeric
    / NULLIF(count(*) FILTER (WHERE name = 'Claim Submitted'), 0)
    * 100,
    2
  ) AS claim_failure_rate_percent
FROM events
WHERE name IN ('Claim Submitted', 'Claim Failed');
```

**`error_type` breakdown (spec: "Broken down further by `error_type`"):**

```sql
SELECT
  props->>'error_type' AS error_type,
  count(*) AS failures,
  ROUND(
    count(*)::numeric
    / NULLIF((SELECT count(*) FROM events WHERE name = 'Claim Failed'), 0)
    * 100,
    2
  ) AS share_of_failures_percent
FROM events
WHERE name = 'Claim Failed'
GROUP BY props->>'error_type'
ORDER BY failures DESC;
```

**Spec-vs-implementation drift found while writing this query — read this
before reporting a number:**

1. **The formula does not measure the prose above it.** §8.2 describes "the
   percentage of claim submissions that result in failure", but
   `Claim Failed` is emitted for only two of the five `SubmitClaimOutcome`
   kinds in `frontend/lib/claim-retry.ts`. `success` emits `Claim Succeeded`;
   `alreadyClaimed` (`claim-page-client.tsx:207`–`:217`) emits **no analytics
   event at all**; `ambiguous` (`:243`–`:255`) emits nothing either and hands
   off to a background poll. A submission that times out therefore sits in
   the denominator without being counted as a failure, so the metric is
   biased low and is blind to exactly the congestion case an operator would
   be looking for. Closing that gap is a tracker change (emit on the
   `ambiguous` and `alreadyClaimed` outcomes, or add an `outcome` property),
   not a query change — recorded here rather than papered over.
2. **The `error_type` breakdown can only ever have two populated buckets.**
   `CLAIM_FAILED_ERROR_TYPES` exports all five §5.3 values, but the only two
   production call sites use `network_error` and `transaction_failed`;
   `token_expired`, `already_claimed` and `unknown` are never emitted by a
   `Claim Failed` call site. Expired and already-claimed tokens surface as
   `Error Displayed` under the §6 taxonomy instead (`expired_token` /
   `already_claimed`, `claim-page-client.tsx:83`–`:98`), so a "why do claims
   fail" report has to union two different error taxonomies.
3. **`attempt_number` is not a retry counter.** `submitClaimWithRetry` retries
   up to three times internally (`claim-retry.ts:70`–`:106`) and emits nothing
   per retry, so `attempt_number` counts user re-submissions, not HTTP
   attempts. Do not chart it as retry depth.
4. **Client-side `Claim Succeeded` exists; the authoritative one may not.**
   `analytics.claimSucceeded()` is called from `claim-page-client.tsx`, and
   §9.2 still marks `Claim Succeeded` "server-side preferred". If the SDK later
   emits a server-side `Claim Succeeded` for the same `claim_id`, every query
   above that counts that event must deduplicate across the two sources or the
   denominator and numerator will both double-count. Until a server-side
   emission exists, treat the client event as the only source.
5. **Scope:** recipients who never reach the submission screen (expired link,
   malformed link) produce no `Claim Submitted` row at all, so this is a rate
   conditional on reaching submission, not on every claim-link open. Use
   `Claim Page Opened` as the funnel entry point for an end-to-end number.

**Readiness:** gate 1 is met (both events fire from production code); gate 2
is not (this query has never been run against an event export). Status stays
`⏳ unverified`.

## Asset Distribution

**Formula (§8.2):** for each asset,
`(Payment Created events with that asset_type) / (total Payment Created events) × 100`.

**Event and field, verified against the implementation:** `Payment Created`,
property `asset_type` — and `asset_type` holds the asset **code**, not a type.
It is populated from `state.assetCode` in
`frontend/components/send-form/steps/confirm-step.tsx:134`, constrained to
`SUPPORTED_ASSETS = ['XLM', 'USDC']` (`details-step.tsx:8`) and defaulting to
`'XLM'` (`components/send-form/index.tsx:29`). The spec's `{XLM, USDC, ...}`
therefore matches what is actually emitted: **no vocabulary drift.**

**Join key:** none — this is a single-event group-by, not a join.

**Query shape (PostgreSQL):**

```sql
WITH created AS (
  SELECT
    COALESCE(props->>'asset_type', '(missing)') AS asset_type,
    props->>'message_id'                     AS message_id
  FROM events
  WHERE name = 'Payment Created'
)
SELECT
  asset_type,
  count(DISTINCT message_id) AS distinct_payments,
  ROUND(
    count(DISTINCT message_id)::numeric
    / NULLIF(SUM(count(DISTINCT message_id)) OVER (), 0) * 100,
    2
  ) AS share_percent
FROM created
GROUP BY asset_type
ORDER BY distinct_payments DESC;
```

**Drift and caveats:**

1. **`asset_type` is omitted, not nulled, when unavailable.** Every emitter
   writes it conditionally — `...(assetType ? { asset_type: assetType } : {})`
   (e.g. `frontend/lib/analytics.ts:395`). In today's sender flow
   `assetCode` always has a value, so no `Payment Created` is emitted without
   it, but §9.2 marks `Payment Created` "server-side preferred" and a
   server-side emitter would not necessarily set it. The `COALESCE` to
   `'(missing)'` and the all-`Payment Created` denominator are both
   deliberate: adding `WHERE asset_type IS NOT NULL` would silently shrink
   the denominator and inflate every share, and a bare
   `GROUP BY props->>'asset_type'` would drop the missing rows so the shares
   quietly fail to sum to 100 %. **This is the most likely way to get this
   KPI wrong.**
2. **Count distinct `message_id`, not rows.** §9.4 deduplication is
   client-side, in-memory and per-tab, so it reduces but does not eliminate
   double counting — a retry arriving from another process, in another tab,
   or after a reload still lands twice. `message_id` was added to every
   payload for exactly this reason; the warehouse-level guarantee is
   `count(DISTINCT message_id)`.
3. **Count only — this KPI cannot be weighted by value.** `Payment Created`
   carries no `amount_usd_equiv`: `conditional.amountUsdEquiv()` exists in
   `frontend/lib/analytics.ts` but has no call site anywhere in the app. The
   sender form's amount also stays XLM-denominated (`amount: state.amountXlm`
   alongside `asset_code: …`, `confirm-step.tsx:90`–`:91`), so a per-asset
   *amount* analysis would be wrong even after `amount_usd_equiv` is wired
   up. That is a separate fix and out of scope for this KPI.
4. **Readiness:** gate 1 is met (`Payment Created` fires from production code
   at `confirm-step.tsx:132`, after `createEphemeralAccount` resolves); gate 2
   is not. Status stays `⏳ unverified`.

## Reclaim Rate

**Formula (§8.1):** `(Funds Reclaimed) / (expired payments) × 100`.

**Query shape:**

```sql
SELECT
  count(DISTINCT r.props->>'message_id') AS reclaims,
  (SELECT count(*) FROM payments WHERE status = 'expired') AS expired,
  ROUND(
    count(DISTINCT r.props->>'message_id')::numeric
    / NULLIF((SELECT count(*) FROM payments WHERE status = 'expired'), 0) * 100,
    2
  ) AS reclaim_rate_percent
FROM events r
WHERE r.name = 'Funds Reclaimed'
```

**Blocked.** The frontend has no reclaim affordance at all: `send-history.tsx`
is read-only and the SDK client exposes no reclaim method, so there is no UI
point where `Funds Reclaimed` could fire. The query above is written so it is
ready the moment that exists — and the numerator must additionally be split by
`reclaim_reason` (`expired` vs `cancelled`) once §4.5 carries it, because an
expiry reclaim and a cancellation reclaim are different user situations.

## Sender Activation Rate

**Formula (§8.1):** `(Payment Created) / (Page Viewed on the homepage) × 100`.

**Query shape:**

```sql
SELECT
  (SELECT count(DISTINCT props->>'message_id') FROM events
     WHERE name = 'Payment Created') AS activated,
  (SELECT count(DISTINCT props->>'message_id') FROM events
     WHERE name = 'Page Viewed' AND props->>'page' = 'homepage') AS visitors,
  ROUND(
    (SELECT count(DISTINCT props->>'message_id') FROM events
       WHERE name = 'Payment Created')::numeric
    / NULLIF((SELECT count(DISTINCT props->>'message_id') FROM events
       WHERE name = 'Page Viewed' AND props->>'page' = 'homepage'), 0) * 100,
    2
  ) AS sender_activation_percent
```

**Note:** `Page Viewed` currently fires only from `page-view-tracker.tsx`,
which is mounted on the homepage alone. That makes this KPI correct today and
means it is *not* a site-wide conversion rate — if the tracker is later mounted
on other routes, the `page = 'homepage'` filter becomes load-bearing and must
stay in the query.

## Share Method Distribution

**Formula (§8.2):** breakdown of `Claim Link Shared` by `share_method`.

```sql
SELECT
  props->>'share_method' AS share_method,
  count(DISTINCT props->>'message_id') AS shares,
  ROUND(
    count(DISTINCT props->>'message_id')::numeric
    / NULLIF(sum(count(DISTINCT props->>'message_id')) OVER (), 0) * 100,
    2
  ) AS share_percent
FROM events
WHERE name = 'Claim Link Shared'
GROUP BY 1
ORDER BY shares DESC
```

**Coverage caveat — read this before reporting the split.** The spec defines
`share_method` as `sms | email | whatsapp | qr_code`, but the only share the
UI currently offers is WhatsApp, so this query will return a single row at
100% `whatsapp`. That is a real number, not a broken query. A distribution
reported as "WhatsApp 100%" is measuring the **absence of other share
affordances**, and must be labelled as such. The funnel's stage-7 drop-off
("share vs just copy") should be read alongside `Claim Link Copied`, which is
counted separately and is not part of this denominator.

## Recipient Entry Channel Distribution

**Formula (§8.2):** breakdown of `Claim Page Opened` by `entry_channel`.

```sql
SELECT
  props->>'entry_channel' AS entry_channel,
  count(DISTINCT props->>'message_id') AS opens,
  ROUND(
    count(DISTINCT props->>'message_id')::numeric
    / NULLIF(sum(count(DISTINCT props->>'message_id')) OVER (), 0) * 100,
    2
  ) AS share_percent
FROM events
WHERE name = 'Claim Page Opened'
GROUP BY 1
ORDER BY opens DESC
```

**Note:** §5.1 defines the channel vocabulary as `sms | email | whatsapp |
qr_scan | deep_link | direct | unknown`. `qr_scan` is mobile-only, so a
web-only dataset will show a structural zero for it rather than a missing
value — that is expected, not a gap. `direct` means "an https claim link with
no referral signal" and `unknown` means the channel could not be determined;
if `unknown` dominates, the classifier is not reading the campaign parameters
that integrators are actually passing, which is a tracking-configuration
problem rather than a user-behaviour finding.

## Viral K-Factor (Recipient → Sender)

**Formula (§8.2):** the rate at which recipients become senders via the
post-claim CTA.

```sql
SELECT
  count(DISTINCT s.props->>'claim_id') AS converted_recipients,
  count(DISTINCT v.props->>'claim_id') AS successful_claims,
  ROUND(
    count(DISTINCT s.props->>'claim_id')::numeric
    / NULLIF(count(DISTINCT v.props->>'claim_id'), 0),
    3
  ) AS k_factor
FROM events v
LEFT JOIN events s
  ON s.name = 'Sender Signup CTA Clicked'
 AND s.props->>'claim_id' = v.props->>'claim_id'
WHERE v.name = 'Claim Success Viewed'
```

**Caveat — this measures intent, not conversion.** `Sender Signup CTA Clicked`
records that the recipient tapped "Create your own payment link"; it says
nothing about whether they then completed a payment. Read it as an upper bound
on the loop, and pair it with `Page Viewed` / `Send Form Viewed` on the
sender side for the closing half. A K-factor above 1 from this query alone is
not evidence of a viral loop.

## Wallet Address Validation Failure Rate

**Formula (§8.2):** `(Wallet Address Validation Failed) / (Wallet Address Entered) × 100`.

**Blocked on `Wallet Address Entered`,** which has no call site yet. Note the
denominator problem this will surface: validation failures fire while the
recipient is *typing* (on the transition into an invalid value), whereas a
successful entry fires on submit. One session can therefore produce several
validation failures and at most one entry, so the ratio measures
per-attempt friction, not a share of recipients. Aggregate per
`session_id` and report the median failures per session instead of a raw
ratio, or the number will exceed 100% and look like a bug.

---

## Funnel query definitions (§7.1–§7.3)

The three funnels in §7 are staged views over the same event stream. They are
computed per `session_id` within a `session_id`-scoped window rather than by
joining across journeys, because sender and recipient events for one payment
are only linked through `claim_id` (available) — never through identity.

**Sender Activation Funnel (§7.1)** — the per-stage drop-off column in §7.1
is `1 − (stage n+1 ÷ stage n)` over a shared `session_id`:

```sql
WITH stages AS (
  SELECT session_id,
    bool_or(name = 'Page Viewed')            AS s1,
    bool_or(name = 'Send Form Started')      AS s2,
    bool_or(name = 'Send Form Completed')    AS s3,
    bool_or(name = 'Wallet Connected')       AS s4,
    bool_or(name = 'Payment Confirmed')      AS s5,
    bool_or(name = 'Payment Created')        AS s6,
    bool_or(name = 'Claim Link Shared')      AS s7
  FROM events
  GROUP BY session_id
)
SELECT
  count(*) FILTER (WHERE s1) AS stage_1,
  count(*) FILTER (WHERE s2) AS stage_2,
  count(*) FILTER (WHERE s3) AS stage_3,
  count(*) FILTER (WHERE s4) AS stage_4,
  count(*) FILTER (WHERE s5) AS stage_5,
  count(*) FILTER (WHERE s6) AS stage_6,
  count(*) FILTER (WHERE s7) AS stage_7
FROM stages;
```

`bool_or` per session is what makes this robust: a session that re-enters the
send form counts once per stage rather than inflating whichever stage it
revisited.

**Recipient Claim Funnel (§7.2)** — the same shape over
`Claim Page Opened` → `Claim Verified` → `Claim CTA Clicked` →
`Claim Submitted` → `Claim Succeeded`.

**Full End-to-End Funnel (§7.3)** — collapses to
`Claim Succeeded ÷ Page Viewed (homepage) × 100`, computed as a census ratio
over a shared attribution window rather than a per-claim join, since the sender
and recipient of one payment are different people on different devices. This
is a **ratio of two unrelated populations** and must never be presented as a
per-payment conversion rate.

**Abandonment is the absence of the next stage.** There is no abandonment
event (see §7.1). Before attributing a drop-off to a specific cause, check for
the paired failure event first — a session that emitted `Payment Creation
Failed` or `Claim Failed` was already explained, and counting it again as
abandonment double-counts it.

---

## Operational metrics (§8.3)

§8.3 names "Operational Metrics" without enumerating what to audit against.
This is that list. Each row states the metric, the events it derives from, and
what an alert on it would mean. Metrics marked *(needs a backend source)* are
not computable from analytics events alone.

| Metric | Derived from | Alert means |
| --- | --- | --- |
| Event volume per hour, by event name | All events | A sudden drop to zero is an instrumentation or provider failure, not a traffic change |
| Base-payload completeness | §3.1 fields present on sampled events | A missing field means an emitter bypassed `track()` |
| `Error Displayed` rate by `error_type` | `Error Displayed` | A spike in `network_unavailable` is an outage; `unknown` above ~5% means the taxonomy is not being applied |
| Duplicate `message_id` rate | §9.4 `message_id` | Non-zero means a double-submit path exists that the dedup store did not catch |
| DNT / opt-out suppression rate | Not derivable from the stream | Must be counted client-side; record it beside any reported KPI |
| Claim settle latency (`sweep_duration_ms`) | `Claim Succeeded.sweep_duration_ms` | Rising p95 means the sweep path is degrading |
| Verification latency (`verification_time_ms`) | `Claim Verified.verification_time_ms` | Rising p95 means the backend claim-verify endpoint is slowing |
| Provider delivery errors | Client logs | Any sustained rate means events are being lost silently |
| Mobile crash rate | §10 `Crash Reported` | Any sustained rise is a regression in a released build |
| SDK error rate by code *(needs a backend source)* | `BridgeletApiError.statusCode` | 5xx cluster growth is an SDK incident |
| Claim success vs payment created (ratio) | `Claim Created` vs `Claim Succeeded` | A widening gap means payments are being funded but never claimed |
| Notification → claim rate (§10) | `Notifications Cleared`, `Claim Page Opened` | Low rate means the notification surface is not driving engagement |

---

## Where these numbers are computed

There is **no dashboard or BI code in this repository** — no `queries/`,
`dashboards/`, dbt project or SQL directory exists here, and none is planned.
This document is therefore the canonical, version-controlled definition of each
KPI: the formula from §8, the exact events and join keys, and the query shape
that implements it. The queries above are deliberately written against a
generic event schema (`events(name, props, timestamp)`) so they can be
translated into whatever the committed provider's query language is.

If a dashboard is built somewhere else, this document is the thing it must be
checked against, in both directions: a KPI reported on a dashboard must match
a definition here, and a definition here with no corresponding dashboard is not
a reported number. Whichever provider is committed (§9.1 is still undecided),
the definitions here do not change.

---

---

## Pipeline prerequisites (§9.4, §9.5)

Two spec requirements change how the numbers above must be read. Both are
implemented in `frontend/lib/analytics.ts` at the single `track()` dispatch
point, so no call site can bypass them:

- **§9.5 Do Not Track.** When the browser reports `DNT: 1`, every event is
  suppressed *before* any identifier is minted: no provider call, and no
  `localStorage`/`sessionStorage` write. For these queries the consequence is
  that event volume is a lower bound — rates look better than they are
  because opted-out visitors' silence is indistinguishable from success. The
  suppressed share is not measurable from the event stream alone; record the
  DNT suppression rate next to any reported KPI.
- **§9.4 Event deduplication.** Every payload now carries a `message_id` UUID,
  and `Payment Created` / `Claim Succeeded` — the only two events §9.4 names —
  are deduplicated on `claim_id` in a bounded store (200 keys, 1-hour TTL,
  least-recently-used eviction, in memory only). Because that store is
  per-tab and lost on reload, it reduces double counting rather than
  eliminating it, which is why the queries above use
  `count(DISTINCT message_id)`. It is deliberately **not** persisted to
  `localStorage`: `claim_id` identifies a payment, and a privacy-respecting
  layer should not create durable cross-session state.
- **Not covered — the `Payment Confirmed` double-click.** That event carries
  no `claim_id` (it fires before the ephemeral account exists), so there is
  nothing stable to key on, and a generic "same event twice within N ms" rule
  would silently swallow legitimate repeats such as two `Page Viewed` events
  in one tick. That guard belongs in the UI: `ConfirmStep` already disables
  its "Confirm & Send" button while `submitting`, and that — not the
  analytics layer — is the place where the double-click is prevented.

---

## Cross-reference

The §7.1 (§7.1/§7.2/§7.3) funnel stage→event→issue maps live in the funnel
trackers. This document is the KPI counterpart: formula → query → readiness
status. Re-check the readiness table whenever a per-event PR merges.

Where a formula and the emitted events disagree, the drift is recorded in the
KPI's own section rather than resolved by adjusting the query — see the
numbered drift notes under *Claim Failure Rate*. Reporting a number that
silently papers over that gap is what the
`analytics-spec-vs-implementation-unverified` postmortem is about.