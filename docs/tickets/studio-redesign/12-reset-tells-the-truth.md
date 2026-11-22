# 12: The Identity-overwrite operation tells the truth; a refusal is its own outcome

> **Naming note (2026-11-22, after this ticket was done).** This ticket was written
> when the operation was called **Reset** and was a single, destructive write. Its
> *substance* stands unchanged — a confirmation that states the writability limit
> before the write, and a refusal that is its own outcome. Its *naming* does not:
> the operation split into **Clear** (the everyday one, which writes a placeholder
> and leaves the tag usable) and **Destroy** (the deliberate, destructive one,
> behind its own gate), and the interface no longer says "Reset" at all. Wherever
> this ticket says "Reset", read "the Clear/Destroy write" — the destructive write
> it originally described is Destroy. See
> [`clearing-a-tag-must-leave-it-usable.md`](../studio-redesign-followups/clearing-a-tag-must-leave-it-usable.md)
> and `GLOSSARY.md`.

**What to build:** The operation stops reporting a consequence as though it were a surprise. Before the write it says plainly that this Reader cannot tell whether a tag will accept a write, that a tag already written once may refuse forever, and that the attempt is safe only on a tag you can afford to lose. When the tag refuses, the app says the tag will not accept writes and names the likely cause.

**Blocked by:** 04, 11

**Seams:**
- Write outcome classification (extended) — catches a refusal reported as a generic failure, as unverified, or as blanked; misses why the chip refused.
- Signal vocabulary (existing) — catches the refusal not reaching the attention symbol; misses whether the buzzer sounded.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/23
**Status:** done

- [x] The confirmation states the three caveats before the write, in plain words, not as a footnote.
- [x] A re-read that still finds an Identity produces its own outcome — the tag will not accept writes — separate from a generic failure and separate from unverified.
- [x] That outcome's message names the likely cause: the chip has already been written, or was never writable.
- [x] That outcome emits the attention symbol, including the LED held on for two seconds.
- [x] No outcome of this operation ever counts a confirmed copy.
- [x] The capability limits record, once, that 125 kHz writability cannot be determined without attempting a write, so its absence reads as a documented limit.
- [x] No writability probe exists anywhere in the app, including one hidden behind an acknowledgement or on a diagnostics surface.
- [x] A never-written tag is still overwritten successfully, and its success is never reported as verified.
      *Corrected after the split:* the criterion read "reported as blanked rather
      than verified". A Clear's success is now `cleared` — the read-back presents
      the placeholder, which is a positive confirmation — and a Destroy's is
      `destroyed`, whose confirmation is an absence. Neither is `verified`, because
      neither places a copy; both are covered by
      `src-tauri/src/write_outcome.rs` and `src/lib/clearTag.test.ts`.
- [x] Nothing in the interface invites a pre-check, because none exists.

## Note (2026-11-22) — which refusal is which

Criterion 2 is about a write the **chip** refused: the write was sent and its
re-read did not show what was written, so the outcome is *will not accept writes*.
That is not what a second overwrite of a Tag that already carries no Identity
produces. That Tag has nothing to destroy, so a **Destroy** is refused **before
anything is sent** (`ClearDecision::RefuseNothingToDestroy`, reported as
`Refused`): there is nothing to destroy, and nothing was learned about the chip. A
**Clear**, by contrast, proceeds — it has a placeholder to give a Tag that carries
nothing, and nothing of the user's to lose.

The two are distinct outcomes (`WriteOutcome::Refused` vs
`WriteOutcome::WillNotAcceptWrites`), and only the second needs a transmission as
its evidence. The runbook's item 5 and the follow-up ticket
`resets-refusal-was-never-seen-on-hardware.md` now keep them apart; the spec's item
11 has been rewritten for Clear and Destroy.
