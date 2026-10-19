# Checklist: Documentation Freshness Review

Periodic review of the repository's `docs/` directory to catch stale content and ensure all documentation remains accurate and up-to-date.

## Review Cadence: Bi-Annual (Every 6 Months)
This review should run **twice per year** (June and December) to ensure documentation stays current with product development cycles. This cadence:
- Aligns with major release milestones
- Balances the overhead of manual reviews with the risk of stale documentation
- Complements the quarterly PDF artifact spot check

## Overall Review Owner: Technical Documentation Lead
The documentation lead is responsible for coordinating each review cycle, assigning individual document owners, and tracking all action items until completion.

---

## Individual Document Review Checklist

### 1. `docs/GLOSSARY.md`
- **Document Owner**: Product Management Team
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] All terms are still relevant to the current product scope
  - [ ] New terminology introduced since last review has been added
  - [ ] Definitions are accurate and reflect current implementation
  - [ ] No outdated terms remain that refer to removed features
  - [ ] Cross-references to other documents are still valid

### 2. `docs/sender-auth-model.md`
- **Document Owner**: Core Engineering Team
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] Authentication flows described match current implementation
  - [ ] Security properties are still accurate and enforced
  - [ ] All error conditions documented are still relevant
  - [ ] Any changes to the auth model have been incorporated
  - [ ] Diagrams or flowcharts accurately represent the current system

### 3. `docs/security-model.mdx`
- **Document Owner**: Security Engineering Team
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] Threat model covers all current attack surfaces
  - [ ] Mitigations described are still in place and effective
  - [ ] Compliance requirements are up-to-date
  - [ ] Any new security controls have been documented
  - [ ] Links to related security documents are functional
- **PDF Pair Check**:
  - [ ] Confirm `security-model.pdf` matches the current `.mdx` source (trigger the [PDF artifact freshness spot check](../runbooks/pdf-artifact-freshness-spot-check.md) if discrepancies are found)

### 4. `docs/architecture.mdx`
- **Document Owner**: System Architecture Team
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] System components and their interactions are accurately described
  - [ ] New services or components added since last review are included
  - [ ] Deprecated components have been removed or marked as legacy
  - [ ] Data flows described match current implementation
  - [ ] Technology stack information is current
- **PDF Pair Check**:
  - [ ] Confirm `architecture.pdf` matches the current `.mdx` source (trigger the [PDF artifact freshness spot check](../runbooks/pdf-artifact-freshness-spot-check.md) if discrepancies are found)

### 5. `docs/integration-guide.mdx`
- **Document Owner**: Developer Relations Team
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] API endpoints documented match the current API surface
  - [ ] Integration steps are accurate and tested
  - [ ] Code examples work with the latest version
  - [ ] Troubleshooting section covers common current issues
  - [ ] Rate limits, quotas, and restrictions are up-to-date
- **PDF Pair Check**:
  - [ ] Confirm `integration-guide.pdf` matches the current `.mdx` source (trigger the [PDF artifact freshness spot check](../runbooks/pdf-artifact-freshness-spot-check.md) if discrepancies are found)

### 6. `docs/analytics-spec.md`
- **Document Owner**: Product Analytics Team
- **Last Reviewed Date**: _______________
- **Review Cadence**: Review alongside every analytics change, at minimum once per bi-annual cycle
- **Review Items**:
  - [ ] Every event tracked in code is documented in the spec (no undocumented additions)
  - [ ] No renamed, changed, or removed events remain in the spec
  - [ ] Event payloads and base-payload fields match current implementation
  - [ ] Draft/Status metadata is current
- **Drift Risk Note**: The spec is large (919 lines) and has known drift scenarios (events added/renamed/changed/removed in code without a spec update), so treat it as an explicitly tracked document rather than catching drift via ad hoc audits

---

### N. `docs/analytics-spec.md`

- **Document Owner**: Product Analytics Owner (with Frontend and Mobile
  Engineering as reviewers — all three surfaces emit from this document)
- **Recommended cadence**: **Quarterly, and on any PR that touches it.** The
  bi-annual cadence below is wrong for this document: it is 900+ lines,
  describes behaviour rather than describing a decision, and is being
  implemented by several parallel branches at once.
- **Last Reviewed Date**: _______________
- **Review Items**:
  - [ ] Every `#### \`Event Name\`` heading still has at least one emitter in `frontend/` or `mobile/` — a heading with no call site is unimplemented, and should be marked as such rather than left to look live
  - [ ] Every emitted event still appears as a heading (the inverse check, enforced in CI by `.github/workflows/analytics-spec-diff.yml`)
  - [ ] Event names still match exactly, including Title Case (`Noun Verb`)
  - [ ] Every §3.2 conditional property listed is still populated somewhere in code
  - [ ] §3.1 base payload fields are all populated for both web and mobile, and the platform-specific omissions are still accurate
  - [ ] §6 `error_type` taxonomy still matches `ERROR_TYPES` / the mobile union — no value invented, none removed
  - [ ] §7 funnel stages still correspond to events that fire
  - [ ] §8 KPI formulas still match the queries in `docs/analytics-kpi-definitions.md`
  - [ ] Spec version bumped, with a changelog row, for every behaviour change since the last review
  - [ ] The "not a source of truth" status note is still accurate — if implementation compliance has been verified since, replace it with what *has* been verified rather than deleting it
  - [ ] Mobile extension (§10) still matches `mobile/app/src/analytics/analytics.ts`
- **Drift Risk**: Four concrete scenarios, all observed or anticipated in
  `postmortems/analytics-spec-vs-implementation-unverified.md`: events added
  in code without a spec update; events renamed in code; payload properties
  changed; events removed from code but left in the spec. The first three are
  caught by the CI drift check; **removal is not**, because a deleted emitter
  leaves the spec looking correct. This entry exists so that is a scheduled
  check rather than an accident.

---

## Cross-Cutting Review Items (All Documents)
- [ ] **MDX/PDF Pair Verification**: All paired `.mdx` and `.pdf` files have been checked for content drift (one randomly selected file during this cycle, per the [PDF artifact freshness spot check](../runbooks/pdf-artifact-freshness-spot-check.md))
- [ ] **Internal Links**: All hyperlinks between documents in the `docs/` directory resolve correctly
- [ ] **External Links**: Any external links (to third-party documentation, tools, etc.) are still active and accurate
- [ ] **Screenshots/Diagrams**: All visual assets are current and reflect the current UI/system state
- [ ] **Contact Information**: Any team or individual contact details are still accurate

## Post-Review Steps
1. **Document All Findings**: Create a single issue summarizing all stale content found during the review
2. **Assign Remediation Tasks**: Tag the appropriate document owners to address each finding
3. **Schedule Next Review**: Add the next bi-annual review to the team's calendar
4. **Update Last Reviewed Dates**: Fill in all "Last Reviewed Date" fields in this checklist and commit the updates

## Related Resources
- [PDF Artifact Freshness Spot Check](../runbooks/pdf-artifact-freshness-spot-check.md) - Runbook for manually verifying PDF exports match their mdx sources
- [Rebuild docs PDF from mdx](../runbooks/rebuild-docs-pdf-from-mdx.md) - Runbook for regenerating PDFs after source changes
- [docs-mdx-vs-pdf-pairs.md](../glossary/docs-mdx-vs-pdf-pairs.md) - Glossary entry listing all paired documentation files