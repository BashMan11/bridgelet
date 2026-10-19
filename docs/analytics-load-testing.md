# Analytics ingestion: volume and failure plan

`docs/analytics-spec.md` §4–§6 define 34 events, plus the mobile extension in
§10. Once they fire from real traffic, the ingestion path becomes a dependency
of every dashboard, so its limits need to be known before they are discovered
by a dropped event. This document records what to measure, what "too much"
means, and what happens when the provider is unavailable.

This is a plan, not a test result. No load test has been run — there is no
traffic to generate one from yet, and a synthetic load test would only prove
the harness works.

## Why this is not covered by CI

The e2e suite (`frontend/e2e/analytics.spec.ts`) asserts that events fire with
the right payloads. It cannot tell you whether the provider accepts 40 events
per second from one recipient, or what happens when it returns 503 — CI has no
traffic and must not send any. Volume behaviour is measured against a staging
ingest endpoint, deliberately, never against a production key.

## Expected shape of the traffic

Volume is driven by two flows with very different profiles.

| Flow | Events per session | Shape |
| --- | --- | --- |
| Sender (create a payment) | ~7–9 | One-off, bursty at the start, then quiet |
| Recipient (claim) | ~4–6 | One-off; the highest-value and most latency-sensitive session |

The dangerous shape is not the total, it is the **highest-frequency single
event**. Candidates, in order:

| Event | Why it can spike | Mitigation |
| --- | --- | --- |
| `Send Form Field Changed` (§4.2) | Naively fires on every keystroke across every field | The spec already requires blur, not keystroke. Enforce on the emitter; consider coalescing per field |
| `Wallet Address Validation Failed` (§5.2) | Fires on the transition into invalid — but a paste-then-edit loop can repeat it many times per session | Rate-limit per `claim_id` + `session_id`, or emit on blur only |
| `Error Displayed` (§6) | Any retry loop: rate limits, timeouts, background polling | Bounded by the retry policy in `lib/claim-retry.ts`; verify the bound actually holds |
| `Screen Viewed` (§10, mobile) | Navigation churn, no debounce | Already bounded: one event per screen mount |

## What to measure against a staging endpoint

1. **Throughput.** Sustain the peak event rate for 15 minutes with a mix
   matching the table above (say 80% recipient / 20% sender), and confirm no
   429s and no client-side backoff.
2. **Payload size.** The §3.1 base payload rides on every event. Check the
   average body size, and whether `user_agent` — potentially several hundred
   bytes — earns its cost on the high-frequency events.
3. **Rejection behaviour.** Force a 4xx with a malformed payload and a 5xx
   with the provider down. The frontend must not retry aggressively and must
   not surface an error to the user; `track()` is fire-and-forget and has to
   stay that way.
4. **Client-side queue depth.** `lib/analytics.ts` buffers events fired before
   the provider script loads. Confirm the bound and the flush behave under a
   cold load on a slow connection.
5. **Provider-side limits.** Confirm the plan's own event and property ceilings
   before launch, not after.

## Budgets to agree before launch

These are the numbers to decide, with the provider's limits in hand:

- **Maximum events per recipient session.** If a session should produce ~6,
  what is the ceiling at which something is wrong?
- **Maximum `user_agent` retention**, if any. It is the largest field per event
  and the least load-bearing analytically.
- **Retention window** for raw event payloads versus for aggregates.
- **Sampling policy.** Events feeding a KPI numerator or denominator
  (`Payment Created`, `Claim Succeeded`, `Claim Page Opened`) are never sampled.
  High-frequency diagnostics may be — but the policy is written down, not
  applied ad hoc.

## Failure behaviour (the part that needs no load test)

- **Provider unreachable.** `track()` returns without throwing; events are
  buffered in memory up to a bounded size and dropped once the buffer is full.
  They are not retried across page loads. That is deliberate: analytics must
  never be able to break a claim.
- **No provider configured.** A production build warns once rather than
  discarding every event in silence. A build without
  `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` sending nothing is expected behaviour, not a
  failure — but it should never be the state of a production release, which is
  precisely why the warning exists.
- **Clock skew.** `timestamp` is client-generated. Dashboards should prefer the
  provider's ingestion time for ordering, and use `timestamp` only for
  client-side latency such as `verification_time_ms`.

## Open questions for the team

1. Which provider is the committed destination? The web code targets
   Plausible, the mobile sink is a generic HTTP endpoint, and §9.1 has not been
   decided. A load test against the wrong provider proves nothing.
2. Is there an ingest proxy in front of the provider, or does the browser talk
   to it directly? This changes both the volume profile and what a client-side
   retry can safely do.
3. Does the mobile sink need its own collector, given that mobile networks
   drop far more readily than desktop ones?