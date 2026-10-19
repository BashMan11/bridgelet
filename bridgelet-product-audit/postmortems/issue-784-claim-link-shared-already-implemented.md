# Issue #784 — `Claim Link Shared` already fires (verification + regression test)

> **Status: resolved / stale.** The work requested by issue #784 is already
> present on `main`. This note records the evidence so the issue can be closed
> without another implementation PR. The only addition made alongside this
> document is a lib-level regression test locking in the emitter's payload (see
> §3).
>
> Reviewed against `main` at commit `9ddb7ae` (*added the analytics event
> (#929)*), remote `https://github.com/fikrah-Tech/bridgelet.git`.

---

## 1. What the issue asks for

> `#784 Analytics event Claim Link Shared is defined in the spec but never fires in code`
>
> `frontend/lib/analytics.ts` currently exposes only four tracking calls
> (`claim_page_viewed`, `claim_initiated`, `claim_success`, `claim_error`) — none
> of which correspond to the spec's Title-Case naming convention (Noun Verb,
> §2.1), and a repo-wide search finds `analytics.claimPageViewed`/etc. are never
> actually imported or called from any component in `frontend/`. Add a `track()`
> call for **Claim Link Shared** with the payload fields specified in the spec, at
> the point in the UI where the sender actively shares the claim link (funnel
> stage 7 — activation milestone).

The issue text describes a specific old revision of `frontend/lib/analytics.ts`
that had exactly four `snake_case` tracking calls and no component call sites.
That revision exists in history, but current `main` is well past it. This is the
same stale-issue pattern as #772 and #775
([`issue-772-send-form-viewed-already-implemented.md`](issue-772-send-form-viewed-already-implemented.md),
[`issue-775-send-form-completed-already-implemented.md`](issue-775-send-form-completed-already-implemented.md)).

---

## 2. Evidence that the issue is already resolved

### 2.1 The `track('Claim Link Shared', …)` call exists

`frontend/lib/analytics.ts:1070-1075`:

```ts
claimLinkShared: ({ claimId, shareMethod }: { claimId: string; shareMethod: ShareMethod }) =>
  track('Claim Link Shared', {
    journey: 'sender',
    claim_id: claimId,
    share_method: shareMethod,
  }),
```

The event name is also registered in the `ClaimEvent` union at
`frontend/lib/analytics.ts:17` (`| 'Claim Link Shared'`), which is the type
contract that keeps every emitter's name exactly equal to the spec's `####`
heading (Noun Verb, §2.1). The `share_method` value type is the closed set
`ShareMethod = 'sms' | 'email' | 'whatsapp' | 'qr_code'`
(`frontend/lib/analytics.ts:781`), matching §4.4.

This payload matches `docs/analytics-spec.md` §4.4 **exactly**:

| Spec §4.4 property              | Emitted by the code above       |
| ------------------------------ | ------------------------------- |
| `journey` = `"sender"`          | `journey: 'sender'`             |
| `claim_id`                      | `claim_id: claimId`             |
| `share_method`                  | `share_method: shareMethod`     |

The §3.1 base payload (`app_version`, `user_agent`, `device_type`, `referrer`,
`platform`, `anonymous_id`, `session_id`, `message_id`) is merged into every
event centrally by `track()`, so no per-call plumbing is required.

### 2.2 The UI call site exists, where the sender actively shares the link

`frontend/components/send-form/steps/confirm-step.tsx:309-312`:

```ts
function handleWhatsAppShare() {
  if (!createdAccountId) return;
  analytics.claimLinkShared({ claimId: createdAccountId, shareMethod: 'whatsapp' });
}
```

It is wired to the **"Share on WhatsApp"** anchor on the post-payment success
screen (`confirm-step.tsx:391-399`, `onClick={handleWhatsAppShare}`), which is
rendered when `submitPhase === 'success'` (`confirm-step.tsx:321`). This is
exactly the spec's trigger ("Fired when the sender uses a share button"), and it
is funnel stage 7 — the activation milestone (`docs/analytics-spec.md` §7.1).
`createdAccountId` is the backend account id returned by
`createEphemeralAccount()`, so `claim_id` is the definitive payment identifier,
not a URL segment.

The component ships in production: `frontend/components/send-form/index.tsx`
renders `ConfirmStep`, and `frontend/app/send/page.tsx` renders `<SendForm />`.

### 2.3 An independent repo document already records this emitter

`docs/analytics-server-vs-client-decision.md:57`:

| Event               | Current emitter (verified)                   | §9.2 says | Verdict       |
| ------------------- | -------------------------------------------- | --------- | ------------- |
| `Claim Link Shared` | client — `confirm-step.tsx:180`              | client    | Keep client.  |

(Line numbers in that document were read at commit `faeb0b6`; the emitter has
since moved within `confirm-step.tsx` but the call site is unchanged.)

### 2.4 Git history — when and why it was "fixed"

- `git show a88a910:frontend/lib/analytics.ts` contains **exactly** the four
  `snake_case` calls the issue describes:
  `claimPageViewed: () => track('claim_page_viewed')`,
  `claimInitiated: () => track('claim_initiated')`,
  `claimSuccess: () => track('claim_success')`,
  `claimError: (reason) => track('claim_error', { reason })`.
- Commit `8dea79e` — *Fix/analytics queue and verification (#751)* — rewrote the
  analytics layer to the spec's Title-Case naming and **introduced
  `claimLinkShared`** (the `track('Claim Link Shared', …)` call) together with
  its WhatsApp call site. This landed in PR #751 via its sub-commit
  *"feat(analytics): wire up Claim Link Copied and Claim Link Shared events
  (#716)"*.
- `git log -S "claimLinkShared" -- frontend` returns `8dea79e` and nothing
  earlier, confirming PR #751 is the origin.

**Conclusion:** issue #784 was written against the pre-#751 revision and was
resolved by PR #751. On today's `main`, the requested emitter and call site
exist and match the spec. No implementation work remains for #784 itself.

---

## 3. What this PR adds anyway: a regression test

Like #775 (which had no test) and #772 (which added one), nothing previously
asserted that `Claim Link Shared` carries the §4.4 payload. If someone changed
the emitter's property keys or dropped `journey`, the suite stayed green.

`frontend/lib/analytics.test.ts` now stubs `window.plausible` and asserts, per
§4.4, that `analytics.claimLinkShared({ claimId, shareMethod })` emits the event
`Claim Link Shared` with `journey: 'sender'`, `claim_id`, and `share_method` for
**every** value of the closed `ShareMethod` set (`sms`, `email`, `whatsapp`,
`qr_code`). This locks in the payload the issue is about.

(A component-level test asserting the WhatsApp click fires the event would
require driving the whole Freighter-signing + funding flow to reach the success
screen; the lib-level payload test is the proportionate guard, consistent with
the analysis in the #772 postmortem §3.)

---

## 4. Minor, non-blocking observations (follow-up candidates)

These are *not* what #784 asked for; they are noted for visibility only.

1. **Only the WhatsApp share method is wired.** `ShareMethod` enumerates
   `sms | email | whatsapp | qr_code`, but the UI only emits `whatsapp`. There is
   no SMS, email, or QR share button on the success screen, so the other three
   values never appear in data. This was already recorded as a
   `Share Method Distribution` (`docs/analytics-spec.md` §8.2) under-count in
   `docs/analytics-kpi-readiness-audit.md` (#624).

2. **Two other share surfaces emit nothing.**
   `frontend/components/share-prompt.tsx` (share links on the claim page) and
   `frontend/components/nfc-share-button.tsx` (NFC write, reached from the
   success screen) perform share-like actions but fire no `Claim Link Shared`
   event. So even the `whatsapp` bucket under-counts sender sharing.

3. **The automatic claim-link email is not this event.** `sendClaimEmail()`
   (`confirm-step.tsx:251-277`) sends the link server-side once the account is
   claimable. That is the product acting, not the sender actively sharing, so it
   correctly does not emit `Claim Link Shared` — but an `email` `share_method`
   will therefore only exist once a manual email-share button is added.

4. **Funnel tracker still shows stage 7 as open.**
   `docs/analytics-funnel-tracker.md:35` lists
   `| 7 | Claim Link Shared | §4.4 | #571 | ⬜ open |` even though the code
   emits the event and `docs/analytics-server-vs-client-decision.md:57` verifies
   it. As with #775's stage 3, this is only correct if the tracker's "open"
   status is keyed to the feeder issue (#571) rather than to actual emission;
   otherwise it should be reconciled.

---

## 5. Recommendation

Close #784 as **already implemented** (fixed by PR #751), citing:

- `frontend/lib/analytics.ts:1070-1075` — the `track('Claim Link Shared', …)` call
- `frontend/lib/analytics.ts:17` — the `ClaimEvent` union entry
- `frontend/lib/analytics.ts:781` — the `ShareMethod` closed set
- `frontend/components/send-form/steps/confirm-step.tsx:309-312, 391-399` — the UI call site
- `frontend/app/send/page.tsx` — production wiring
- `docs/analytics-spec.md` §4.4 — the payload definition the code matches
- `docs/analytics-server-vs-client-decision.md:57` — independent confirmation

and this PR's regression test (§3) as the guard against re-introducing the gap.
