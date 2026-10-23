import { useCallback, useState } from "react";

const KEY = "ucsd-classrooms:indoor-3d";

/** Phones start with the room list, which is quicker to scan on a small screen. */
function defaultEnabled(): boolean {
  return !window.matchMedia?.("(max-width: 690px)").matches;
}

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? defaultEnabled() : stored === "on";
  } catch {
    return defaultEnabled();
  }
}

/**
 * Whether to show the 3D indoor explorer. Stored per browser (not in the URL)
 * so links stay the same for everyone; the room list is always available.
 */
export function useExplorerPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(read);
  const set_s = useCallback((value: boolean) => {
    setEnabled(value);
    try {
      window.localStorage.setItem(KEY, value ? "on" : "off");
    } catch {
      // Storage may be unavailable (private mode); the choice lasts this session
    }
  }, []);
  return [enabled, set_s];
}
