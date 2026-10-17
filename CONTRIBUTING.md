# Contributing to Bridgelet

Thanks for helping improve Bridgelet! Please read this guide before opening an issue or pull request.

## Ground Rules

- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in all community spaces.
- Start with the [Support Guide](./SUPPORT.md) to choose the right channel for questions vs. bugs.
- For security issues, **do not** open a public issue; follow `SECURITY.md`.

## Ways to Contribute

- **Report bugs:** Use GitHub Issues with clear reproduction steps, expected vs. actual behavior, logs, and environment details.
- **Ask questions or propose ideas:** Use GitHub Discussions for how-to topics, design feedback, and feature requests.
- **Improve docs:** Submit PRs for docs corrections or clarifications.
- **Code contributions:** Focus on well-scoped changes with tests when applicable.

## Pull Request Checklist

- Keep PRs focused; prefer small, reviewable changes.
- Include tests or notes on why tests are not required.
- Update documentation when behavior or APIs change.
- Link related issues/discussions and describe the approach and rationale.
- Adding or changing a tracked analytics event? Read the next section first.

## Adding or Modifying a Tracked Analytics Event

`docs/analytics-spec.md` is the contract for everything the apps report, and
several parallel branches are instrumenting it right now. Read
`bridgelet-product-audit/runbooks/review-analytics-spec-before-new-event.md`
before you write the `track()` call — it exists because the spec and the code
have already drifted once.

The order that works:

1. **Check the spec first.** The event, its journey and its payload live in
   `docs/analytics-spec.md` §4–§6. If the event is not there, that is the
   first thing to change — an event in code but not in the spec is invisible
   to the drift check in `.github/workflows/analytics-spec-diff.yml` and to
   anyone reading the spec.
2. **Change the spec and the code in the same PR.** A spec-only PR describes
   behaviour nobody emits; a code-only PR ships behaviour nobody documented.
3. **Name it the way the spec names it.** `Noun Verb` in Title Case, matching
   the `#### \`Event Name\`` heading exactly. A snake_case name does not match
   the CI drift check and will fail the build.
4. **Route every event through the single `track()` dispatch point.** Opt-out
   (§9.5), deduplication (§9.4) and the §3.1 base payload are enforced there;
   an emitter that bypasses it silently loses all three.
5. **Reuse the `conditional.*` helpers** for §3.2 properties rather than
   re-typing snake_case keys.
6. **Never send an identifier you would not want in a log**: no addresses, no
   claim tokens, no message text. §5.2 states this for wallet addresses
   explicitly.
7. **Assert it fires.** `frontend/e2e/analytics.spec.ts` is the pattern — an
   event with no test can be deleted by a later refactor without anything
   failing.
8. **Update `docs/analytics-kpi-definitions.md`** if the event is a KPI input
   or unblocks one; its readiness table is the project's record of what may be
   reported.

A PR that adds a tracking call should tick the analytics box in the PR
template.

## Development Notes

- See the repository README and `/docs` for architecture and setup details.
- Align with existing patterns and follow project style where present.

## Releases

Releases are cut with [release-it](https://github.com/release-it/release-it):

```bash
npm run release           # patch release (default)
npm run release -- minor  # minor release
npm run release -- major  # major release
npm run release:dry-run   # preview what the release would do
npm run changelog         # print the changelog for the next release (preview)
```

`CHANGELOG.md` entries are generated automatically from conventional commits
and written by release-it as part of `npm run release`; see the "Release
process" note at the top of `CHANGELOG.md` for the manual override policy.

## Questions?

If you are unsure how to proceed, open a GitHub Discussion or email the maintainers per [SUPPORT.md](./SUPPORT.md). We are happy to help you get started.

## Reference

- [Governance](./docs/GOVERNANCE.md) — outlines project roles, decision-making, and contributor participation.
