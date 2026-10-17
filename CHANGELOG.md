# Changelog

All notable changes to Bridgelet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release process:** changelog entries are generated automatically from
> conventional commits on release (`npm run release`, via release-it +
> `@release-it/conventional-changelog`). Manual edits are an explicit override
> of the generated output — see the Releases section of CONTRIBUTING.md.

## [Unreleased]

### Added
- **Analytics instrumentation (frontend + mobile).** Base payload completeness for `docs/analytics-spec.md` §3.1 (`journey`, `timestamp`, `network`, exported `PLATFORM` constant), pre-provider event queueing so page-load events survive the third-party script race, an explicit consent gate alongside §9.5 Do Not Track, opt-in payload verification via `NEXT_PUBLIC_ANALYTICS_VERIFY`, and typed ambient `window.plausible`/`window.posthog` declarations. Sender journey: `Send Form Started`, `Wallet Connection Failed`, `Payment Success Viewed`, `wallet_provider` on the wallet events, `amount_usd_equiv` and a corrected `expiry_days`, and §6 error-type mapping for the confirm-and-send failure surface (previously unmeasured). Recipient journey: `Wallet Address Screen Viewed`, `Wallet Address Entered`, `is_returning_visit`, `entry_channel` covering QR and deep-link entries, `tx_hash`/`explorer` on `Explorer Link Clicked`, and backend-outcome-to-`error_type` mapping. Mobile: a working production sink, a §3.1 base payload, screen views wired into all registered screens, and instrumentation for notifications, language detection, theme changes and ErrorBoundary crashes. Specification: mobile extension (§10), KPI query definitions with per-KPI readiness status, a sampling policy, a status/version note, and enforcement of the spec-before-new-event process in the PR template. Spec version: **analytics spec 1.0**
- Cross-repo compatibility matrix (`docs/compatibility.md`, `compatibility.json`) documenting which frontend releases are verified against which `bridgelet-sdk` / `bridgelet-core` versions, a `compatibility.yml` CI job that checks out the pinned `bridgelet-sdk` commit and fails the build if its live OpenAPI spec no longer has an endpoint or field the frontend's API client depends on (`scripts/check-sdk-contract.mjs`), and a `release-it` `before:git:release` hook (`scripts/check-compatibility-doc.mjs`) that blocks tagging a release until the matrix has been updated
- Playwright E2E suite for the reference UI (`frontend/playwright.config.ts`, `frontend/e2e/`) targeting `localhost:3000`, with `test:e2e` / `test:e2e:ui` scripts and Frontend CI running E2E against the built Next.js app
- Initial MVP implementation of Bridgelet for ephemeral Stellar accounts
- **bridgelet-core**: Soroban smart contracts for on-chain account restrictions, sweep logic, and event emission ([bridgelet-core](https://github.com/bridgelet-org/bridgelet-core))
- **bridgelet-sdk**: NestJS backend SDK for account lifecycle management, claim authentication, and webhook system ([bridgelet-sdk](https://github.com/bridgelet-org/bridgelet-sdk))
- Ephemeral account creation with programmable restrictions (funding source, amount, asset, expiration)
- Single inbound payment acceptance per account with validation
- Automatic fund sweep to permanent wallets upon successful claim redemption
- Time-based account expiration with automatic fund recovery to sender
- On-chain event monitoring and emission for all state changes (AccountCreated, PaymentReceived, SweepExecuted, AccountExpired)
- REST API endpoints for account creation, retrieval, claim redemption, and webhook subscriptions
- Database schema for accounts, claims, and webhooks with PostgreSQL
- Comprehensive documentation including architecture overview, security model, integration guide, and use cases
- Testing requirements and deployment specifications for MVP

### Changed

### Deprecated

### Removed

### Fixed

### Security

- Added `docs/security-model.mdx` — re-authored security model in MDX with threat model table (15 threats, mitigations, and statuses) and explicit MVP stub callouts for stub sweep auth, missing encryption at rest, demo-only claim page, and absent CSP enforcement
- Built full demo mode flag (?demo=true) for the reference UI running against MSW mocks 
