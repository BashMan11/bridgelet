# Issue #771 — `Page Viewed` already fires (verification + regression test)

> **Status: resolved / stale.** The work requested by issue #771 is already
> present on `main`. This note records the evidence so the issue can be closed
> without another implementation PR. The only addition made alongside this
> document is a component-level regression test locking in the emitter's payload
> and trigger (see §3).
>
> Reviewed against `main` at commit `5abe3cd` (*docs(analytics): verify #784
> Claim Link Shared already fires (#784)*), remote
> `https://github.com/fikrah-Tech/bridgelet.git`.

---

## 1. What the issue asks for

> `#771 Analytics event Page Viewed is defined in the spec but never fires in code`
>
> `frontend/lib/analytics.ts` currently exposes only four tracking calls
> (`claim_page_viewed`, `claim_initiated`, `claim_success`, `claim_error`) — none
> of which correspond to the spec's Title-Case naming convention (Noun Verb,
> §2.1), and a repo-wide search finds `analytics.claimPageViewed`/etc. are never
> actually imported or called from any component in `frontend/`. Add a `track()`
> call for **Page Viewed** with the payload fields specified in the spec, at the
> point in the UI where the homepage/entry point loads.

The issue text describes a specific old revision of `frontend/lib/analytics.ts`
that had exactly four `snake_case` tracking calls and no component call sites.
That revision exists in history, but current `main` is well past it. This is the
same stale-issue pattern as #772, #775 and #784
([`issue-772-send-form-viewed-already-implemented.md`](issue-772-send-form-viewed-already-implemented.md),
[`issue-775-send-form-completed-already-implemented.md`](issue-775-send-form-completed-already-implemented.md),
[`issue-784-claim-link-shared-already-implemented.md`](issue-784-claim-link-shared-already-implemented.md)).

---

## 2. Evidence that the issue is already resolved

### 2.1 The `track('Page Viewed', …)` emitter exists

`frontend/lib/analytics.ts:1100-1105`:

```ts
pageViewed: ({ page, entrySource }: { page: string; entrySource?: EntrySource }) =>
  track('Page Viewed', {
    journey: 'sender',
    page,
    ...(entrySource ? { entry_source: entrySource } : {}),
  }),
```

The event name is also registered in the `ClaimEvent` union at
`frontend/lib/analytics.ts:4` (`| 'Page Viewed'`), which is the type contract that
keeps every emitter's name exactly equal to the spec's `####` heading (Noun Verb,
§2.1). The `entry_source` value type is the closed set
`EntrySource = 'direct' | 'referral' | 'shared_link' | 'unknown'`
(`frontend/lib/analytics.ts:783`), matching §4.1.

This payload matches `docs/analytics-spec.md` §4.1 **exactly**:

| Spec §4.1 property | Emitted by the code above        |
| ------------------ | -------------------------------- |
| `journey` = `"sender"` | `journey: 'sender'`          |
| `page` = `"homepage"`  | `page` (passed by the call site) |
| `entry_source`         | `entry_source: entrySource`  |

The §3.1 base payload (`app_version`, `user_agent`, `device_type`, `referrer`,
`platform`, `anonymous_id`, `session_id`, `message_id`) is merged into every
event centrally by `track()`, so no per-call plumbing is required.

### 2.2 The homepage call site exists, at the point the entry point loads

`frontend/components/page-view-tracker.tsx:35-38`:

```tsx
export function PageViewTracker({ page }: PageViewTrackerProps) {
  useEffect(() => {
    analytics.pageViewed({ page, entrySource: entrySource() });
  }, [page]);

  return null;
}
```

The companion `entrySource()` helper (`page-view-tracker.tsx:15-28`) derives the
§4.1 `entry_source` from the current URL and referrer — `?ref=`/`?utm_source=`
becomes `shared_link`, a cross-origin `document.referrer` becomes `referral`,
otherwise `direct`, and any parse failure (`unknown`).

It is mounted on the homepage / entry point at `frontend/app/page.tsx:15`
(`<PageViewTracker page="homepage" />`, imported at `app/page.tsx:6`), so the
event fires once when the entry point loads — exactly the spec's trigger ("Fired
when the Bridgelet homepage loads", §4.1). The `page="homepage"` value matches
the §4.1 field table.

### 2.3 An independent repo document already records this emitter

`docs/analytics-server-vs-client-decision.md:51`:

| Event          | Current emitter (verified)                                                                                                    | §9.2 says | Verdict            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ |
| `Page Viewed`  | client — `components/page-view-tracker.tsx:37` (`useEffect`), rendered only on the homepage (`app/page.tsx:15`, `page="homepage"`) | client    | **Keep client.** Correct as-is. |

The same document also records the coverage caveat that the tracker is
homepage-only (§2 below) and that `analytics.pageViewed()` hardcodes
`journey: 'sender'` — which is the correct §4.1 value.

### 2.4 Git history — when and why it was "fixed"

- `git show a88a910:frontend/lib/analytics.ts` contains **exactly** the four
  `snake_case` calls the issue describes:
  `claimPageViewed: () => track('claim_page_viewed')`,
  `claimInitiated: () => track('claim_initiated')`,
  `claimSuccess: () => track('claim_success')`,
  `claimError: (reason) => track('claim_error', { reason })`.
- Commit `8dea79e` — *Fix/analytics queue and verification (#751)* — rewrote the
  analytics layer to the spec's Title-Case naming and **introduced both the
  `Page Viewed` emitter and the `PageViewTracker` component**, wired into the
  homepage.
- `git log -S "PageViewTracker" -- frontend` returns `8dea79e` and nothing
  earlier, confirming PR #751 is the origin (the `#118` origin annotation at the
  top of `analytics.ts` predates the spec rewrite and no longer reflects the
  file's contents).

**Conclusion:** issue #771 was written against the pre-#751 revision and was
resolved by PR #751. On today's `main`, the requested emitter and the homepage
call site exist and match the spec. No implementation work remains for #771
itself.

---

## 3. What this PR adds anyway: a regression test

Nothing previously asserted that the tracker fires `Page Viewed`, or that it
carries the §4.1 payload. If someone unmounted `PageViewTracker`, changed the
`page` value, or dropped `entry_source`, the suite stayed green.

`frontend/components/page-view-tracker.test.tsx` now mocks `@/lib/analytics` and
asserts:

- the tracker fires `analytics.pageViewed` **exactly once on mount** with
  `page: 'homepage'`;
- it does **not** re-fire on a re-render where `page` is unchanged (guarding the
  "fires once per entry-point load" contract);
- `entry_source` resolves to all four §4.1 values — `direct` (same-origin
  referrer / none), `referral` (cross-origin referrer), `shared_link`
  (`?ref=` / `?utm_source=`), and `unknown` (unparseable referrer).

This is the gap that let #771 read as unfixed, consistent with the analysis in
the #772 postmortem §3.

---

## 4. Minor, non-blocking observations (follow-up candidates)

These are *not* what #771 asked for; they are noted for visibility only.

1. **The tracker is homepage-only.** `frontend/app/page.tsx` is the sole mount
   point, so the recipient claim page emits `Claim Page Opened` but no
   `Page Viewed`. This is intentional and already documented in
   `docs/analytics-server-vs-client-decision.md:81-88`: §7.3 uses the *homepage*
   `Page Viewed` as the end-to-end conversion denominator, so widening the
   tracker would corrupt that metric unless the funnel definition changes too.

2. **`?ref=` is treated as `shared_link` at the homepage.** `entrySource()`
   returns `shared_link` for any `ref`/`utm_source` query parameter. On the
   homepage this plausibly reads as an inbound referral rather than a shared
   claim link; if the distinction matters for dashboards, the mapping may want
   revisiting (out of scope for #771).

3. **Funnel tracker still shows stage 1 as open.**
   `docs/analytics-funnel-tracker.md` may still list `Page Viewed` against its
   feeder issue rather than actual emission; as with the #772/#775 stages this
   should be reconciled against the code if the tracker's status is keyed to the
   feeder issue.

---

## 5. Recommendation

Close #771 as **already implemented** (fixed by PR #751), citing:

- `frontend/lib/analytics.ts:1100-1105` — the `track('Page Viewed', …)` call
- `frontend/lib/analytics.ts:4` — the `ClaimEvent` union entry
- `frontend/lib/analytics.ts:783` — the `EntrySource` closed set
- `frontend/components/page-view-tracker.tsx:15-38` — the `entry_source` helper and the `useEffect` call site
- `frontend/app/page.tsx:6,15` — production homepage wiring
- `docs/analytics-spec.md` §4.1 — the payload definition the code matches
- `docs/analytics-server-vs-client-decision.md:51` — independent confirmation

and this PR's regression test (§3) as the guard against re-introducing the gap.
