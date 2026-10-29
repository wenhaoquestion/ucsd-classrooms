import { BuildingDatum } from "../../lib/buildings";
import {
  directionsUrl,
  distanceMeters,
  useUserLocation,
  walkingMinutes,
} from "../../lib/geolocation";
import { hasIndoorLayout } from "../../lib/indoor/manifest";

type BuildingActionsProps = {
  building: BuildingDatum;
  /** Rooms with no class listed now, or null when not viewing a date. */
  freeCount: number | null;
  freeOnly: boolean;
  onFreeOnly: (freeOnly: boolean) => void;
  explorerOpen: boolean;
  onExplorerEnabled_s: (enabled: boolean) => void;
  /** Tooltip for the free filter. */
  freeTitle?: string;
};

/** Directions, the free room filter, and the 3D/list switch. */
export function BuildingActions({
  building,
  freeCount,
  freeOnly,
  onFreeOnly,
  explorerOpen,
  onExplorerEnabled_s,
  freeTitle = "Only show classrooms with no class listed now",
}: BuildingActionsProps) {
  const userLocation = useUserLocation();
  const [latitude, longitude] = building.location;
  const placed = latitude !== 0 || longitude !== 0;
  const distance =
    placed && userLocation.type === "located"
      ? distanceMeters(userLocation.location, building.location)
      : null;
  return (
    <div className="building-actions">
      {placed && (
        <a
          className="action-btn action-btn-primary"
          href={directionsUrl(building.location)}
          target="_blank"
          rel="noreferrer"
          title="Walking directions in your maps app"
        >
          Directions
          {distance !== null && (
            <span className="action-btn-detail">{walkingMinutes(distance)} min</span>
          )}
          <svg viewBox="0 0 24 24" className="icon action-icon" aria-hidden="true">
            <path d="M7 7h10v10h-2V10.41l-8.29 8.3-1.42-1.42L13.59 9H7z" />
          </svg>
        </a>
      )}
      {freeCount !== null && (
        <button
          className={`action-btn ${freeOnly ? "action-btn-on" : ""}`}
          aria-pressed={freeOnly}
          onClick={() => onFreeOnly(!freeOnly)}
          title={freeTitle}
        >
          Free now
          <span className="action-count">{freeCount}</span>
        </button>
      )}
      {hasIndoorLayout(building.code) && (
        <div className="segmented" role="group" aria-label="Room view">
          <button
            className="segment"
            aria-pressed={!explorerOpen}
            onClick={() => onExplorerEnabled_s(false)}
          >
            List
          </button>
          <button
            className="segment"
            aria-pressed={explorerOpen}
            onClick={() => onExplorerEnabled_s(true)}
          >
            3D
          </button>
        </div>
      )}
    </div>
  );
}
