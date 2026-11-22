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
 * Native because every list it still serves is a short, fixed enumeration: the
 * Record type a Draft's next entry should be, and Wi-Fi authentication and
 * encryption. A platform menu is the control a user already knows how to drive
 * with a keyboard, and none of these sets grows.
 *
 * That is the rule, not a habit (ADR 0010): **a list that grows is an in-app list
 * with a search field over it**, because a platform menu cannot be typed at, so
 * finding one item by name in several hundred is a scroll. The Drafts a Tag can
 * receive were the list that outgrew this control, and they are chosen from the
 * list in `WriteDraftMode` instead. A picker of a growing list added here as a
 * `<select>` again would be ignoring that decision.
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
