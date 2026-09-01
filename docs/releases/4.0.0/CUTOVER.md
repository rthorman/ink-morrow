# 4.0.0-beta.1 unrelated-history cutover

This is the reviewed mechanical procedure for PR 19. It joins the historical
3.x `main` line to the independent AGPL-licensed 4.0 release without ever
merging or rebasing `main` into `release/4.0.0`.

## Preconditions

1. The release-candidate metadata commit is merged into `release/4.0.0` after
   its clean-checkout CI is green.
2. Record the immutable remote tips as `M = origin/main` and
   `R = origin/release/4.0.0`.
3. Confirm `git merge-base M R` has no result. Any shared ancestor is a hard
   stop.
4. Confirm the release evidence has no unresolved critical/high supported-path
   finding. Manual items that remain pending must stay visible and must not be
   reported as observed.

## Construct the cutover commit

Create a dedicated branch at `M`, then create one commit with:

- tree: exactly `R^{tree}`;
- first parent: exactly `M`; and
- second parent: exactly `R`.

The equivalent plumbing operation is:

```bash
tree=$(git rev-parse "$R^{tree}")
cutover=$(printf '%s\n' 'Cut over main to ScribeTribe 4.0.0-beta.1' |
  git commit-tree "$tree" -p "$M" -p "$R")
git update-ref refs/heads/pr/19-main-cutover "$cutover" "$M"
```

No checkout merge strategy is trusted to choose the release tree implicitly.
The tree and both parents are supplied explicitly and verified afterward.

## Required verification

```bash
test "$(git rev-parse "$cutover^{tree}")" = "$(git rev-parse "$R^{tree}")"
test "$(git rev-parse "$cutover^1")" = "$M"
test "$(git rev-parse "$cutover^2")" = "$R"
test "$(git rev-parse origin/release/4.0.0)" = "$R"
```

Push only the cutover branch, open a pull request to `main`, and run the full
clean-checkout CI on that exact commit. The release branch must not move as a
side effect of the main PR.

## Tag and release

Create `v4.0.0-beta.1` only on the merged main cutover commit, after required
CI and the final release-owner decision are recorded. Publish
[RELEASE-NOTES.md](RELEASE-NOTES.md) and attach checksums for any distributed
artifacts. A source-only release has no invented archive checksum.

## Rollback

Rollback the application by checking out the preserved pre-cutover first
parent and using its untouched 3.x data, or by restoring a tested complete 4.0
`DATA_DIR` backup with the reviewed 4.0 build. Never point 3.x at a 4.0
database and never reinterpret a 3.x database with 4.0.
