import { useCallback, useState } from "react";

const KEY = "ucsd-classrooms:indoor-3d";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
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
