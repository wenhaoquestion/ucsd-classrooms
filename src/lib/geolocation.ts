import { useSyncExternalStore } from "react";
import { Location } from "./locations";

export type UserLocation =
  | { type: "off" }
  | { type: "locating" }
  | { type: "located"; location: Location; accuracy: number }
  | { type: "error"; message: string };

let state: UserLocation = { type: "off" };
let watchId: number | null = null;
const listeners = new Set<() => void>();

function set(next: UserLocation) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Starts watching the device's position. Safe to call repeatedly; the browser
 * only asks for permission the first time.
 */
export function startLocating(): void {
  if (watchId !== null) {
    return;
  }
  if (!("geolocation" in navigator)) {
    set({ type: "error", message: "Location isn't available in this browser." });
    return;
  }
  set({ type: "locating" });
  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      set({
        type: "located",
        location: [coords.latitude, coords.longitude],
        accuracy: coords.accuracy,
      });
    },
    (error) => {
      stopLocating();
      set({
        type: "error",
        message:
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Couldn't find your location.",
      });
    },
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
  );
}

export function stopLocating(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  set({ type: "off" });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The user's position, shared by every component that shows it. */
export function useUserLocation(): UserLocation {
  return useSyncExternalStore(subscribe, () => state);
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters. */
export function distanceMeters([lat1, lon1]: Location, [lat2, lon2]: Location): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Paths are rarely straight lines; this pads the crow-flies distance. */
const DETOUR_FACTOR = 1.3;
/** About 4.8 km/h. */
const WALK_METERS_PER_MINUTE = 80;

/** Rough walking time in whole minutes (at least 1). */
export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round((meters * DETOUR_FACTOR) / WALK_METERS_PER_MINUTE));
}

export function formatDistance(meters: number): string {
  return meters < 950
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

/** A walking-directions link that opens the platform's maps app on phones. */
export function directionsUrl([latitude, longitude]: Location): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${latitude},${longitude}`);
  url.searchParams.set("travelmode", "walking");
  return url.toString();
}
