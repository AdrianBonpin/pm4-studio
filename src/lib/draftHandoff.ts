/**
 * The one piece of cross-page intent this app has: a Draft a reading produced,
 * waiting for Library to open on it.
 *
 * The action is on the 13.56 MHz readout and the Collection switch is in Library,
 * and the two are separate destinations: the press creates the Draft, then the
 * shell changes destination. A destination change unmounts the page that asked
 * for it, so the Draft's id cannot be that page's state — it has to survive the
 * navigation it causes, and be spent by the page that arrives.
 *
 * Hence a one-shot handoff, and deliberately not a router. The value is one
 * string, one page reads it, and it is gone the moment that page has read it: a
 * saved preference would reopen Library on a Draft at every launch, and a route
 * would give this app's five destinations a tree they do not have. It is a
 * module-level value for the reason `hooks/useSessionMode` is — a small thing
 * that outlives an unmount, with nothing to thread through the shell.
 *
 * Peeking and claiming are separate because React's development double
 * invocation runs a `useState` initialiser twice. An initialiser that claimed
 * would leave the second run with nothing, and Library would land on Snapshots in
 * development only — a defect that does not reproduce in a production build. So
 * the arriving page *peeks* while rendering, and an effect *claims* once, after
 * the commit that already rendered the right Collection.
 */

/** The Draft waiting for Library, if any. */
let pending: string | null = null;

/** Hand a Draft to the page that is about to be shown. */
export function handOffDraft(draftId: string): void {
  pending = draftId;
}

/** The Draft waiting for Library, without spending it: for a render-time read. */
export function pendingDraft(): string | null {
  return pending;
}

/** The Draft waiting for Library, spent: a later visit opens where it always did. */
export function claimPendingDraft(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Test-only: forget the handoff, so one test cannot leak into the next. */
export function resetDraftHandoffForTest(): void {
  pending = null;
}
