/**
 * One choice out of a handful, shown as a row (or a small grid) of buttons.
 *
 * This is the shell's one switch: the Library's Collections, Settings' groups,
 * and the corner the messages appear in all use it, so "which one is current?"
 * is answered the same way in each. It is deliberately not a tab strip: nothing
 * here owns a panel, hides content from a find-in-page, or needs an arrow-key
 * roving focus. It is a group of toggle buttons, and `aria-pressed` is what says
 * which is on.
 *
 * Every label is `whitespace-nowrap`, because a control that wraps onto a second
 * line at the 900 × 700 minimum window is a defect here rather than a tight fit.
 */

/** One button: the value it sets, and the words it shows. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  /** The group's accessible name. Where the page shows a label, these are its words. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /**
   * One row, or a two-column grid. The grid exists for the corner control, whose
   * buttons are laid out the way the screen is — top row first.
   */
  columns?: 1 | 2;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={columns === 2 ? "grid w-fit grid-cols-2 gap-1" : "flex gap-1"}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? "border-accent bg-surface-raised text-text"
                : "border-border bg-transparent text-text-muted hover:border-border-hover hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
