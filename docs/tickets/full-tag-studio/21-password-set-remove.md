# 21: Password set and remove

**What to build:** Password protection can be set and removed on a supported tag, behind a confirmation that states plainly that losing the password makes the tag permanently unrecoverable, and requires explicit acknowledgement rather than a default-accepted dialog.

**Blocked by:** 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches password payload construction and outcome classification; misses real lock semantics on the chip.

**Tracker:** None
**Status:** done — the safe half only. Setting is refused by construction; see "Outcome".

- [ ] A password can be set, and protected access afterwards behaves as expected.
- [ ] Removing the password with the same value restores unprotected access.
- [x] The confirmation states the tag becomes permanently unrecoverable if the password is lost, and requires explicit acknowledgement.
- [ ] A wrong password produces a clear error rather than a wedge.
- [x] The user is told, at the point of setting, what happens if the password is not recorded anywhere.
- [x] A tag whose password is unknown is never presented as recoverable.

## Outcome

**Setting a password is refused. So is removing one.** Not for want of effort, and
not behind a flag that can be flipped: the decision function returns
`Result<Infallible, PasswordRefusal>`, so "allowed" is not a value the type system
will let any caller hold (`src-tauri/src/password.rs`).

Two independent facts force this, and either one alone would be enough.

### 1. The protocol has no authentication command

`docs/PROTOCOL.md` is the whole command family: `0x0083` info, `0x0081` memory
read, `0x0082` write, `0x0085` progress, `0x0084` format (not attempted). There is
no `PWD_AUTH`, no MIFARE key authentication and no APDU passthrough.

Password protection on an NTAG21x is three configuration pages — `AUTH0` on page
131, `PWD` on 133, `PACK` on 134. Writing them is how protection is switched on,
and once `AUTH0` names a page, every access at or after it needs `PWD_AUTH`
carrying `PWD`. Removing protection means writing `AUTH0` back to `0xFF` — a
write the protected Tag refuses without the password. So:

- a password set here could never be satisfied, so it could never be verified
  (criterion 1 unreachable); and
- it could never be cleared, because the clearing write is behind the protection
  it clears (criterion 2 unreachable, and the Tag unrecoverable).

Setting it would be a one-way door with the key on the far side.

### 2. This Reader does not read the Tag's real configuration pages

`docs/PROTOCOL.md` open problem 5 records that pages ≥ 130 return an identical
block on two different UIDs, including `AUTH0`. This ticket adds the argument
that turns "suspicious" into "settled": **the reported `AUTH0` is contradicted by
the same dump.**

Read-only probe, 2026-11-21 (`cargo run --example dumpread`, `0x0083` + `0x0081`
only):

```
tag type 5  UID 04 43 7B 01 CC 09 03        (the NTAG215 ticket 18 wrote)
page   3   E1 10 3E 00                      CC, 496 bytes of user memory
page   4   03 09 D1 01 54 05 02 65          the NDEF message, state 1 (read ok)
page 130   00 00 00 BD
page 131   04 00 00 FF                      reported AUTH0 = 0x04
page 132   00 05 00 00
page 133   00 00 00 00                      reported PWD
page 134   00 00 00 00                      reported PACK
page 135   (state 3 — outside the tag's memory)
```

An `AUTH0` of `0x04` would require `PWD_AUTH` for **every** access from page 4
onwards. Pages 4..16 of that same reply read back in full with state `1`. Both
cannot be true, so the byte at page 131 is not `AUTH0`: the firmware is not
reading the configuration block. (The block is also byte-identical on
`04 43 8A 01 22 09 03`, a different chip.)

Consequences:

- Protection status cannot be determined, so a Tag is never described as
  unprotected and never presented as recoverable.
- A write followed by a read-back could not tell "protection was set" from
  "the firmware echoed my own buffer", so even a successful-looking set would be
  an unverifiable claim about a Tag's security.

### What this means for the earlier belief

The earlier reading — "`AUTH0 = 0x04` means the tag is password protected" — is
wrong, and so was the belief that it explained the `status 32` write refusal. The
real blocker there was the write-path tag selector (`0x0082` accepts `0..4`,
refuses `5`). Nothing in this ticket revives that mistake: `AUTH0` is treated as
unreadable, not as `0x04`.

## What was built

| Where | What |
|---|---|
| `src-tauri/src/password.rs` | `decide() -> Result<Infallible, PasswordRefusal>`, the protection-status classifier, `guard_config_write()`, and 19 hardware-free tests |
| `src-tauri/src/ntag.rs` | `CONFIG_FIRST_PAGE = 130` and a new `PlanError::PageIsConfiguration`. `guard_write_page` now clamps at the configuration area, because its old limit came from the Tag's own Capability Container — a CC claiming a large capacity could have steered an NDEF write into pages 131-134 |
| `src-tauri/src/lib.rs` | `hf_password_status` (read-only), `hf_password_set` and `hf_password_remove` (neither touches the Reader, both always refuse) |
| `src/lib/password.ts` | The warning copy, the acknowledgement gate, the notice wording, 25 tests |
| `src/lib/password.test.ts` | Gate, warning copy and "never recoverable" wording asserted |
| `src/components/PasswordProtection.tsx` | The panel on the 13.56 MHz page |

The acknowledgement is a checkbox that starts unticked, and both operations are
unavailable until it is ticked. It is collected per attempt and cleared
afterwards, so nothing is remembered. The gate is necessary and not sufficient:
acknowledging changes the refusal from "you have not acknowledged this" to "this
Reader cannot authenticate a Tag", and neither produces a frame.

## Deliberately not done

- No configuration page was written, on any Tag. `0x0082` was not sent at all.
- No probe wrote `PWD`/`PACK`/`AUTH0` to find out whether config writes land. The
  read path is demonstrably not reporting chip configuration, so a read-back
  could not be interpreted: an uninterpretable probe is not evidence, and the
  write it needs is the exact write that could brick a Tag.
- **Tags consumed: 0.** No Tag was modified.

## Why the remaining criteria are unchecked

| Criterion | Why not |
|---|---|
| A password can be set, and protected access behaves as expected | No authentication command exists, so the app can never perform the protected access that would show this. Setting alone would produce an unrecoverable Tag, so it is refused rather than shipped unverifiable. |
| Removing the password with the same value restores unprotected access | Removal needs `PWD_AUTH`, or an unprotected write of `AUTH0 = 0xFF`. The first does not exist; the second is refused by a protected Tag, and the config read cannot even confirm the result. |
| A wrong password produces a clear error rather than a wedge | No password can be presented — there is nowhere to present one — so there is no wrong-password path to word. The wedge this criterion exists to prevent is exactly what a "set" would create, which is why it is not offered. |

The two criteria that are the *point* of the ticket — the unrecoverable warning
with an explicit acknowledgement, and never presenting an unknown password as
recoverable — are delivered and tested.
