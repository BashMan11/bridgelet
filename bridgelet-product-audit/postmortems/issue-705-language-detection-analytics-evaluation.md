# Issue #705 — Language Detection & Translation Analytics Evaluation

> **Issue:** [#705](https://github.com/bridgelet-org/bridgelet/issues/705)  
> **Status:** Analyzed & Documented  
> **Date:** October 2026  
> **Component:** `mobile/app/src/features/translate/languageDetection.ts`, `useLanguageDetection.ts`, `LanguageInput.tsx`

---

## 1. Context & Problem Statement

Issue #705 observes:
> `mobile/app/src/features/translate/languageDetection.ts` and the associated `useLanguageDetection.ts`/`LanguageInput.tsx` suggest a translation/localization feature exists with no analytics coverage (e.g. language auto-detected vs. manually overridden). If this is a meaningful UX investment, consider whether it should have its own event category in a future spec revision.

### Current Implementation State
- `mobile/app/src/features/translate/languageDetection.ts` provides `LanguageDetectionService` with fallback heuristic detection and API detection (`/api/translate/detect`).
- `mobile/app/src/hooks/useLanguageDetection.ts` wraps this with debounce and manual override state.
- `mobile/app/src/components/LanguageInput.tsx` provides a text input UI with detection badges, alternative language suggestions, and manual override selection.
- Currently, neither `languageDetection.ts`, `useLanguageDetection.ts`, nor `LanguageInput.tsx` fire any analytics tracking events.
- Furthermore, `LanguageInput` is not currently integrated into the primary transactional send or claim flows in `mobile/app/src/sender/` or `mobile/app/src/receipient/`.

---

## 2. Specification Compliance & Drift Analysis

Per the repository's governance and CI checks:
1. `docs/analytics-spec.md` is strictly guarded by the CI workflow (`.github/workflows/analytics-spec-diff.yml`), which asserts exact 1:1 parity between `#### \`Event Name\`` headings in the spec and the union of event names in `frontend/lib/analytics.ts` and `mobile/app/src/analytics/analytics.ts`.
2. As documented in runbook `bridgelet-product-audit/runbooks/review-analytics-spec-before-new-event.md`, adding new tracking events requires formal specification update, naming according to `Noun Verb` Title Case, base payload compliance, and explicit funnel classification.
3. Language detection does not currently belong to the core Sender or Recipient conversion funnels (which track wallet connections, claims, payments, and sweeps).

---

## 3. Future Specification Proposal (Event Category Design)

If language detection and translation are expanded into a key user-facing journey, the following event category design should be formally adopted in a future specification version (e.g., v1.1.0):

### Event Category: Translation & Language Detection

#### Event: `Language Detected`
- **Fires when:** Language detection completes with confidence meeting or exceeding the threshold (`MIN_CONFIDENCE_THRESHOLD = 0.6`), or fallback heuristic detects a script.
- **Payload Schema:**
  ```jsonc
  {
    // Standard Base Payload (§3.1)
    "anonymous_id": "string",
    "session_id": "string",
    "journey": "sender | recipient | shared",
    "timestamp": "ISO 8601 string",
    "platform": "mobile",
    "network": "testnet | mainnet",
    "app_version": "string",
    "analytics_spec_version": "string",

    // Event-specific Properties
    "detected_language": "string",      // ISO language code e.g. "en", "es", "ar"
    "confidence": "number",             // 0.0 to 1.0
    "detection_source": "string",       // "api" | "heuristic_fallback"
    "has_alternatives": "boolean"       // whether alternative suggestions were returned
  }
  ```

#### Event: `Language Overridden`
- **Fires when:** User manually selects an alternative language suggestion or uses the dropdown override in `LanguageInput`.
- **Payload Schema:**
  ```jsonc
  {
    // Standard Base Payload (§3.1)
    "anonymous_id": "string",
    "session_id": "string",
    "journey": "sender | recipient | shared",
    "timestamp": "ISO 8601 string",
    "platform": "mobile",
    "network": "testnet | mainnet",
    "app_version": "string",
    "analytics_spec_version": "string",

    // Event-specific Properties
    "previous_language": "string | null", // previously detected or selected language
    "selected_language": "string",        // manually selected language code
    "override_source": "string"          // "dropdown" | "alternative_pill"
  }
  ```

### Privacy & PII Safeguards
- **Crucial Rule:** The raw user input (`text`) must **NEVER** be captured in the analytics payload. Only metadata (`detected_language`, `confidence`, `detection_source`) may be transmitted.

---

## 4. Resolution & Roadmap Integration

- **Documentation updated:** Noted language detection as out-of-scope for the baseline v1.0.0 spec in `docs/analytics-spec.md` Section 1.
- **Roadmap tracking:** Added a future roadmap consideration under `ROADMAP.md` Frontend & Mobile items.
- **Spec Drift Protection:** Preserved the exact event set in `docs/analytics-spec.md` and `mobile/app/src/analytics/analytics.ts` so `.github/workflows/analytics-spec-diff.yml` remains green.
