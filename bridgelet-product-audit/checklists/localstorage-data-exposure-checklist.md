# LocalStorage Data Exposure Review Checklist

This checklist covers all frontend localStorage usage to ensure no sensitive data is ever stored in localStorage, and that all stored data is accounted for and secure.

## Core Wallet Storage Verification (`bridgelet_wallet`)
- [ ] Verify that `bridgelet_wallet` (used in `frontend/lib/wallet.ts`) only ever stores `publicKey` and `type` properties from the `ConnectedWallet` interface, never any secret key material
- [ ] Confirm `persistWallet()` function only accepts and stringifies the `ConnectedWallet` type, which is strictly limited to `{ publicKey: string; type: WalletType }`
- [ ] Verify that generated wallets' secret keys are never persisted to localStorage or any other persistent storage
- [ ] Confirm no other code in the codebase writes additional properties to the `bridgelet_wallet` localStorage entry
- [ ] Verify `clearPersistedWallet()` properly removes the `bridgelet_wallet` entry from localStorage when a wallet is disconnected

## Analytics Identifiers (`bridgelet_anonymous_id`, `bridgelet_session_id`)

`docs/analytics-spec.md` §3.1 requires an `anonymous_id` (persisted) and a
`session_id` (per visit). Both are browser storage, so both are in scope. Run
this section **before** merging any change to what analytics writes.

- [ ] `bridgelet_anonymous_id` stores only a client-generated UUID v4 — confirm it is not derived from an IP address, a wallet address, a claim token, a user agent, or any other user attribute
- [ ] The value is generated in the browser and never transmitted to the SDK or backend as anything other than an analytics payload property
- [ ] No claim token, wallet address, email address, or amount is written to this key, or reconstructed from it
- [ ] `bridgelet_session_id` is session-scoped (cleared when the session ends) and not a durable identifier
- [ ] An opted-out or `DNT: 1` visitor has **no** identifier minted at all — verify the check runs *before* generation, not merely before dispatch, because writing the UUID is itself a durable tracking artefact
- [ ] The explicit opt-out key (if present) stores only the literal opt-out state, and clearing it does not leave a stale value behind
- [ ] Confirm the analytics module cannot throw in a way that leaves a partially-written or malformed value at either key
- [ ] Confirm no third-party analytics script reads or writes these keys directly (they are the module's private namespace: `bridgelet_`)

**Mobile equivalent.** The Expo app stores `bridgelet_anonymous_id` in
AsyncStorage and keeps `bridgelet_session_id` in memory only. Verify the same
properties there, and confirm the value is in app-scoped sandboxed storage
rather than `expo-secure-store` (which is for credentials, and this is not
one).

## Other localStorage Usage Inventory
- [ ] Document and verify all non-wallet localStorage usage in the frontend:
  - [ ] `bridgelet-theme`: Stores theme preference ('light'/'dark') in `frontend/components/theme-provider.tsx` and `frontend/app/layout.tsx` — confirm this only stores theme selection, no sensitive data
- [ ] Scan entire frontend codebase to ensure no other localStorage keys are being used beyond the ones documented here
- [ ] Verify all localStorage usage is intentional and necessary for application functionality
- [ ] Confirm no third-party libraries are writing unexpected data to localStorage that hasn't been accounted for

## Maintenance & Preventative Checks
- [ ] **This checklist must be re-run after any change to `persistWallet()`'s stored shape or any modification to what data is persisted to localStorage**
- [ ] Before merging any PR that modifies localStorage usage, complete this full checklist to confirm no sensitive data is exposed
- [ ] Add this checklist to PR review requirements for any frontend changes that touch wallet persistence or localStorage access
- [ ] Regularly (quarterly) re-run this full checklist to scan for new localStorage usage that may have been added

## Security Validation
- [ ] Confirm that no localStorage entries contain any PII (Personally Identifiable Information) beyond what's strictly necessary
- [ ] Verify that all localStorage data is properly cleared when a user logs out/disconnects their wallet
- [ ] Confirm that the application never stores sensitive cryptographic material (private keys, seed phrases, mnemonics) in localStorage, sessionStorage, or any client-side persistent storage