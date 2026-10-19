# Issue #702 — Measurement of Partial Form Abandonment in Sender Funnel

> **Issue:** [#702](https://github.com/bridgelet-org/bridgelet/issues/702)  
> **Status:** Confirmed & Explicitly Documented  
> **Date:** October 2026  
> **File:** `docs/analytics-spec.md` (§4.2, §7.1)

---

## 1. Problem Statement & Clarification

Issue #702 highlights:
> The Sender Activation Funnel (§7.1) implies a stage-2-to-stage-3 drop-off metric, but there's no session-timeout or explicit abandonment event defined — meaning a user who starts the form and simply closes the tab produces `Send Form Started` with no corresponding negative signal, only silence. Confirm this is intentional (drop-off measured purely as absence of the next funnel event) and document it explicitly, since it's a common point of confusion when building funnel dashboards.

---

## 2. Senior Engineering Architectural Assessment

### Why Drop-off is Measured Purely as the Absence of the Next Funnel Milestone
1. **Industry Standard for Funnel Analysis**:
   - In modern product analytics architectures (Amplitude, Mixpanel, PostHog, Google Analytics 4, Snowplow), conversion funnels are fundamentally defined by ordered sequence milestones:
     $$\text{Stage } A \longrightarrow \text{Stage } B$$
   - Users who trigger Stage $A$ but do not trigger Stage $B$ within an attribution window (e.g. session or 24 hours) represent drop-off by mathematical absence.
2. **Unreliability of Explicit Client Abandonment Events**:
   - Web browsers do not provide reliable guarantees for firing network requests during tab closing, process termination, or mobile browser backgrounding.
   - Relying on `beforeunload`, `pagehide`, or `visibilitychange` to emit an explicit `Send Form Abandoned` event results in severe under-reporting, inconsistent cross-browser behavior, and false positives (e.g., switching tabs to verify an address or look up details).
3. **Session-Level Attribution**:
   - Every event in Bridgelet carries `session_id` and `anonymous_id` in its base payload (§3.1).
   - Downstream data warehouses calculate partial abandonment simply by grouping events by `session_id` and computing:
     $$\text{Abandonment Rate} = 1 - \frac{\text{Sessions with } \texttt{Send Form Completed}}{\text{Sessions with } \texttt{Send Form Started}}$$
4. **Intermediate Friction Diagnosis**:
   - For teams investigating *why* users abandoned without an explicit timeout event, Bridgelet already tracks `Send Form Field Changed` (§4.2). The last edited field in an uncompleted session pinpoints the exact form input that caused drop-off.

---

## 3. Specification Updates

We updated `docs/analytics-spec.md`:
1. **Section 7.1 (*Sender Activation Funnel*)**:
   - Added a detailed subsection titled *Funnel Drop-off & Partial Abandonment Measurement Methodology*.
   - Explicitly clarified that drop-off is intentionally measured as the absence of `Send Form Completed` within the session window.
   - Outlined downstream SQL and dashboard query formulas.
2. **Section 4.2 (*Send Form Started* and *Send Form Completed*)**:
   - Added cross-referencing *Funnel notes* directly beneath the payload tables for both events.
3. **Spec Changelog**:
   - Incremented version to `1.0.1` documenting the formalization of drop-off measurement methodology.

---

## 4. Verification

- Ran the spec-vs-code drift check (`.github/workflows/analytics-spec-diff.yml` logic). All 36 event headings in `docs/analytics-spec.md` remain in exact 1:1 parity with the code event unions in `frontend/lib/analytics.ts` and `mobile/app/src/analytics/analytics.ts`.
