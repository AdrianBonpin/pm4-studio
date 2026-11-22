import type { ReactNode } from "react";
import { PAGE_RULE } from "../lib/uiConstants";

interface SectionProps {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Flat page section separated by a hairline. Deliberately not a card: nesting
 * bordered containers around every group is the "cardocalypse" pattern.
 *
 * The hairline is the page's structure, not the section's own property: it
 * reaches both edges of the content area (`PAGE_RULE` cancels the pane's inset
 * and re-applies it to this section's own content), so a page reads as one panel
 * rather than as a column of rules floating in the middle of the window. A rule
 * *inside* a body is drawn by the body and stays at its inset.
 */
export function Section({ title, hint, actions, children }: SectionProps) {
  return (
    <section className={`${PAGE_RULE} border-t border-border pt-6 first:border-t-0 first:pt-0`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-sm text-text">{title}</h2>
          {hint && (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">{hint}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/** Label + value pair. Values are machine data, so mono. */
export function Field({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{label}</span>
      <span
        className={`font-mono text-sm ${tone === "muted" ? "text-text-muted" : "text-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

/** The big mono readout used for an EM4100 id or a UID. */
export function Readout({ value, placeholder }: { value?: string; placeholder?: string }) {
  if (!value) {
    return <p className="text-sm text-text-muted">{placeholder}</p>;
  }
  return (
    <p className="font-mono text-[26px] leading-none tracking-[0.08em] text-accent-muted">
      {value}
    </p>
  );
}
