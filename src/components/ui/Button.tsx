import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `danger` is for an action that destroys something and cannot be undone — a
   * Blank, an Erase. It carries the error hue so the irreversible button is
   * never the one that looks like every other button on the screen.
   */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  // The border colour belongs to the variant, not to the base: a danger button
  // needs its own, and two border-colour utilities on one element would make the
  // result depend on stylesheet order rather than on this object.
  const base =
    "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border";
  const styles = {
    primary:
      "border-border hover:border-border-hover bg-accent text-white hover:bg-accent-hover shadow-none",
    secondary:
      "border-border hover:border-border-hover bg-surface-raised text-text-muted hover:text-text",
    ghost: "border-border hover:border-border-hover bg-transparent text-text-muted hover:text-text",
    danger: "border-err/50 bg-err/10 text-err hover:bg-err/20 hover:border-err/60",
  }[variant];
  return (
    // `data-variant` is the variant itself, not a class that resembles it: a test
    // asking "is this the dangerous control?" gets an answer that only this
    // component can give, so a hand-rolled button carrying a class that happens
    // to look the same cannot stand in for one.
    <button className={`${base} ${styles} ${className}`} data-variant={variant} {...rest}>
      {children}
    </button>
  );
}
