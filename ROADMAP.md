# Bridgelet Roadmap 🗺️

This document outlines the development timeline, planned features, and community priorities for the Bridgelet project. Our goal is to create a robust, secure, and user-friendly infrastructure for onboarding non-crypto users to Stellar.

> **Note:** This roadmap is a living document and subject to change based on community feedback and project priorities.

## Current Status
**Phase:** MVP Implementation 🚧  
**Focus:** Building core primitives for ephemeral account creation and sweeping.

We are currently focused on delivering the Minimum Viable Product (MVP) which allows for the basic lifecycle of a Bridgelet account: creation, funding, and claiming (sweeping).

## Tracked Workstreams

### Analytics instrumentation (frontend + mobile)

The product is a financial flow whose success is invisible without telemetry,
so this is a first-class workstream rather than a documentation detail.
`docs/analytics-spec.md` defines 34 events plus a mobile extension (§10) and a
§3.1 base payload; `docs/analytics-kpi-definitions.md` tracks, per KPI,
whether its constituent events actually fire.

- [x] Base payload implemented end to end (`frontend/lib/analytics.ts`)
- [x] Sender journey instrumentation (events, conditional properties, §6 error types)
- [x] Recipient journey instrumentation (events, entry channels, error classification)
- [x] Mobile sink, base payload and screen tracking
- [x] KPI query definitions with per-KPI readiness status
- [ ] **Decide the analytics provider (§9.1)** — blocks volume testing and dashboard build
- [ ] Consent UI exposing the opt-out gate (the gate exists; nothing surfaces it to a user yet)
- [ ] Dashboard layer built against the KPI definitions, with `Payment Created` as the success criterion
- [ ] Volume and failure testing against a staging ingest endpoint (`docs/analytics-load-testing.md`)

## 2026 Timeline

### Q1 2026: MVP Completion 🏁
*Goal: Deliver a functional, tested core system on Testnet.*

- **Smart Contracts (bridgelet-core)**
  - [x] Basic ephemeral account contract structure
  - [ ] Implement sweeping logic restrictions (lock to destination)
  - [ ] Time-based expiration logic
  - [ ] Comprehensive unit tests for core contracts
- **SDK (bridgelet-sdk)**
  - [ ] Account generation utilities
  - [ ] Transaction building for funding and claiming
  - [ ] Basic error handling and validation
- **Documentation**
  - [ ] Complete API Reference
  - [ ] "Hello World" integration tutorial
- **Infrastructure**
  - [ ] Stellar Testnet deployment scripts

### Q2 2026: Enhanced Features & Security 🛡️
*Goal: Harden the system for production and improve developer experience.*

- **Security**
  - [ ] **Third-party Security Audit** of core smart contracts
  - [ ] Implement bug bounty program
- **SDK Enhancements**
  - [ ] Webhook support for account events (claimed, expired)
  - [ ] Multi-signature support for organization controls
- **Frontend & Mobile**
  - [ ] Release `bridgelet-ui` reference implementation (Next.js)
  - [x] **Mobile Client (`bridgelet-mobile`)**: React Native / Expo native app architecture, SDK API client, test suite, and CI coverage
  - [ ] Mobile NFC & QR claim code scanning integrations
- **Network**
  - [ ] **Mainnet Beta Launch** (Limited pilot)

### Q3 2026: Advanced Capabilities 🚀
*Goal: Support complex use cases and scale.*

- **Smart Contracts**
  - [ ] Support for non-native tokens (USDC, EURC)
  - [ ] Batch account creation optimization
  - [ ] Gas sponsorship delegation features
- **Integration**
  - [ ] Pre-built integrations for major payroll providers
  - [ ] Email/SMS link generation service
- **Ecosystem**
  - [ ] Partner pilot program launch
  - [ ] Hackathon sponsorship and developer grants

### Q4 2026: Ecosystem Growth 🌍
*Goal: Mass adoption and decentralized governance.*

- **Scale**
  - [ ] Cross-border payment specific optimizations
  - [ ] High-throughput claim processing
- **Governance**
  - [ ] Community governance model proposal
  - [ ] Open contributor incentives
- **Partnerships**
  - [ ] Integration with major Stellar wallets
  - [ ] On/Off-ramp provider partnerships

## Community Requests
*Priorities driven by community feedback.*

| Feature | Status | Github Issue |
|---------|--------|--------------|
| [Example] Python SDK | 📝 Planned | #12 |
| [Example] Dashboard UI | 🚧 In Progress | #45 |

*Have a request? Open a [Feature Request](https://github.com/bridgelet-org/bridgelet/issues/new?template=feature_request.md).*

## Long-term Vision 🔭

Bridgelet aims to become the standard "invisible bridge" for the Stellar network. We envision a future where:
1.  **Any organization** can send funds to a phone number or email without worrying about crypto complexity.
2.  **Users** are onboarded to non-custodial wallets progressively, only learning about keys when they are ready.
3.  **Developers** have a plug-and-play solution for last-mile crypto delivery.

## Feedback & Input

We build in the open. You can influence this roadmap by:
- Voting on [GitHub Discussions](https://github.com/bridgelet-org/bridgelet/discussions)
- Contributing code or documentation
- Joining our community calls (Announced in Discussions)
