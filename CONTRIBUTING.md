# Contributing / Release Workflow

This project uses two long-lived branches:

- `main` — stable, released. Users on the stable update channel track this.
- `beta` — prerelease, testing. Users on the beta update channel track this.

## Working on a new feature

1. Branch off `beta`:
   ```bash
   git checkout beta
   git pull
   git checkout -b feature/<short-name>
   ```
2. Do the work, commit, push the feature branch.
3. Open a PR into `beta`. Always use a PR — even solo, this gives a
   reviewable diff and a clean revert point if the change breaks `beta`
   for other in-flight testing.
4. Review and merge the PR into `beta`.
5. Delete the feature branch after merge (locally and on origin) to keep
   branch clutter down.

## Cutting a beta prerelease

Every push to `beta` that you want testable gets its own tag/build —
not just one beta release per cycle.

1. Bump the version in `package.json` / `package-lock.json`:
   - First beta of a cycle: `x.y.0-beta.1`
   - Subsequent beta builds in the same cycle: `x.y.0-beta.2`, `.3`, etc.
2. Push the version bump to `beta`, then run the **Build and Publish
   Release** GitHub Actions workflow (`workflow_dispatch`) against
   `beta`. This builds mac (signed + notarized), Windows, and Linux in
   parallel on GitHub-hosted runners, validates the assets, and
   publishes the GitHub **prerelease** automatically.
3. Add release notes (see Changelog below).
4. Beta-channel installs auto-update to this build; it's also
   downloadable from GitHub under the prerelease tag.

## Promoting beta to stable

Once a beta build has been thoroughly tested (all automated tests
passing, plus a manual pass covering: server connection/API key,
recipients, schedule/active hours, group selection, logo upload, session
persistence across an upgrade, and the leader-email flow), promote it:

1. Merge `beta` into `main` via PR.
2. **Before/while merging, confirm beta-only testing scaffolding is not
   shipping wide open in stable** — e.g. the walk leader email settings
   menu should stay hidden, and any test-leader-only restriction on the
   leader email flow must still hold.
3. Bump the version in `main` to the next stable release, e.g. `1.0.1`,
   `1.1.0` (drop the `-beta.N` suffix).
4. Run the **Build and Publish Release** GitHub Actions workflow
   against `main` to build, notarise, and publish as the new **latest**
   stable GitHub release.
5. Merge `main` back into `beta` (so beta has everything main just
   received), then bump `beta`'s version to the next cycle's
   `x.(y+1).0-beta.1`. Keep using the same `beta` branch — it's
   persistent, not recreated per release.

## Changelog

Keep a short entry per beta bump and per stable release — what changed,
not just the version number. This can live in the GitHub release notes
for now; a `CHANGELOG.md` can be added later if that becomes hard to
track.

## Related repository

Server-side scheduling, Walks Manager checking, and email delivery live
in the private `ra_walks_notifier_server` repository, not here. This repo
is the desktop client only: it talks to that server's HTTP API using a
per-tenant API key and never runs a check itself.
