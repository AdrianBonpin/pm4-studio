# Contributing to PM4 Studio

One page: what this repository expects of a commit, of a pull-request title, and
of the path a change takes to `prod`. It describes the convention; it does not
build a machine around it. Nothing here is enforced (see [Nothing enforces
this](#nothing-enforces-this)).

## The host

This repository lives on **GitHub**. `origin` is
`git@github.com:AdrianBonpin/pm4-studio.git`, and pull requests are opened and
merged with the [`gh`](https://cli.github.com) CLI. That is a deliberate
exception to the Gitea/`tea` arrangement the author uses for his other projects:
do not carry the Gitea conventions over here, and do not open a pull request
against a mirror.

`prod` is the trunk. Every change reaches it the same way.

## The flow

1. Branch from `prod`.
2. Commit on the branch.
3. Open a pull request against `prod`.
4. **Squash-merge** it.
5. Delete the branch, locally and on the remote.

```sh
git switch prod && git pull
git switch -c fix/badge-write-checksum      # branch name: yours to choose
# ... commit ...
git push -u origin fix/badge-write-checksum
gh pr create --base prod --title "fix(protocol): verify the checksum before writing"
gh pr merge <number> --squash --delete-branch
```

**`prod` is never committed to directly.** No commit lands on it except as the
squash-merge of a pull request. A branch exists to be merged and then deleted,
not to live alongside the trunk.

## Commit messages

This repository follows [Conventional Commits
1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The shape is:

```
<type>[(scope)][!]: <subject>
[blank line]
[optional body]
[blank line]
[optional footer(s)]
```

### Types

Exactly these eleven, and no others:

| Type | For |
| --- | --- |
| `feat` | a new capability in the app |
| `fix` | a defect repaired |
| `docs` | documentation only |
| `style` | formatting, whitespace, layout of code or of the interface, with meaning unchanged |
| `refactor` | code reshaped without fixing a bug or adding a capability |
| `perf` | the same behaviour, made faster or lighter |
| `test` | tests added or corrected |
| `build` | the build system, dependencies, bundling |
| `ci` | automation that runs the checks |
| `chore` | upkeep that touches neither `src/` nor the tests |
| `revert` | undoes an earlier commit |

There is no `wip`, no `hotfix`, no `feature`, no `update`, no `misc`, and no
type invented for a change that felt like it needed one. If a change does not fit
the table, it is not a reason for a twelfth type: pick the closest of the eleven.

### Scopes

A scope is **optional**. It names the part of the app a commit moves, and it is
drawn from this app's own vocabulary:

`lf` · `hf` · `library` · `drafts` · `settings` · `tools` · `reader` ·
`protocol` · `ui` · `design` · `docs` · `e2e`

```
feat(lf): read the EM4100 facility code from the trailing bytes
fix(hf): report the UID length the poll reply states
docs(protocol): record the 0x0073 payload layout
chore: bump the Tauri toolchain
```

`lf` and `hf` are the two band modes. `reader` is the USB HID transport and the
device layer. `protocol` is the frame format and the command set. `library`,
`drafts`, `settings` and `tools` are destinations. `ui` is the shared interface
components, `design` is the gridline tokens and `DESIGN.md`, `docs` is the
documentation, ADRs and tickets, and `e2e` is the verification corpus — the
reports and screenshots under `docs/superpowers/e2e/`. If no scope fits, leave it
out — an empty scope is better than an invented one.

### The subject

The subject is the one line after the colon and space, and it obeys all of:

- **imperative mood** — `add`, not `added` or `adds`; the subject completes
  "this commit will …".
- **lowercase** — no capital after the colon, unless a proper noun or a code
  identifier needs one.
- **no trailing period.**
- **72 characters at most**, the type and scope included.

```
fix(library): name a snapshot from the tag it was read from
```

not

```
Fixed the Snapshot naming bug.
```

### Breaking changes

A change that breaks something a caller or a stored file depends on is marked in
two places: a `!` before the colon, and a footer that names the break.

```
feat(protocol)!: drop the padded 0x0073 payload the old reader accepted

BREAKING CHANGE: frames captured before 0.9 carry a padding byte that is now
rejected. Re-capture the frame before replaying it.
```

The `!` is what a reader scanning history sees; the footer is what tells them
what to do about it. Neither is optional, and one without the other does not
count as a marked break.

## Pull-request titles

**A pull-request title is a Conventional Commit subject.** The same type, the same
optional scope, the same imperative lowercase line, the same 72-character
ceiling — and the `!` plus footer when the merge is a breaking change.

The reason is mechanical: the merge is a squash, so the pull-request title
becomes the commit subject on `prod`. There is no second chance to write it
afterwards, and no merge commit's body to soften it. A title of "Switcher
polish" becomes `Switcher polish` in the log forever; a title of
`feat(ui): one switcher shape at all six call sites` becomes a subject a stranger
can read.

The pull request's description is prose and is not part of the commit — say
whatever helps a reviewer there. GitHub may also append a `(#123)` to the squash
subject; that suffix trails the subject and changes neither its type nor its
scope.

## When this applies

From the day this file lands. History before it does not follow the convention
and **is not rewritten**: the log holds subjects such as `Full tag studio: 125
kHz + 13.56 MHz read, write, and library (#1)` and `Studio Redesign: one outcome
seam, five destinations, honest decode (#31)`, and they stay exactly as they are.
They predate the guide, and their absence from the convention explains itself
rather than inviting a rewrite. The convention governs commits and pull-request
titles from here on.

## Nothing enforces this

Say it plainly, because the absence is easy to misread: **there is no commit
hook, no status check, no CI job, and no test that reads a commit message or a
pull-request title.** `bun run verify` checks the code, not the wording. Nothing
will reject a bad subject or block a merge over one.

That is a decision, not an oversight. The guide is verified by being read, and a
pull request whose title drifts from it is a review matter — something a person
notices and asks to have fixed, not something a gate catches. Do not infer
enforcement that does not exist, and do not add it without changing this
paragraph.

## Before you open a pull request

Run the gate and let it finish:

```sh
bun run verify         # design check, types, build, tests, Rust tests
```

It runs, in order:

```sh
bun run build          # design:check -> tokens:check -> tsc --noEmit -> vite build
bun run test           # vitest, with jsdom for component tests
bun run verify:rust    # cargo test in src-tauri
```

The **design check is part of `bun run build`**, so a rule the vendored detector
encodes fails the build and therefore fails `verify`. It is not a separate step
somebody has to remember, and it is not advisory. While iterating, the fast steps
are `bun run design:check`, `bun run tokens:check`, `bun run typecheck` and
`bun run test`; the Rust step is the slow one, and it stays in the gate because
nothing is verified by memory.

A pull request that has not run `bun run verify` is not ready to be reviewed.
