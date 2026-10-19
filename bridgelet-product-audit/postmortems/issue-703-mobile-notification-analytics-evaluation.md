# Issue #703 — Mobile Notification Interactions & Badge Telemetry Evaluation

> **Issue:** [#703](https://github.com/bridgelet-org/bridgelet/issues/703)  
> **Status:** Analyzed, Specified & Tracked  
> **Date:** October 2026  
> **Component:** `mobile/app/src/hooks/useNotificationBadge.ts`, `mobile/app/src/store/notificationStore.ts`, `mobile/app/(tabs)/notifications.tsx`

---

## 1. Context & Problem Statement

Issue #703 identifies:
> `mobile/app/src/hooks/useNotificationBadge.ts` and `mobile/app/(tabs)/notifications.tsx` suggest a notifications feature exists on mobile with no corresponding analytics event (e.g. notification received, opened, badge cleared). If notifications drive claim/send engagement, add tracking so their contribution to the funnels can be measured.

### Current Implementation State
- `mobile/app/src/store/notificationStore.ts` contains hardcoded mock notifications (`MOCK_NOTIFICATIONS`) such as *"New message received"*, *"Payment confirmed"*, and local state handlers (`markAsRead`, `markAllAsRead`).
- `mobile/app/src/hooks/useNotificationBadge.ts` computes badge labels (`1`–`9`, `'9+'`) for Expo Router's tab bar.
- `mobile/app/(tabs)/notifications.tsx` is an empty file (placeholder stub in `(tabs)/_layout.tsx`).
- No real push notification infrastructure (e.g., Apple Push Notification service / Firebase Cloud Messaging / Expo Notifications) is currently installed or configured.
- Zero analytics events are currently fired from notification badge computation or notification store mutations.

---

## 2. Specification Compliance & Governance

Per the project's strict analytics development runbooks and CI:
1. `docs/analytics-spec.md` focuses exclusively on sender payment creation and recipient claim settlement funnels.
2. The drift test (`.github/workflows/analytics-spec-diff.yml`) fails if event names in `docs/analytics-spec.md` diverge from `ClaimEvent` in `frontend/lib/analytics.ts` and `AnalyticsEvent` in `mobile/app/src/analytics/analytics.ts`.
3. Adding undocumented or unverified tracking calls inside prototype code directly violates the runbook rules (`bridgelet-product-audit/runbooks/review-analytics-spec-before-new-event.md`).

---

## 3. Specification Proposal: Notification Engagement Events

When a real push notification service is provisioned (e.g. when integrating claim expiration reminders or sender payment confirmation alerts), the following events should be formally added to a future revision of the analytics specification:

### Event 1: `Notification Received`
- **Trigger:** Fired in the background or foreground when a remote push notification or system alert arrives on the device.
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
    "notification_id": "string",
    "notification_type": "claim_reminder | payment_confirmed | link_expired | system",
    "claim_id": "string | null",
    "has_badge_increment": "boolean"
  }
  ```

### Event 2: `Notification Opened`
- **Trigger:** Fired when a user taps on a push notification banner or an item in the in-app notification feed.
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
    "notification_id": "string",
    "notification_type": "claim_reminder | payment_confirmed | link_expired | system",
    "claim_id": "string | null",
    "action_source": "system_tray | in_app_list"
  }
  ```

### Event 3: `Notification Cleared`
- **Trigger:** Fired when a user clears unread notifications or marks all as read, resetting the tab bar badge.
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
    "cleared_count": "number",
    "clear_method": "mark_all_read | dismiss_all"
  }
  ```

### Funnel Contribution & Attribution
- Tapping a notification with a `claim_id` deep-links directly into the claim landing screen, passing `entry_channel: "push_notification"` into `Claim Page Opened` (§5.1).
- This connects notification re-engagement directly to the *Recipient Activation Funnel* (§7.2) and the *Claim Conversion Rate* (§8.1).

---

## 4. Resolution Summary

1. **Clarified Spec Scope:** Explicitly documented mobile push notification and badge tracking boundaries in `docs/analytics-spec.md` Section 1.
2. **Roadmap Item Tracked:** Added notification lifecycle telemetry to `ROADMAP.md` Frontend & Mobile items.
3. **CI Drift Check Preserved:** Maintained 1:1 alignment between spec event headings and code event unions.
