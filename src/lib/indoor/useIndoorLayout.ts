import { useEffect, useMemo, useState } from "react";
import { CampusData, loadCampus } from "./campus";
import { IndoorLoadError, loadIndoorLayout } from "./loader";
import { CAMPUS_CODES, hasIndoorLayout } from "./manifest";
import { IndoorIndex, indexIndoorBuilding } from "./roomMapping";
import { buildExteriorShell } from "./shell";

export type IndoorLayoutState =
  | { type: "none" }
  | { type: "loading" }
  | { type: "ready"; index: IndoorIndex }
  | { type: "error"; error: IndoorLoadError };

type Loaded =
  | { type: "loading" }
  | { type: "detailed"; index: IndoorIndex }
  | { type: "shell"; campus: CampusData }
  | { type: "error"; error: IndoorLoadError };

/**
 * Loads the 3D layout for `building` on demand: a detailed layout if there is
 * one, otherwise an exterior shell from the campus map. Shells assign floors
 * from `roomKeys`. Results that arrive after the building changes are ignored.
 */
export function useIndoorLayout(
  building: string,
  name: string,
  enabled: boolean,
  roomKeys: readonly string[]
): IndoorLayoutState {
  const available = enabled && hasIndoorLayout(building);
  const [state, setState] = useState<{ building: string; loaded: Loaded }>({
    building,
    loaded: { type: "loading" },
  });

  useEffect(() => {
    if (!available) {
      return;
    }
    let current = true;
    const set = (loaded: Loaded) => {
      if (current) {
        setState({ building, loaded });
      }
    };
    set({ type: "loading" });
    loadIndoorLayout(building)
      .then(async (index) => {
        if (index) {
          set({ type: "detailed", index });
        } else if (CAMPUS_CODES[building]) {
          set({ type: "shell", campus: await loadCampus() });
        } else {
          throw new IndoorLoadError("missing", `No 3D data for ${building}.`);
        }
      })
      .catch((error: unknown) =>
        set({
          type: "error",
          error:
            error instanceof IndoorLoadError
              ? error
              : new IndoorLoadError("fetch", `Couldn't load the 3D view (${String(error)}).`),
        })
      );
    return () => {
      current = false;
    };
  }, [building, available]);

  // Same room set, same shell (and scene)
  const roomSet = [...roomKeys].sort().join("\n");
  const loaded = state.building === building ? state.loaded : null;
  const campus = loaded?.type === "shell" ? loaded.campus : null;
  const shell = useMemo(() => {
    if (!campus) {
      return null;
    }
    const layout = buildExteriorShell(
      building,
      name,
      campus,
      CAMPUS_CODES[building] ?? [],
      roomSet ? roomSet.split("\n") : []
    );
    return layout ? indexIndoorBuilding(layout) : null;
  }, [campus, building, name, roomSet]);

  if (!available) {
    return { type: "none" };
  }
  // Never return another building's stale result
  if (!loaded || loaded.type === "loading") {
    return { type: "loading" };
  }
  if (loaded.type === "error") {
    return loaded;
  }
  if (loaded.type === "detailed") {
    return { type: "ready", index: loaded.index };
  }
  return shell
    ? { type: "ready", index: shell }
    : {
        type: "error",
        error: new IndoorLoadError("missing", `The campus map has no footprint for ${building}.`),
      };
}
