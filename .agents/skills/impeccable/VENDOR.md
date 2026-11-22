# Vendored: Impeccable

This directory is a copy of upstream **Impeccable** — the design skill and its
detector — vendored so that anyone who clones PM4 Studio gets the same rules
without installing anything first.

| | |
| --- | --- |
| Upstream | https://github.com/pbakaus/impeccable |
| Project page | https://impeccable.style |
| Version | skill `4.10.0` (engine pinned at `0.1.27` by `scripts/VERSION`) |
| Upstream tag | `skill-v4.10.0` |
| Upstream commit | `b49177d32788f2dc585c42831d845dacf1ebed2c` |
| Licence | Apache-2.0 — see `LICENSE` |
| Third-party notices | see `NOTICE.md`, copied unmodified from upstream |

## What was copied

The upstream repository's portable **Agent Skills** variant, verbatim:
`.agents/skills/impeccable/` at that tag, including `SKILL.md`, `reference/`,
`agents/`, and `scripts/` with its pinned engine checksum manifest.

## What was not copied

- **The engine binary.** `scripts/impeccable` finds a platform binary, and on a
  developer machine that has never run it, downloads the pinned version once into
  `~/.impeccable/bin/<version>/`, verified against
  `scripts/engine-checksums.txt`. Nothing is downloaded at app runtime, and
  nothing is bundled: the detector is a development tool.
- **Provider hook manifests** (`.agents/hooks.json`, `.claude/`, `.cursor/` and
  the rest). This repository runs the detector as an explicit package script,
  `bun run design:check`; nothing runs automatically on file edits.
- **The other provider variants** of the same skill tree (each harness's own copy
  of the reference files). The `.agents/` variant is the portable one.

## Updating

Replace this directory with the `.agents/skills/impeccable/` tree from the newer
upstream tag, keep `LICENSE` and `NOTICE.md` beside it, and update the table
above. Then:

```bash
bun run design:check
```

Read the diff before merging: these are markdown instructions an agent will
follow, and a renamed detector rule will fail the check until the repository's
allow-list (`scripts/design-allow-list.json`) is brought up to date.
