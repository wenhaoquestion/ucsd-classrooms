import { useMoment } from "../../lib/moment-context";
import { fromTermId, getTermId, MAX_TERM_ID, MIN_TERM_ID, termCode } from "../../lib/terms";
import { View } from "../../lib/View";
import { Link } from "../Link";

export type TermButtonsProps = {
  /** Where each quarter button leads, so the open building stays open. */
  view: View;
};

/** A sliding row of nearby quarters, to view a whole quarter's schedule. */
export function TermButtons({ view }: TermButtonsProps) {
  const { currentTerm } = useMoment();
  const currentTermId = getTermId(currentTerm.year, currentTerm.season);
  return (
    <div className="term-buttons">
      {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((offset) => {
        const id = currentTermId + offset;
        const { year, quarter } = fromTermId(id);
        return (
          <Link
            className={`term-button ${
              id === currentTermId && currentTerm.current ? "term-button-selected" : ""
            } ${MIN_TERM_ID <= id && id <= MAX_TERM_ID ? "" : "term-button-hidden"}`}
            // The off-screen terms are just for the smooth animation, so don't
            // make them clickable
            view={Math.abs(offset) > 2 ? null : view}
            aria-hidden={Math.abs(offset) > 2 ? "true" : undefined}
            term={{ year, season: quarter }}
            key={id}
            style={{
              transform: `translateX(${
                -50 + (offset + (currentTerm.current ? 0 : 0.5)) * 110
              }%)`,
            }}
          >
            {termCode(year, quarter)}
          </Link>
        );
      })}
    </div>
  );
}
