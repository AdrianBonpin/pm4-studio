import { Check } from "lucide-react";
import { NOTICE_TONE_CLASS } from "../lib/noticeTone";
import type { SaveNote } from "../lib/saveNote";

/**
 * The line under a readout saying how keeping it in the library came out.
 *
 * One component for both band pages: the note belongs to the save, not to the
 * band, and two copies of this markup were two places for the same sentence to be
 * drawn in different inks. The tone comes from `lib/saveNote`, which reads the
 * outcome, so this draws the colour and nothing else.
 */
export function SaveNoteLine({ note, className = "" }: { note: SaveNote | null; className?: string }) {
  if (!note) return null;
  return (
    <p className={`flex items-center gap-1 text-xs ${NOTICE_TONE_CLASS[note.tone]} ${className}`}>
      {note.tone === "ok" && <Check size={12} />}
      {note.text}
    </p>
  );
}
