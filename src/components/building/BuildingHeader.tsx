import { BuildingDatum } from "../../lib/buildings";
import { useLast } from "../../lib/useLast";
import { AbbrevHeading } from "../AbbrevHeading";
import { BackIcon } from "../icons/BackIcon";
import { CloseIcon } from "../icons/CloseIcon";
import { Image } from "../Image";
import { Link } from "../Link";
import { closeBuildingBack } from "./backHandlers";

export type BuildingHeaderProps = {
  building: BuildingDatum;
  room: string | null;
};

/** The building panel's colored header, with back and close buttons. */
export function BuildingHeader({ building, room }: BuildingHeaderProps) {
  const { code, images, college, name } = building;
  const lastRoom = useLast("", room);
  const imageUrl = images[0]?.url; // TODO: Compress
  return (
    <header
      className={`building-name ${
        room ? "schedule-view" : "list-view"
      } college-${college}`}
    >
      {images.length > 0 && (
        <Image
          className="building-header-image"
          src={imageUrl}
          key={imageUrl}
        />
      )}
      <Link
        view={room ? { type: "building", building: code } : null}
        className="icon-btn back"
        aria-label="Back to room list"
        back={([previous]) => {
          // If the user just came from a room list then go back to it
          if (previous && previous.type === "building" && !previous.room) {
            return 0;
          } else {
            return null;
          }
        }}
      >
        <BackIcon />
      </Link>
      <AbbrevHeading
        heading="h2"
        abbrev={
          <span>
            {code} <span className="room-number">{lastRoom}</span>
          </span>
        }
      >
        {name}
      </AbbrevHeading>
      <Link
        view={{ type: "default" }}
        className="icon-btn close"
        aria-label="Close"
        back={closeBuildingBack(room)}
      >
        <CloseIcon />
      </Link>
    </header>
  );
}
