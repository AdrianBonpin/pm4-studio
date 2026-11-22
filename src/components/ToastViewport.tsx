import { useSyncExternalStore } from "react";
import { AlertTriangle, Check, Info, OctagonAlert, X } from "lucide-react";
import { useToastCorner } from "../hooks/useToastCorner";
import { toastCornerClasses } from "../lib/toastCorner";
import { NOTICE_TONE_CLASS } from "../lib/noticeTone";
import { toneForSeverity } from "../lib/severity";
import { toastStore, visibleToasts, type Toast, type ToastStore } from "../lib/toastStore";

/**
 * Where the outcome seam's messages are drawn.
 *
 * One fixed region, mounted once by the shell, outside the page flow: a message
 * arriving must not move what the user is reading. The region is named and each
 * message inside it is a polite live region, so a screen reader is told what
 * happened without focus being taken from the control the user is on — nothing
 * here is focusable except the buttons a message offers.
 *
 * The tone is drawn on the whole card, not as a coloured rule down one side: a
 * message announced only by a bar is the treatment the redesign removes.
 *
 * Neither the text nor the severity is decided here. A message arrives already
 * worded and already classified, through `report`; this component only draws what
 * the store holds.
 */

/**
 * Icon and frame per severity, in the design system's own tokens.
 *
 * The *colour* is not here: a message is drawn in the ink its tone owns, read from
 * `lib/noticeTone` through `toneForSeverity`, so the ink is named once for the whole
 * app and a message cannot be a different colour from the notice beside it. This
 * table adds what only a corner card needs.
 *
 * The frame is the other half of a pair, and `ui/Notice` is the first: an inline
 * notice draws the same hues at `warn/50`, `ok/40` and `err/50`, on a 10% tint of
 * the hue. A message cannot use that tint — its card is `bg-surface/95` so the page
 * stays legible behind it — so its edge has to hold the hue against whatever it
 * floats over, and `err` is `err/60` for that reason. Only the intensity differs
 * by surface: the hue, and what it means, come from the one tone vocabulary.
 */
const TONE = {
  success: { icon: Check, frame: "border-ok/40" },
  warning: { icon: AlertTriangle, frame: "border-warn/50" },
  error: { icon: OctagonAlert, frame: "border-err/60" },
  info: { icon: Info, frame: "border-border" },
} as const;

interface ToastViewportProps {
  /** The store to draw. The app's own store unless a test hands in another. */
  store?: ToastStore;
}

export function ToastViewport({ store = toastStore }: ToastViewportProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const { corner } = useToastCorner();

  if (state.toasts.length === 0) return null;
  const { visible, hidden } = visibleToasts(state);

  return (
    <div
      role="region"
      aria-label="Messages"
      data-corner={corner}
      className={`fixed z-50 flex w-80 max-w-[calc(100vw-2rem)] gap-2 ${toastCornerClasses(corner)}`}
    >
      {visible.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => store.dismiss(toast.id)} />
      ))}
      {hidden > 0 && (
        <p className="px-1 text-right font-mono text-[11px] text-text-muted">
          +{hidden} older {hidden === 1 ? "message" : "messages"}
        </p>
      )}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONE[toast.severity];
  const ink = NOTICE_TONE_CLASS[toneForSeverity(toast.severity)];
  const Icon = tone.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2 rounded-lg border bg-surface/95 px-3 py-2.5 backdrop-blur ${tone.frame}`}
    >
      <Icon size={14} aria-hidden className={`mt-0.5 shrink-0 ${ink}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-text">
          {toast.message}
          {toast.repeat > 1 && (
            <span className="ml-1.5 font-mono text-[11px] text-text-muted">×{toast.repeat}</span>
          )}
        </p>
        {toast.detail && (
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{toast.detail}</p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={toast.action.run}
            className="mt-1.5 cursor-pointer text-xs font-medium text-accent-muted hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label={`Dismiss: ${toast.message}`}
        onClick={onDismiss}
        className="mt-0.5 shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
