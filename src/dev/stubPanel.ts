/**
 * The verification field panel: a hidden control for the tag in the field.
 *
 * A real Reader's field changes because a human moves a tag. Two flows in this
 * app depend on that happening — Clone's "take the original off the Reader" and
 * Copy's observed removal — so a stub that could only hold one tag could not
 * reach the confirmation those flows exist to produce.
 *
 * It is therefore a control, and it is hidden: `Alt+Shift+D` shows it,
 * `Alt+Shift+D` hides it, and it is never on screen in a screenshot. It is not
 * part of the interface under review, it is not styled from the app's tokens, and
 * it says so on its own face — the note at the top reads "verification only: not a
 * Reader".
 *
 * Deliberately plain DOM with inline styles. The design rules apply to the app,
 * and a reviewer mistaking this panel for the app would be a worse outcome than an
 * unstyled panel: a Tailwind class here would be a class the design gate has an
 * opinion about, on a surface the gate has no business gating.
 */

import type { HfProfile, LfProfile } from "./deviceStub";

/** What the panel needs from the stub it sits beside. */
export interface StubPanelOptions {
  readonly target: Window;
  readonly profiles: () => { lf: LfProfile | "custom"; hf: HfProfile | "custom" };
  readonly setLf: (profile: LfProfile) => void;
  readonly setHf: (profile: HfProfile) => void;
  readonly log: readonly { command: string; args: Record<string, unknown> }[];
}

const LF_CHOICES: readonly { profile: LfProfile; label: string }[] = [
  { profile: "source", label: "55 00 84 82 12 (will not write)" },
  { profile: "blank", label: "77 00 AB CD EF (blank, writable)" },
  { profile: "none", label: "no tag" },
];

const HF_CHOICES: readonly { profile: HfProfile; label: string }[] = [
  { profile: "ntag", label: "NTAG215 with a message" },
  { profile: "ntag-empty", label: "NTAG215 empty" },
  { profile: "ntag-dest", label: "NTAG213 04 9A 2B 3C 4D 5E 60 (copy destination)" },
  { profile: "classic", label: "MIFARE Classic 1K" },
  { profile: "unknown", label: "unlisted ATQA/SAK" },
  { profile: "none", label: "no tag" },
];

const PANEL_STYLE =
  "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:20rem;padding:10px 12px;" +
  "border:1px solid var(--color-border-hover);border-radius:var(--radius-lg);" +
  "background:var(--color-surface);color:var(--color-text);" +
  "font:11px/1.5 var(--font-family-mono)";

/**
 * The app's own tokens, not a second palette.
 *
 * This panel is not part of the interface under review, but it is drawn over it,
 * and a verification tool with its own colours is one more place for a hue to
 * drift. The tokens are the committed world, so it borrows them.
 */
const buttonStyle = (active: boolean) =>
  "display:block;width:100%;margin:2px 0;padding:3px 6px;text-align:left;cursor:pointer;" +
  "border-radius:var(--radius-sm);border:1px solid " +
  (active ? "var(--color-border-hover)" : "var(--color-border)") +
  ";background:" +
  (active ? "var(--color-surface-raised)" : "transparent") +
  ";color:" +
  (active ? "var(--color-text)" : "var(--color-text-muted)") +
  ";font:inherit";

/** Mount the panel, hidden, and wire the shortcut that reveals it. */
export function mountStubPanel(options: StubPanelOptions): void {
  const document = options.target.document;
  if (!document || document.getElementById("pm4-stub-panel")) return;

  const panel = document.createElement("div");
  panel.id = "pm4-stub-panel";
  panel.dataset.verificationPanel = "device-stub";
  panel.style.cssText = `${PANEL_STYLE};display:none`;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Verification device stub");

  const note = document.createElement("p");
  note.style.cssText = "margin:0 0 6px;color:var(--color-warn)";
  note.textContent = "verification only · not a Reader · Alt+Shift+D";
  panel.append(note);

  const heading = (text: string) => {
    const p = document.createElement("p");
    p.style.cssText =
      "margin:8px 0 2px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.08em";
    p.textContent = text;
    return p;
  };

  const lfButtons: HTMLButtonElement[] = [];
  panel.append(heading("125 kHz field"));
  for (const choice of LF_CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      options.setLf(choice.profile);
      paint();
    });
    lfButtons.push(button);
    panel.append(button);
  }

  const hfButtons: HTMLButtonElement[] = [];
  panel.append(heading("13.56 MHz field"));
  for (const choice of HF_CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      options.setHf(choice.profile);
      paint();
    });
    hfButtons.push(button);
    panel.append(button);
  }

  const logHeading = heading("last commands");
  const log = document.createElement("pre");
  log.style.cssText =
    "margin:0;white-space:pre-wrap;color:var(--color-text-muted);max-height:7rem;overflow:hidden";
  panel.append(logHeading, log);

  const paint = () => {
    const current = options.profiles();
    LF_CHOICES.forEach((choice, index) => {
      const button = lfButtons[index]!;
      button.style.cssText = buttonStyle(current.lf === choice.profile);
    });
    HF_CHOICES.forEach((choice, index) => {
      const button = hfButtons[index]!;
      button.style.cssText = buttonStyle(current.hf === choice.profile);
    });
    log.textContent = options.log
      .slice(-6)
      .map((call) => call.command)
      .join("\n");
  };
  paint();

  // A poller runs while a flow waits, so the log has to keep up without a
  // re-render of anything: a timer is enough for a panel nobody is timing.
  const timer = options.target.setInterval?.(() => {
    if (panel.style.display !== "none") paint();
  }, 500);

  options.target.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey) return;
    if (event.key.toLowerCase() !== "d") return;
    event.preventDefault();
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    paint();
  });

  const unmount = () => {
    if (timer !== undefined) options.target.clearInterval?.(timer);
  };
  options.target.addEventListener("pagehide", unmount);

  document.body.append(panel);
}
