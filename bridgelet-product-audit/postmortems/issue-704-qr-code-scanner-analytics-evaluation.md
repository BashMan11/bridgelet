# Issue #704 — QR Code Scanning Entry Path Analytics Coverage Evaluation

> **Issue:** [#704](https://github.com/bridgelet-org/bridgelet/issues/704)  
> **Status:** Analyzed, Specified & Tracked  
> **Date:** October 2026  
> **Component:** `mobile/app/src/receipient/QRCodeScanner.tsx`, `mobile/app/src/linking/useDeepLinking.ts`, `docs/analytics-spec.md`

---

## 1. Context & Problem Statement

Issue #704 states:
> Mobile-specific claim entry via QR code scan (`QRCodeScanner.tsx`) has no corresponding tracked event, even though this is a materially different entry channel from a tapped/pasted link and would be relevant to the Recipient Entry Channel Distribution KPI (§8.2) once that's implementable.

### Current Implementation State
1. **Sender QR Code Generation**:
   - `mobile/app/src/sender/ShareSheet.tsx` supports rendering a QR code on sender devices via `react-native-qrcode-svg` so recipients can scan the claim link directly in person.
2. **Mobile Deep Linking**:
   - `mobile/app/src/linking/useDeepLinking.ts` listens for incoming links (`bridgelet://claim/<token>` or `https://bridgelet.app/claim/<token>`) and routes them to the claim flow (`router.push({ pathname: "/claim", params: { token } })`).
3. **In-App QR Scanner (`QRCodeScanner.tsx`)**:
   - As documented in `ROADMAP.md` (*Mobile NFC & QR claim code scanning integrations*), in-app camera scanning for QR codes is slated on the roadmap.
   - When camera scanning resolves a URL/token, it initiates the recipient journey through an in-person, camera-mediated physical interaction, unlike a web browser link tap from SMS, Email, or WhatsApp.
4. **Analytics Gap**:
   - The analytics spec v1.0.0 defines `Claim Page Opened` (§5.1) with a closed set of entry channels:
     ```
     entry_channel: "sms" | "email" | "whatsapp" | "direct" | "unknown"
     ```
   - This set lacks an explicit identifier for QR code scanning (`qr_scan`). Consequently, in-person scans would fall back to `"unknown"` or `"direct"`, obscuring the real effectiveness of physical QR onboarding in the *Recipient Entry Channel Distribution* KPI (§8.2).

---

## 2. Specification Compliance & Alignment

### A. Updating `entry_channel` in `docs/analytics-spec.md`
To ensure QR scan entry is a first-class citizen alongside digital messaging channels:
- Added `"qr_scan"` as an official option to the `entry_channel` property in `docs/analytics-spec.md` §5.1 (`Claim Page Opened`):
  ```
  entry_channel: "sms" | "email" | "whatsapp" | "direct" | "qr_scan" | "unknown"
  ```
- Updated §8.2 *Recipient Entry Channel Distribution* formula to include `qr_scan` in the set:
  ```
  For each entry_channel in {sms, email, whatsapp, direct, qr_scan, unknown}:
    % = (Claim Page Opened events with entry_channel)
        / (total Claim Page Opened events)
        * 100
  ```
- Bumped spec version to `1.0.1` in the Spec Changelog.

### B. CI Drift Check Invariant
- The drift check workflow (`.github/workflows/analytics-spec-diff.yml`) verifies that every `#### \`Event Name\`` heading in `docs/analytics-spec.md` strictly matches the events declared in `frontend/lib/analytics.ts` and `mobile/app/src/analytics/analytics.ts`.
- `Claim Page Opened` is already a first-class event in the spec and in `mobile/app/src/analytics/analytics.ts`.
- By instrumenting QR scan entry through `Claim Page Opened` with `entry_channel: "qr_scan"`, no rogue undocumented event headings are introduced, and strict CI compliance is maintained.

---

## 3. Implementation Contract for `QRCodeScanner.tsx`

When `QRCodeScanner.tsx` is implemented or wired into the mobile client navigation, it must adhere to the following contract:

1. **Extraction & Routing**:
   ```ts
   // Upon successful camera detection of a bridgelet QR code:
   const token = parseInviteLink(scannedUrl);
   if (token) {
     // Emit Claim Page Opened with entry_channel: "qr_scan"
     track({
       name: "Claim Page Opened",
       params: {
         claim_id: token,
         entry_channel: "qr_scan",
       },
     });

     router.push({ pathname: "/claim", params: { token, entry_channel: "qr_scan" } });
   }
   ```
2. **Channel Propagation**:
   - The `entry_channel: "qr_scan"` parameter must be forwarded through the recipient flow so that subsequent events carrying `entry_channel` (e.g., `Claim Succeeded` §5.3) preserve attribution back to the physical QR code scan.
3. **Optional Interaction Event**:
   - If the team desires UI interaction telemetry specific to the camera viewfinder (e.g. permission prompt or camera cancellation), a dedicated event such as `QR Scanner Viewed` or `QR Scanner Permission Denied` should be formally submitted to a minor spec revision under the §6 (Error/Edge cases) or §5 taxonomy.

---

## 4. Verification & Testing Guardrails

1. **Spec & Drift Check**:
   - Verified that `Commits` maintain 1:1 parity between spec event headings and code event unions.
2. **Roadmap**:
   - Updated `ROADMAP.md` mobile integrations section to explicitly link issue #704 and the `entry_channel: "qr_scan"` requirement.
