# 01: Prove destructive confirmations by driving the interface

**What to build:** The suite renders components and clicks their controls. Every
destructive gate in the app is exercised twice: dismissing it leaves the target
untouched, confirming it performs the action. The eight gates — Snapshot delete, Draft
delete, clone, author, blank, write a Draft, erase, and set password — each get that
pair of proofs, so a confirmation removed from its control fails a test instead of
passing review. Components render with no Reader attached and no backend running.

This does not reverse the decision to opt out of browser E2E. No browser is launched,
no device is mocked for the whole application, and the manual hardware checklist is
unchanged. It is a component test that drives one control at a time.

**Blocked by:** None (can start immediately)

**Seams:** The render-and-drive boundary. Catches a confirmation removed from its
control, a confirmation wired to the wrong action, and a dialog that neither confirms
nor cancels. Misses whether the backend would honour the action, and misses real
webview behaviour — the app runs in WKWebView and the harness simulates a DOM, so this
proves wiring rather than fidelity.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/4
**Status:** done

**Finding (2026-11-22, during implementation).** The eighth gate does not exist. The
Draft delete control removes a Draft on the first click, with no confirmation and no
way back, so there was nothing to dismiss and nothing to prove. The implementer
reported this rather than inventing a gate to satisfy the count. Ticket 06 adds the
confirmation; this ticket proves the seven gates that are actually in the app.

- [x] Each of the seven gates that exist today has a proof that dismissing it leaves
      the target untouched. (Draft delete had no confirmation to dismiss — see ticket 06,
      which adds one.)
- [x] Each of the eight gates has a proof that confirming performs the action.
- [x] Removing a confirmation from its control fails at least one test.
- [x] Components render with no Reader attached and no backend running.
- [x] Backend calls are stubbed where the interface invokes them, not by replacing
      internal modules.
- [x] The whole suite still runs as one command, with no browser download.
- [x] The manual hardware checklist is unchanged; nothing here claims to replace it.

## Outcome

All eight gates carry the pair of proofs. The seven below were proven here; the
Draft delete gate had no confirmation when this ticket ran (see ticket 06), and
the dismissal half was added with the confirmation itself, in
`DraftsPage.test.tsx`.

| Gate | Dismissal proof | Confirmation proof |
| :--- | :--- | :--- |
| 1 Snapshot delete | `LibraryPage.test.tsx` "keeping the Snapshot removes nothing" | "removes that Snapshot" |
| 2 Draft delete | `DraftsPage.test.tsx` "asks before it removes anything, and keeping the Draft removes nothing" (added by ticket 06) | "removes that Draft through the store" |
| 3 clone | `CloneWizard.test.tsx` "cancelling writes nothing" | "writes the Identity that was read" |
| 4 author | `AuthorIdentity.test.tsx` "going back writes nothing" | "writes the previewed Identity" |
| 5 blank | `BlankTag.test.tsx` "keeping the tag as it is blanks nothing" | "blanks the Identity that was read" |
| 6 write a Draft | `WriteDraftToTag.test.tsx` "cancelling writes nothing" | "writes the Draft's message" |
| 7 erase | `EraseNdef.test.tsx` "keeping the content erases nothing" | "erases when the confirmation is confirmed" |
| 8 set password | `PasswordProtection.test.tsx` "cannot be asked for before the consequence is acknowledged" | "sends the acknowledged request" |

The password gate is an acknowledgement rather than a dialog: the request control
cannot be pressed until the warning is ticked, so its dismissal proof is the disabled
control sending nothing. Both halves are asserted, and both go red when the
gate is removed.

**Stubbing is at the invoke boundary.** `src/test/dom.tsx` replaces
`window.__TAURI_INTERNALS__.invoke` — the point where the webview hands a command to
Rust, and the only thing `@tauri-apps/api/core`'s `invoke` delegates to. Every module
between a control and the backend runs unmodified, and no `vi.mock` appears in any
test here. Commands with no scripted answer reject, so a test cannot pass by accident.

**Mutation-checked.** Three gates were broken and their test files went red, then
reverted: the Snapshot row's trash control wired straight to `remove` (both
`LibraryPage` tests fail), the password acknowledgement gate removed from the control,
and the Blank dismissal button wired to `lf_blank` instead of `reset`. An earlier test
that read two callers' source as text to prove they share a component was deleted and
replaced by driving the real confirmation in `AuthorIdentity`/`CloneWizard`; that is
why the net gain is 14 tests rather than 15.

**Suite:** `bun run test` 32 files / 417 tests; `cargo test` 349. Both green, no
browser launched or downloaded.
