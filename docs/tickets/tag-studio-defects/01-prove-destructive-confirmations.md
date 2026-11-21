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
**Status:** ready

**Finding (2026-11-22, during implementation).** The eighth gate does not exist. The
Draft delete control removes a Draft on the first click, with no confirmation and no
way back, so there was nothing to dismiss and nothing to prove. The implementer
reported this rather than inventing a gate to satisfy the count. Ticket 06 adds the
confirmation; this ticket proves the seven gates that are actually in the app.

- [ ] Each of the seven gates that exist today has a proof that dismissing it leaves
      the target untouched. (Draft delete had no confirmation to dismiss — see ticket 06,
      which adds one.)
- [ ] Each of the eight gates has a proof that confirming performs the action.
- [ ] Removing a confirmation from its control fails at least one test.
- [ ] Components render with no Reader attached and no backend running.
- [ ] Backend calls are stubbed where the interface invokes them, not by replacing
      internal modules.
- [ ] The whole suite still runs as one command, with no browser download.
- [ ] The manual hardware checklist is unchanged; nothing here claims to replace it.
