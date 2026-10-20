import { BackHandler } from "../../lib/View";

/**
 * Back handler for closing the building panel: reuses history entries when the
 * panel was opened from the map, so closing acts like the browser back button.
 */
export function closeBuildingBack(room: string | null): BackHandler {
  return ([previous, before]) => {
    if (!previous) {
      return null;
    }
    // If the building panel was directly opened, go back
    if (previous.type === "default") {
      return 0;
    }
    // If the building panel was opened two pages ago, and this is a
    // room schedule,
    if (room && before && before.type === "default") {
      // Ensure that the direct previous entry was a room list
      if (previous.type === "building" && !previous.room) {
        return 1;
      }
    }
    return null;
  };
}
