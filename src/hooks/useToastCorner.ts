import { useCallback, useSyncExternalStore } from "react";
import {
  loadToastCorner,
  saveToastCorner,
  subscribeToastCorner,
  type ToastCorner,
} from "../lib/toastCorner";

/**
 * The stored corner the messages appear in.
 *
 * Read from storage on every snapshot rather than mirrored in component state, so
 * the control in Settings and the corner on screen cannot disagree: whatever is
 * stored is what is drawn. The snapshot is a string, so "did it change?" is a
 * value comparison and no memo is needed.
 */
export function useToastCorner(): {
  corner: ToastCorner;
  setCorner: (corner: ToastCorner) => void;
} {
  const corner = useSyncExternalStore(
    subscribeToastCorner,
    () => loadToastCorner(),
    () => loadToastCorner(),
  );
  const setCorner = useCallback((next: ToastCorner) => saveToastCorner(next), []);
  return { corner, setCorner };
}
