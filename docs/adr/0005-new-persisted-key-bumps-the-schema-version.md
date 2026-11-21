# 0005: A new persisted key requires a schema version bump

**Status:** Accepted
**Date:** 2026-11-22

## Context

Drafts were added to the library file after the file already existed in the world,
and `SCHEMA_VERSION` stayed at `1` deliberately. The reasoning was sound as far as
it went: bumping would have made every existing library file — including the one
on this machine — unreadable by the new build, so the new build would have refused
the user's own data in order to protect it. Adding the field with `#[serde(default)]`
let an old file gain an empty `drafts` list on read, and the version claim stayed
honest in the only direction anyone was looking.

That reasoning protects one direction and ignores the other.

- **Forwards** (this build reads an old file): `#[serde(default)]` works. A file
  without `drafts` deserialises to an empty list, and `version: 1` is a true
  statement about what the build understands.
- **Backwards** (an old build reads this file): nothing works. An older build
  deserialises the file into a struct that has no `drafts` field, `serde` drops
  the unknown key silently, and the next save writes the file back without it.
  The old build is not misbehaving — it is doing exactly what it was written to
  do. The version number said "same format", so it replaced the file.

The loss is total and unannounced: every Draft disappears, the library still
parses, and the Snapshot collection is untouched, so nothing looks wrong.

Two facts about the existing code shape the response.

1. `parse_library` already refuses a file whose version exceeds what it
   understands, and reports the mismatch without rewriting. The protection
   mechanism exists, is tested, and was simply not invoked.
2. `LibraryProblem::OlderVersion` already exists and already refuses. Today it
   fires for any older file, which means v1 files must be handled explicitly
   rather than falling into a general "too old, refusal" path.

Recovery cost is currently zero: the population of library files written by an
older build is one file, on one machine, with no users who could downgrade.

## Decision

**Bump `SCHEMA_VERSION` to 2, and migrate v1 on read.**

The rule that follows from this, and outlives the specific bump:

> **A new persisted key is a schema change, and a schema change bumps the
> version.** `#[serde(default)]` is for tolerating *absence*, not for tolerating
> *strangers*. It makes a new build read an old file; it does nothing to stop an
> old build from overwriting a new one.

A version bump is the only mechanism that makes an older build stop and report
instead of silently rewriting. It is not a formality to be skipped when the change
feels small.

**Migration is eager, not lazy.** A v1 file is read, lifted to v2 in memory with
every key preserved, and written back as v2 through the existing atomic save path
on the first successful open — before the user can touch anything.

The alternative was to migrate lazily, rewriting as v2 whenever the user next
saved. That leaves the file claiming `version: 1` while containing a `drafts` key
the old format never had, which is precisely the state that loses data. The window
between opening a v1 file and saving it is the entire window in which an older
build can still strip it, and there is no reason to hold it open. Correcting the
version claim on open makes the file's contents and its stated format agree at the
earliest possible moment.

**A failed migration write is reported, not fatal.** If the v2 rewrite cannot be
written, the app keeps working with the migrated library in memory and reports the
file problem. Refusing to open the user's data because it could not be re-saved
would trade a small risk for a guaranteed loss.

**`OlderVersion` is retained but stops firing for v1.** After this change, v1 is
migrated rather than refused, so the variant becomes unreachable for any version
this build can lift. It stays in the type for a file older than the oldest
migration this build carries — currently hypothetical — because deleting it would
mean that a future v0 file falls through to `Corrupt` and the user is told their
file is damaged when it is merely old.

**Future field additions inherit the obligation.** Adding a field to an existing
object with `serde(default)` is still fine *within* a version, because nothing is
dropped: the field is present in the struct. Adding a new collection, or any key a
previous build's struct does not model, requires a bump. The distinction is
whether an older build would have somewhere to keep the value, not whether the
value is optional.

## Consequences

- An older build opening a v2 file reports a newer-version mismatch and offers an
  export, instead of rewriting Drafts out of existence. The failure is loud,
  non-destructive, and recoverable.
- Anyone who downgrades loses the ability to use the library until they upgrade,
  and is told why. That is a worse-sounding outcome and a better one: the data
  survives.
- The migration runs once per machine. After the first open there is no v1 file
  left, so the code path that handles v1 becomes immediately cold — it needs its
  own test fixture rather than waiting to be exercised in the field.
- Three locked doors now guard the same data: version refusal, the "may this file
  be replaced?" check preceding a save, and the atomic stage-and-rename. Only the
  first was missing, and only because a version bump looked like more ceremony
  than the change deserved.
- The cost of this policy is paid at every future addition: a bump means thinking
  about migration before writing the field. That is the intended cost. The defect
  this ADR responds to was not a wrong risk assessment — it was a risk nobody
  assessed, because the serialiser made the omission invisible.
