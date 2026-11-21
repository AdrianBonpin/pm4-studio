/**
 * The visible half of the outcome seam: the stack of messages, and how long each
 * one stays.
 *
 * Three rules come from the spec and live here rather than in the view, because
 * they are about the messages and not about where they are drawn:
 *
 *   * **Dismissal is by severity.** A success or an announcement clears at four
 *     seconds, a warning at eight, and an error persists until it is dismissed or
 *     until the same operation later succeeds. The deadlines are injected, never
 *     waited for.
 *   * **At most three are visible.** The older ones are counted rather than
 *     dropped, so a batch cannot silently swallow its own news.
 *   * **Identical outcomes coalesce.** Twenty successful writes in a row are one
 *     message with a repeat count, not twenty.
 *
 * The store is a plain subscribable object with no React in it, so its timing can
 * be driven by a clock a test owns and its rendering can be replaced by another
 * subscribable source without touching any of this.
 */

import type { Outcome, OutcomeKind, OutcomeOperation, Severity } from "./outcome";

/** How many messages the corner shows at once. */
export const MAX_VISIBLE_TOASTS = 3;

/** How long an outcome may be repeated and still count as the same message. */
export const COALESCE_WINDOW_MS = 2_000;

/** How long each severity stays on screen; `null` means until dismissed. */
export const LIFETIME_MS: Record<Severity, number | null> = {
  info: 4_000,
  success: 4_000,
  warning: 8_000,
  error: null,
};

/**
 * The clock and the timer queue, injected.
 *
 * Production passes the platform's; tests pass a queue they advance by hand, so
 * "clears at four seconds" is asserted rather than slept through.
 */
export interface Timer {
  /** Milliseconds, monotonic enough for coalescing windows. */
  now(): number;
  /** Run `run` after `ms`, returning whatever handle `cancel` understands. */
  after(ms: number, run: () => void): unknown;
  cancel(handle: unknown): void;
}

export const systemTimer: Timer = {
  now: () => Date.now(),
  after: (ms, run) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One message on screen, as the store holds it. */
export interface Toast {
  readonly id: string;
  readonly kind: OutcomeKind;
  readonly operation: OutcomeOperation;
  readonly severity: Severity;
  readonly message: string;
  readonly detail?: string;
  readonly action?: Outcome["action"];
  readonly onDismiss?: Outcome["onDismiss"];
  /** 1 for the first report of this message, 2 after an identical one coalesced. */
  readonly repeat: number;
  /** When it was last reported, by the injected clock. */
  readonly raisedAt: number;
}

export interface ToastState {
  /** Newest first, so the visible slice is the most recent three. */
  readonly toasts: readonly Toast[];
}

/** What the corner shows, and how many older messages it counts instead. */
export function visibleToasts(state: ToastState): {
  visible: readonly Toast[];
  hidden: number;
} {
  return {
    visible: state.toasts.slice(0, MAX_VISIBLE_TOASTS),
    hidden: Math.max(0, state.toasts.length - MAX_VISIBLE_TOASTS),
  };
}

export interface ToastStore {
  getState(): ToastState;
  subscribe(listener: () => void): () => void;
  /** Report one outcome. The only way a message comes into existence. */
  push(outcome: Outcome): void;
  /** Remove one message, acknowledging whatever it stood in for. */
  dismiss(id: string): void;
  /** Drop everything without acknowledging it. For tests and for a fresh start. */
  clear(): void;
}

export interface ToastStoreOptions {
  readonly timers?: Timer;
  readonly lifetimes?: Record<Severity, number | null>;
  readonly coalesceWindowMs?: number;
}

const EMPTY: ToastState = { toasts: [] };

/**
 * Build a store. The app builds one at module scope (below); tests build their
 * own so one file's messages cannot leak into another's.
 */
export function createToastStore(options: ToastStoreOptions = {}): ToastStore {
  const timers = options.timers ?? systemTimer;
  const lifetimes = options.lifetimes ?? LIFETIME_MS;
  const coalesceWindowMs = options.coalesceWindowMs ?? COALESCE_WINDOW_MS;

  let state: ToastState = EMPTY;
  let nextId = 0;
  const listeners = new Set<() => void>();
  const deadlines = new Map<string, unknown>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function cancelDeadline(id: string): void {
    const handle = deadlines.get(id);
    if (handle === undefined) return;
    deadlines.delete(id);
    timers.cancel(handle);
  }

  /** Remove one message and acknowledge it, exactly once. */
  function remove(toast: Toast, acknowledge: boolean): void {
    cancelDeadline(toast.id);
    if (!state.toasts.some((candidate) => candidate.id === toast.id)) return;
    state = { toasts: state.toasts.filter((candidate) => candidate.id !== toast.id) };
    emit();
    if (acknowledge) toast.onDismiss?.();
  }

  function schedule(toast: Toast): void {
    const lifetime = lifetimes[toast.severity];
    if (lifetime === null) return; // An error has no deadline to miss.
    deadlines.set(
      toast.id,
      timers.after(lifetime, () => remove(toast, true)),
    );
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    push(outcome) {
      const now = timers.now();

      // A success or an announcement clears the error its own operation raised:
      // "it failed" stops being true the moment that operation works. Errors of
      // other operations are left alone — they are still true.
      if (outcome.severity === "success" || outcome.severity === "info") {
        for (const toast of state.toasts) {
          if (toast.severity === "error" && toast.operation === outcome.operation) {
            remove(toast, true);
          }
        }
      }

      const repeated = state.toasts.find(
        (toast) =>
          toast.kind === outcome.kind &&
          toast.message === outcome.message &&
          toast.detail === outcome.detail &&
          now - toast.raisedAt <= coalesceWindowMs,
      );

      if (repeated) {
        // Same news again: one message whose count says how many times it came,
        // moved back to the front so a burst stays visible while it happens.
        const coalesced: Toast = { ...repeated, repeat: repeated.repeat + 1, raisedAt: now };
        state = {
          toasts: [coalesced, ...state.toasts.filter((toast) => toast.id !== repeated.id)],
        };
        cancelDeadline(repeated.id);
        schedule(coalesced);
        emit();
        return;
      }

      const toast: Toast = {
        id: `toast-${(nextId += 1)}`,
        kind: outcome.kind,
        operation: outcome.operation,
        severity: outcome.severity,
        message: outcome.message,
        detail: outcome.detail,
        action: outcome.action,
        onDismiss: outcome.onDismiss,
        repeat: 1,
        raisedAt: now,
      };
      state = { toasts: [toast, ...state.toasts] };
      schedule(toast);
      emit();
    },

    dismiss(id) {
      const toast = state.toasts.find((candidate) => candidate.id === id);
      if (toast) remove(toast, true);
    },

    clear() {
      for (const id of [...deadlines.keys()]) cancelDeadline(id);
      if (state.toasts.length === 0) return;
      state = EMPTY;
      emit();
    },
  };
}

/** The app's one store. */
export const toastStore = createToastStore();

/**
 * Report an outcome's visible half. Called by `report` and by nothing else: a
 * component that reaches this directly has skipped the seam, and its message has
 * no signal to match.
 */
export function pushToast(outcome: Outcome): void {
  toastStore.push(outcome);
}
