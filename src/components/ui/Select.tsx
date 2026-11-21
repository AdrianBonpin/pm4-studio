import { INPUT_ROUNDING } from "../../lib/uiConstants";

/** One choice in the list. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectProps {
  /** The control's accessible name. */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Shown while nothing is chosen. It is a prompt rather than a value, so it
   * cannot be selected once the user has chosen something else.
   */
  prompt?: string;
}

/**
 * A native select, styled from the palette.
 *
 * Native because both lists it serves can grow — the Records a Draft is built
 * from, and the Drafts a Tag can receive — and the platform's own menu is the one
 * the user already knows how to drive with a keyboard. Every other control in the
 * shell is drawn; this is the one exception, and it is the same exception in both
 * places.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  prompt,
}: SelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_ROUNDING} cursor-pointer border border-border bg-surface px-3 py-2 text-sm text-text transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {prompt !== undefined && (
        <option value="" disabled>
          {prompt}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
