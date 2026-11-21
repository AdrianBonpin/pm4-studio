# Full Tag Studio — 125 kHz and 13.56 MHz read, write, and library

**Baseline:** 0441edea74a8e91a7a7160eaa36a71fecc95bdac   **Branch:** feat/tag-studio   **Date:** 2026-11-21

## Problem Statement

The Reader currently does two things well: it reads a 125 kHz identity, and it
clones that identity onto a Blank. Everything else the hardware might do is
either unwired or unknown.

That leaves three gaps the user hits immediately.

**Reading 13.56 MHz tells you almost nothing.** A tap yields a UID and a wall of
raw bytes. The tag family, and therefore anything about memory or capability, is
not shown — not because the Reader refuses to say, but because the byte offsets
that would carry ATQA and SAK have never been confirmed against real hardware.

**Nothing survives the session.** A read is a transient screen. A credential that
took effort to identify, or a Blank that was cloned for a coworker, leaves no
record. The existing saved-tag store lives inside webview storage: it cannot be
exported, inspected, or backed up, and it disappears silently if that storage is
cleared. For a tool whose subject is building-access credentials, that is the
wrong durability.

**Writing is one narrow path.** You can clone a tag you already hold. You cannot
create an identity from scratch, cannot write one identity to several Blanks, and
cannot blank a tag to reuse it.

The ambition is the capability set of NFC Tools, applied to tag families this
Reader can actually reach.

## Solution

PM4 Studio becomes a tag studio organised around what a tag *is*, not around
which radio it uses.

**Two durable objects.** A **Snapshot** is what a tag was when it was read — id,
type, decoded fields, timestamp, note — and is never edited afterwards. A
**Draft** is an editable NDEF message with no tag attached, which may be written
any number of times. Keeping these separate is what makes "clone this to five
Blanks" and "keep a record of every credential I have read" both natural instead
of contending for one object.

**A library that outlives the app.** Snapshots and Drafts live in a local JSON
file in the app data directory, browsable with no Reader attached, exportable in
one action, written atomically so a crash cannot corrupt it.

**13.56 MHz that explains itself.** A tap reports the UID, and — when the
ATQA/SAK pair matches a known tag family — the card type, its memory size, and
whether it is NDEF-formatted. When the pair does not match, the app says so and
shows raw bytes rather than inventing a type.

**125 kHz that finishes the job.** Read, clone, batch-clone one identity to
successive Blanks, author an identity by hand, and blank a tag to reuse it.

**Writing that is honest about risk.** Every write shows what it will replace.
Nothing is written blind. A write whose outcome cannot be confirmed is reported
as *unknown*, never as success.

Delivery is four ordered Slices, the last gated on a hardware Spike.

## User Stories

**Reader and connection**

1. As a user, I want the app to tell me clearly when no Reader is attached, so that I know the problem is the cable and not my tag.
2. As a user, I want the Reader to connect without installing a driver or kernel extension, so that the app works on a clean Mac.
3. As a user, I want a second launch of the app to refuse politely rather than fight the first for the device, so that I never see an opaque USB access error.
4. As a user, I want the reader's firmware version visible somewhere, so that I can report what hardware a bug occurred on.

**125 kHz reading**

5. As a user, I want to tap a 125 kHz tag and see its Identity, facility code, and card number, so that I can confirm which credential I am holding.
6. As a user, I want the raw payload available alongside the decoded values, so that I can verify a decode I do not trust.
7. As a user, I want polling to stop while a write is in progress, so that a stale read is never mistaken for a write result.

**125 kHz cloning and authoring**

8. As a user, I want a guided clone flow that requires the source tag to be removed before a Blank is written, so that I cannot overwrite my source credential by leaving it on the reader.
9. As a user, I want the app to refuse to write when it cannot read the tag currently on the Reader, so that a misplaced tag cannot cause a blind write.
10. As a user, I want the app to refuse to write a tag that already presents the target Identity, so that I am protected from the chip-locking case that has already destroyed one Blank.
11. As a user, I want to hold one source Identity and write successive Blanks without re-reading the source, so that producing fobs for several coworkers is not repetitive.
12. As a user, I want each attempt in a batch to report its own result, so that I can tell which fob succeeded and which did not.
13. As a user, I want to author an Identity by entering customer, facility, and card values, so that I can mint a fresh credential rather than only duplicating one.
14. As a user, I want to enter a raw five-byte Identity too, so that I can reproduce a value I already have in hex.
15. As a user, I want out-of-range entries rejected with the valid range shown, so that I do not write a malformed Identity.
16. As a user, I want to blank a tag's Identity so that the tag carries no assigned value, so that I can retire or reuse a fob.
17. As a user, I want blanking described as blanking, so that I am not misled into expecting a factory reset the hardware cannot perform.
18. As a user, I want to be told that a blanked tag may read as empty, so that I do not mistake an expected outcome for a failure.

**13.56 MHz reading**

19. As a user, I want a tap to report the UID, so that I can identify a card.
20. As a user, I want the card type shown when the ATQA/SAK pair matches a known family, so that I know what I am holding.
21. As a user, I want capacity shown only when the ATQA/SAK pair uniquely determines it, and the family named with capacity marked unavailable when several chips share one pair, so that a missing number reads as a hardware limit rather than an app failure.
22. As a user, I want an unrecognised ATQA/SAK pair to show raw bytes and no type, so that the app never presents a guess as a fact.
23. As a user, I want the technologies a tag supports listed, so that I know what operations are plausible on it.
24. As a user, I want a response whose declared length is not the expected one to fall back to raw display, so that an unexpected tag format does not produce garbage decoded as fields.

**Library and snapshots**

25. As a user, I want to save a read as a Snapshot with a name and note, so that a credential I identified stays identified.
26. As a user, I want to rename a Snapshot, so that I can fix a name I chose in a hurry.
27. As a user, I want to delete a Snapshot, with confirmation, so that stale credentials do not accumulate.
28. As a user, I want to browse, search, and sort Snapshots with no Reader attached, so that the library is useful away from the hardware.
29. As a user, I want each Snapshot to record how many times it has been written, so that I know how many copies exist.
30. As a user, I want to export the whole library to a file and import it back, so that I can back it up or move it to another machine.
31. As a user, I want my library to survive app updates and webview storage being cleared, so that it is not accidentally disposable.
32. As a user, I want to see an empty state that explains what a Snapshot is, so that an empty library is not a blank confusing screen.
33. As a user with hundreds of Snapshots, I want the list to stay responsive, so that the library does not become a liability as it grows.
34. As a user, I want to be told the library is local plaintext and never synced, so that I understand where building credentials are stored.

**Drafts and records**

35. As a user, I want to create a Draft, add Records to it, and save it, so that I can prepare a payload before I have a tag in hand.
36. As a user, I want Drafts to persist between sessions, so that work is not lost when I close the app.
37. As a user, I want Drafts shown separately from Snapshots, so that "my tags" always means tags.
38. As a user, I want to author Text, URL, Custom URI, Phone, Email, Contact, SMS, Location, Wi-Fi, and Bluetooth Records, so that the common cases are forms rather than hex.
39. As a user, I want generic MIME and external-type Records, so that the editor is not a dead end for anything not in the list.
40. As a user, I want to add, edit, reorder, and delete Records within a Draft, so that I can compose a multi-record message.
41. As a user, I want to see each Record's encoded size and the Draft's total, against tag capacity when that capacity is known, so that I know whether it will fit before writing.
42. As a user, I want to read a tag's records back into a Draft and rewrite the whole message, so that I can edit what is already there.
43. As a user, I want the app to never pretend to append in place, so that I understand a write replaces the message.

**13.56 MHz writing (gated)**

44. As a user, I want a write to show exactly what it will replace, so that I consent to losing the existing contents knowingly.
45. As a user, I want to write a Draft to a tag and have the result read back, so that success means observed, not assumed.
46. As a user, I want a read-back that cannot confirm the write reported as unknown rather than failed, so that I do not discard a tag that may in fact be correct.
47. As a user, I want to erase a tag's NDEF content, so that I can reuse it.
48. As a user, I want to read a tag's raw memory as a page or block dump with an ASCII view, so that I can diagnose a tag the decoder does not recognise.
49. As a user, I want to export a memory dump to a file, so that I can compare captures across sessions.
50. As a user, I want password set and remove available only after the hardware path is proven, so that an unverified operation cannot make a tag unrecoverable.
51. As a user, I want setting a password to warn plainly that losing it makes the tag unrecoverable, so that the consequence is not a footnote.

**Error and edge behaviour**

52. As a user, I want a Reader unplugged mid-operation to produce a clear message and a clean state, so that I can replug and continue without restarting.
53. As a user, I want an operation that wedges the firmware to tell me to replug, so that I am not left guessing why nothing responds.
54. As a user, I want a write that fails verification to leave the Snapshot's write count unchanged, so that counts mean confirmed copies.
55. As a user, I want a corrupted or unreadable library file to be reported without being overwritten, so that a recoverable file is never destroyed for a clean start.
56. As a user, I want the app to explain once, in one place, which fields this Reader cannot produce, so that I am not shown disabled rows on every tag.

## Constraints & Non-Negotiables

**Platform and stack**

- macOS only. No Windows or Linux build, packaging, or testing in this work.
- Tauri 2, React 18, TypeScript, Vite, bun, Rust with `hidapi`. No new heavyweight runtime dependency.
- NDEF encoding and decoding are implemented in-repo rather than pulled from a crate, so the record set stays auditable and the supply chain stays small.
- The existing gridline design system is binding: its tokens, its Space Mono and Outfit pairing, no overscroll, minimum window 900×700.
- Impeccable design vocabulary is binding: no cards inside cards, no badges that carry no meaning, no copy that restates the obvious, no flattened hierarchy.

**Safety invariants**

- Never write without a successful read of the tag in the write position. This is ADR 0001 and is not overridable by a user setting.
- Never write when the tag in position already presents the target Identity.
- The 125 kHz write payload is always exactly 24 bytes. Shorter payloads wedge firmware until physical replug.
- Every write is preceded by a confirmation naming what will be replaced.
- A write whose read-back fails is reported as *unknown*, never as success and never as a definitive failure.

**Data**

- The library is local plaintext JSON in the app data directory. No cloud sync, no telemetry, no analytics, no network calls.
- Library writes are atomic; a crash mid-write must not corrupt the file.
- Migration from the existing webview store is additive and non-destructive: the old store is left intact until the new file exists.
- A library file with an unrecognised schema version is never rewritten.

**Responsiveness**

- The library list stays interactive at 500 Snapshots. File reads and writes never block on the UI, and no operation blocks the window for longer than a single protocol transaction.
- Every device operation has a bounded wait and reports its own failure. An operation that wedges the firmware must say so and name the remedy — a physical replug — rather than leaving the UI waiting.

**Protocol honesty**

- A capability is only presented as supported once it is verified on real hardware.
- Any field whose offsets are unconfirmed is either omitted or shown as raw bytes. No field is populated from an unvalidated guess.
- The protocol document must mark verified behaviour and unverified behaviour separately, and must not silently promote a hypothesis to a fact.

## Boundaries

**In scope**

- Reader connection, firmware version display, single-instance behaviour.
- 125 kHz: read, clone, batch clone, manual Identity authoring, blanking.
- 13.56 MHz: read, UID, card type for recognised ATQA/SAK pairs, technologies, memory size and NDEF status where confirmed, raw fallback.
- Library: Snapshots and Drafts in local JSON, offline browsing, search, sort, rename, delete, write counts, export and import.
- NDEF authoring for Text, URL, Custom URI, Phone, Email, Contact, SMS, Location, Wi-Fi, Bluetooth, MIME, and external types.
- Record queue editing: add, edit, reorder, delete, size accounting.
- Gated 13.56 MHz write, read memory with dump export, erase, and password set/remove.
- The documentation of this Reader's capability limits, stated once.

**Out of scope**

- Copying an NDEF message from one 13.56 MHz tag to another as a discrete operation.
- Locking a tag permanently read-only, and formatting a tag to non-NDEF.
- MIFARE Classic sector authentication, sector read, and sector write. The protocol exposes no key authentication command, so this is not achievable with this hardware.
- Transparent APDU passthrough, and therefore Signature, authenticated NFC counter, and password-protection status.
- 7-byte and 10-byte UID handling. Such tags show raw bytes and no UID split.
- Writing a T5577 configuration block, and therefore a true factory restore.
- Recovering a tag locked by a previous write, or by an unknown password.
- Windows and Linux targets.
- Any network, sync, or multi-device feature.
- Brute force, key recovery, or credential cracking of any kind.

## Implementation Decisions

**Module responsibilities**

- *Protocol transport* — frame construction, report exchange, and a buffered stream reassembler that parses frames out of a byte stream so responses spanning multiple reports are reconstructed instead of truncated.
- *Identity codec* — pure functions converting between a 125 kHz payload and an Identity, in both the read layout and the write layout, including the four-byte offset shift between them.
- *Write guard* — the fail-closed decision extracted from the transport as a pure function, so ADR 0001 is testable without hardware.
- *HF decoder* — pure function from a 13.56 MHz payload to a result that is either a decoded reading or an explicit raw-only reading.
- *Card type resolver* — a table from ATQA/SAK to card family and, only where the pair is unambiguous, capacity and NDEF capability. Returns nothing for unknown pairs, and returns family-without-capacity where several chips share a pair.
- *NDEF codec* — pure encode and decode for the supported record set, including TNF and length handling.
- *Library store* — load, save, mutate, migrate, export, and import against a versioned JSON file, with atomic replacement.
- *Command layer* — the Tauri boundary that serialises all of the above to the UI.

**Slice order**

Four ordered Slices. Each is shippable and exercisable on its own.

1. **Library** — the JSON store, Snapshots and Drafts, migration from the webview store, offline browsing, export and import. Lands first because every later Slice writes into it, and because the current store must stop being the thing new work is built against.
2. **13.56 MHz read** — the stream reassembler, the HF decoder, the card type resolver, and the capture that settles the ATQA/SAK offsets. Delivers real decoded readings or honest raw fallback.
3. **125 kHz completion** — blanking, manual Identity authoring, and batch cloning on top of the already-proven read and write path.
4. **13.56 MHz write** — gated on the Spike per ADR 0002: NDEF writing, read memory, erase, and password handling.

The Spike is not a Slice. It produces a finding that decides whether Slice 4 begins.

**Reader ownership and exclusion**

The app enforces a single running instance, so two copies can never contend for the exclusive USB handle and surface an opaque access error.


The Reader is a single mutable resource held by the app. All operations acquire one operation lock. Background polling runs only when no operation holds the lock, so a poll reply can never be consumed as a write's result. This is the fix for the current shared-reader race.

**Data model**

Snapshots and Drafts are separate collections in one file, because they answer different questions and one must never be edited while the other is. The shape that encodes the settlement:

```
Snapshot  { id, name, note, kind: LF | HF, capturedAt, writeCount,
            identity?  (customer, data32, facility, card, raw)
            hf?        (uid, atqa?, sak?, cardType?, technologies,
                        memory?, ndefFormatted?, records?, raw) }
Draft     { id, name, updatedAt, records: Record[] }
Record    { kind, fields, byteLength }
```

`writeCount` is a number, not a list of physical tags — decided deliberately. `identity` and `hf` are optional and mutually exclusive in practice, which is what keeps one collection serving both bands without a discriminated union the UI has to unwrap everywhere.

**Decode policy**

The HF decoder returns decoded values only when the ATQA/SAK pair resolves in the card type table *and* the payload length matches the expected shape. Otherwise it returns a raw-only reading with no card type, no capacity, and no technologies.

Capacity is populated only where the ATQA/SAK pair uniquely determines it, as MIFARE Classic 1K versus 4K. Where several chips share one pair and differ only in capacity — the NTAG21x range is exactly this case, since its capacity requires a command this Reader does not expose — the app names the family and states that capacity is unavailable. A guessed capacity is worse than a missing one, because capacity determines how many bytes a write would send.

**Write result semantics**

A write produces one of four outcomes: refused (guard), written and verified, written but unverified, or failed to transmit. Only the second increments a Snapshot's write count. The third is presented as "unknown", with instructions, not as an error.

**Record composition**

Records are queued in the UI and written as one complete NDEF message. There is no in-place append, matching how the reference product behaves and how the tag families actually work.

## Testing Decisions

**Approved seams**

| Seam | Catches | Misses |
|---|---|---|
| S1 Frame codec — construction, parsing, checksum | Checksum and layout regressions, padding errors | All device state |
| S2 Report stream reassembler | Multi-report reconstruction, partial frames, desync | Whether hardware emits them this way |
| S3 Identity codec — read and write layouts | Facility and card arithmetic, the four-byte write shift, endianness, 24-byte length | Whether the device accepts the payload |
| S4 Write guard — pure decision | Refuse-when-unreadable, refuse-when-source-unchanged | Actual chip locking behaviour |
| S5 HF decoder | Offset handling, ATQA byte order, UID extraction, length-mismatch fallback | **Whether the offsets are correct** — only a hardware capture settles that |
| S6 Card type resolver | Table errors, unknown pairs returning nothing | Vendor-specific SAK variants |
| S7 NDEF codec | Round-trip per record type, TNF and length correctness | Real tag behaviour |
| S8 Library store | Persistence, atomic replace, corruption handling, migration | UI state |

**What a good test looks like here**

Tests assert public behaviour through the seam, with expected values written down independently — a captured frame in the test fixture, not a value the code produced. No test mocks an internal collaborator; the pure seams take bytes and return values, and the library store takes a file path. Where hardware is required, the test is a scripted probe rather than a unit test, and its output is treated as a finding.

**Prior art**

The transport already has Rust unit tests using real captured frames as fixtures, covering checksum, frame layout, and a live no-tag response. The probe and capture binaries under the Rust examples exist for hardware interrogation and are the model for Spike work. Both patterns extend to the new seams.

**E2E: OPTED-OUT**

Browser E2E automation is explicitly not adopted. This is a desktop app whose correctness lives at a hardware boundary that browser automation cannot reach, so automated UI tests would exercise a mocked reader and assert little of value.

Replacing it is a per-Slice manual hardware checklist, run on the real Reader:

1. Read a 125 kHz tag, confirm Identity and facility/card decode against the raw payload.
2. Clone to a Blank, confirm the read-back matches, and confirm the physical credential works at its reader.
3. Attempt a clone with the source tag left in place; confirm refusal, not a write.
4. Batch clone, confirming each attempt reports separately.
5. Blank a tag, confirming the reported outcome matches what a subsequent read shows.
6. Tap a 13.56 MHz tag, confirm the decoded card type against an independent source, or confirm raw-only display for an unknown family.
7. For the gated Slice: read memory, write a Draft, read back, and confirm the records survive round-trip.

## Migration & Rollback

**Migration.** On first launch after this change, the app reads the existing webview saved-tag store and, if the library file does not yet exist, writes those entries as Snapshots into the new file. The old store is left in place and not cleared, so a failed migration loses nothing and the user can re-run it. Entries that cannot be mapped cleanly are preserved as raw-only Snapshots rather than dropped.

**Schema versioning.** The library file carries a version. A file with a newer version than the app understands is never rewritten; the app reports the mismatch and offers an export path. A file that fails to parse is reported and left untouched, never replaced with an empty one.

**Rollback.** The change is additive to a working app. Removing the library file returns the app to an empty library without affecting the Reader. The pre-existing clone path continues to function throughout, so a regression in the new surface does not remove the capability that works today. Because the write guard and the 24-byte payload invariant are preserved unchanged, rollback carries no safety regression.

## Domain Model

**Glossary.** `GLOSSARY.md` is created by this work. Sixteen terms are canonical: Reader, Tag, Blank, Snapshot, Draft, Record, NDEF message, Identity, UID, Clone, Reset, Card type, Frame, Command, Spike, Slice.

Five ambiguities were resolved during this work and are recorded there:

- "badge" meant both the user's building credential and any tag → **Tag**.
- "reset" meant factory restore, identity blanking, and unlocking → **Reset** is blanking only; the other two are impossible here.
- "record" meant both a library entry and an NDEF record → **Snapshot** and **Record**.
- "clone" meant both identity copying and NDEF copying → **Clone** is 125 kHz only.
- "blank" meant both a product category and a state → **Blank** is a state.

**ADRs.**

- `0001` — Refuse to write 125 kHz tags unless the tag can be read first. Records why the fail-closed guard exists and why it must not be removed as a convenience fix.
- `0002` — Gate 13.56 MHz write behind a hardware spike rather than committing to it. Records why the spec contains a conditional Slice and what the documented outcome is if the spike fails.

## Open Questions

| Question | Owner | Must resolve before |
|---|---|---|
| ATQA/SAK offsets at payload 14–16 and 17 — hypothesis only, contradicted by the one redacted frame available | Hardware capture with a real 13.56 MHz tag | HF decode Slice ships. Until then decode is raw-only. |
| Whether 7-byte and 10-byte UIDs change the payload length or tail layout | Hardware capture with an NTAG | Any claim about UID completeness. Out of scope for now: such tags show raw. |
| Whether NTAG commands 0x0081–0x0085 work on this Reader at all | The Spike, per ADR 0002 | Gated write Slice begins. If negative, HF stays read-only and that is the recorded outcome. |
| What sets the T5577 lock bit, and whether a blanking write can trigger it | Protocol research plus careful hardware probes on sacrificial Blanks | Blanking is offered as anything other than destructive-with-warning. |
| How to distinguish two identical Blank tags across batch attempts | Engineering, during the LF Slice | Batch mode claims per-attempt certainty. Until then, results are per-attempt and require re-seating. |
| Meaning of the constant `C8 42` in the 125 kHz read payload | Optional protocol research | Nothing. Recorded for completeness. |

---

# Post-Implementation Defects (2026-11-22)

This section is additive. Everything above it stands as approved and is not reopened.
It records five defects found after all twenty-two tickets were implemented, each
against a requirement already stated in this document, and the three decisions that
were needed before they could be fixed. It authorises no new capability.

The defects are grouped by what they cost: two throw away user work, one destroys it
permanently through a downgrade, one bypasses the safety model, and one leaves the
safety model unproven. Stories continue from 56 so the set stays contiguous. They are
labelled inline as `Story 57` onwards rather than numbered as list items, because each
is followed immediately by the criteria it has to satisfy.

**ADRs in force after this section:** `0001` fail-closed writes, `0002` HF write gate
(now cleared by hardware evidence), `0003` blanked is its own outcome, `0004` batch
clone skips and counts once, `0005` a new persisted key bumps the schema version,
`0006` the raw console is read-only in release builds.

## D1 — A Draft edit can be lost by quitting

**Violates.** Story 36: *"As a user, I want Drafts to persist between sessions, so
that work is not lost when I close the app."*

**Defect.** Edits are applied to the view immediately and written to disk after a
350 ms quiet period. Anything still queued is flushed when the page unmounts, which
covers navigating away but not closing the window: closing the window is not an
unmount, so a queued write dies with the process. A user who types and quits within
the delay loses the edit, and nothing told them a save was pending.

**Decision.** No new ADR. The requirement already exists; the flush trigger does not.

**Story 57.** As a user, I want anything I have typed to be on disk before the window
closes, so that quitting the app never costs me the last edit.

- [ ] An edit followed by window close inside the quiet period is persisted.
- [ ] Quitting never writes a stale or partial Draft.
- [ ] Navigating away still flushes, exactly as it does today.
- [ ] The Draft reads back identically on the next launch.
- [ ] If the final save cannot be written, the window does not close silently — the
      problem is reported and the user chooses whether to quit anyway.

## D2 — Two save paths serialise against different locks

**Violates.** The data constraint: *"Library writes are atomic; a crash mid-write
must not corrupt the file."* Atomicity per write is upheld — both paths stage and
rename the whole file, so no interleaved bytes are possible. What the constraint's
intent does not survive is the second half of atomicity: a save racing another save
can lose an entire update, because the two paths do not share a serialisation domain.

**Defect.** The library store holds one lock, the import/export path holds another,
and both replace the whole file. Each is individually safe and jointly unsound: two
saves overlapping in time can each read the same starting state and each rename a
file reflecting only its own change. Nothing reports a problem, because from either
path's point of view the write succeeded.

**Decision.** No new ADR. One file, one serialisation domain, is not a trade-off.

**Story 58.** As a user, I want two saves that happen close together to both be kept,
so that saving in one part of the app never silently discards a save from another.

- [ ] A single serialisation domain governs every write to the library file.
- [ ] A Draft save and a Snapshot save in quick succession both land.
- [ ] Overlapping saves queue rather than fail.
- [ ] The file parses after any interleaving of the two paths.
- [ ] No path reaches the file without the lock.

## D3 — An older build silently strips Drafts

**Violates.** The data constraint: *"A library file with an unrecognised schema
version is never rewritten."* The version was recognised — it was still `1` — while
the file's contents had outgrown what that version promised. And the Migration
section: *"A file with a newer version than the app understands is never rewritten;
the app reports the mismatch and offers an export path."* That protection exists and
was never reached, because nothing declared the file newer.

**Defect.** Drafts were added to the file while `SCHEMA_VERSION` stayed `1`, on the
reasoning that a bump would make existing files unreadable. `#[serde(default)]` made a
new build read an old file correctly, so the change looked safe. The reverse direction
was not considered: an older build deserialises the file into a struct with no
`drafts` field, drops the unknown key without comment, and rewrites the file without
it. Every Draft is lost, the library still parses, and the Snapshots are intact, so
nothing looks wrong. The window is open until the file is first re-saved.

**Decision.** ADR 0005. `SCHEMA_VERSION` becomes `2`, and a v1 file is migrated on
first successful open, eagerly and preserving every key, so the file's stated version
agrees with its contents immediately rather than at the next save. The general rule
recorded there: a new persisted key is a schema change, and a schema change bumps the
version — `#[serde(default)]` tolerates absence, not strangers.

**Story 59.** As a user, I want a library file written by a newer build refused rather
than rewritten, so that opening the app with an older version cannot destroy my
Drafts.

- [ ] A v2 file opened by a build that understands only v1 reports a version mismatch
      and is not rewritten.
- [ ] A v1 file is migrated to v2 on first successful open with every key preserved.
- [ ] After a successful open the file on disk claims v2.
- [ ] Migration happens before the user can edit, so no edit is applied to a library
      that is about to be rewritten.
- [ ] A failed migration write is reported, and the app continues with the migrated
      library in memory rather than refusing to open.
- [ ] The migrated library holds the same Snapshots and the same Drafts as before, in
      the same order.
- [ ] Drafts written by this build survive an attempted downgrade.

## D4 — The raw console bypasses every write guard

**Violates.** The safety invariant: *"Never write without a successful read of the tag
in the write position. This is ADR 0001 and is not overridable by a user setting."*
And: *"Never write when the tag in position already presents the target Identity."*
The raw console is a user setting in effect: it sends whatever it is given, including
`0x0073` and `0x0082`, consulting neither rule. `0x0082` reaches config pages 131, 133
and 134 — the only action in the app that can make a tag permanently unusable.

**Defect.** The console was built to interrogate the protocol and is the instrument
that produced every verified frame in `PROTOCOL.md`. Its reach was never restricted
once the guarded surfaces were built around it, so the app ships with a supported path
that reaches past all of them.

**Decision.** ADR 0006. Release builds accept only commands that cannot alter a tag's
contents — the reads, the version and firmware queries, the poll, and the Reader's own
beep and LED. The list is closed: a command absent from it is refused. Debug builds
keep the full range, so protocol work continues from a terminal rather than from the
app the user runs daily.

**Story 60.** As a user, I want the raw console in the shipped app to send only
commands that cannot change what a tag holds, so that a typed frame cannot destroy a
tag.

- [ ] Release builds refuse `0x0073`, `0x0082`, and every command not on the list.
- [ ] A refusal names the command and says write experiments run in a development
      build.
- [ ] The console states that it is read-only before it is used, not when a frame is
      refused.
- [ ] Debug builds still send any command.
- [ ] The allow-list is closed, so a newly discovered opcode is refused until someone
      states why it is safe.
- [ ] Every allow-listed command still works for diagnosis.
- [ ] A guard refusal and a console refusal are distinguishable to the user: one is
      about the tag in position, the other about the build.

## D5 — Destructive confirmations are never exercised

**Violates.** The testing decision: *"Tests assert public behaviour through the seam,
with expected values written down independently"*, and *"No test mocks an internal
collaborator."* Every destructive confirmation in this app is public behaviour and
none of them is asserted. The library store seam table lists UI state under **Misses**
for `S8`, and it was left there rather than closed.

**Defect.** The test suite renders no component. Delete a Snapshot without
confirming — the flow read correctly during review and is not proven by anything. A
control could be wired straight to the removal call, dropping the confirmation
entirely, and all tests would still pass. Eight gates are in this position: Snapshot
delete, Draft delete, clone, author, blank, write a Draft, erase, and password.

This was opted out of deliberately at the time. *"E2E: OPTED-OUT"* rejected browser
automation driving a real browser against a mocked reader, and that judgement stands.
It did not follow that confirmations could go unproven, and the two were treated as
one decision when they are two.

**Decision.** Add a DOM component harness — `jsdom` with `@testing-library/react` —
under the existing Vitest runner. This is not a reversal of the E2E opt-out: no
browser is launched, no device is mocked at the transport boundary for the whole app,
and the manual hardware checklist is unchanged. It is a unit test that renders one
component and drives its controls, which is what proves a confirmation is attached.

**Story 61.** As a maintainer, I want each destructive confirmation proven by driving
the interface, so that removing a confirmation fails a test instead of passing review.

- [ ] Dismissing a confirmation leaves the target intact, proven by clicking the
      destructive control and asserting nothing was removed.
- [ ] Confirming performs the action.
- [ ] The same pair of proofs exists for all eight gates.
- [ ] Removing a gate from its control fails at least one test.
- [ ] Components render without a Tauri backend; device calls are stubbed at the
      invoke boundary, not by mocking internal modules.
- [ ] The suite still runs as one command, with no browser download.

## Deliberately not addressed

Recorded so that their absence reads as a decision rather than an oversight. Each is
a genuine observation that does not currently cost a user anything.

- `parse_frame` and `ReportStream` both parse frames. Two parsers, one of which is on
  the hot path and one of which is the reference. Converging them is a cleanup.
- `Evidence::Declined` is never constructed. It is a variant waiting for the path that
  would produce it, not a bug.
- `FrameCutter` does not resynchronise. The reassembler does; the cutter is used where
  a desynchronised stream is already fatal.
- `LibraryPage` is around five hundred lines. Large, cohesive, and not yet a problem.
- There is no TypeScript type corresponding to the Rust `Identity`. The wire shape is
  flat and the boundary is narrow.
- `BlankFact`, `EraseFact`, `PasswordFact` and `AuthorFact` duplicate one shape. They
  are four narrow types that would become one wide type with four optional halves.

**Still open on hardware, tracked separately:** whether a blanked T5577 accepts
further writes, what sets the T5577 lock bit, whether a 124-page message fills, what a
mid-write page reporting state `4` means, and the `localStorage` to file migration
bridge that only runs inside the webview. These belong to the protocol document and
to the hardware issue, not to this section.
