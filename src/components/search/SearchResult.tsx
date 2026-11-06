import { useEffect, useRef } from "react";
import { Range } from "../../lib/search";
import { View } from "../../lib/View";
import { Link } from "../Link";

function Highlighted({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const parts = [];
  let cursor = 0;
  for (const [i, { start, end }] of ranges.entries()) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className="result-match" key={i}>
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export type SearchResultProps = {
  name?: string;
  code?: string;
  primary: "name" | "code";
  /** Matched parts of the primary text. */
  ranges?: Range[];
  selected: boolean;
  view: View;
  onNavigate?: () => void;
};
export function SearchResult({
  name,
  code,
  primary: primaryField,
  ranges,
  selected,
  view,
  onNavigate,
}: SearchResultProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  const nameFirst = primaryField === "name";
  const primary = nameFirst ? name : code;
  const secondary = nameFirst ? code : name;

  return (
    <Link
      view={view}
      className={`result ${selected ? "result-selected" : ""}`}
      elemRef={ref}
      role="option"
      aria-selected={selected}
      onNavigate={onNavigate}
    >
      {primary !== undefined && (
        <p
          className={`result-primary ${
            nameFirst ? "result-name" : "result-code"
          }`}
        >
          <Highlighted text={primary} ranges={ranges} />
        </p>
      )}
      {secondary !== undefined && (
        <p
          className={`result-secondary ${
            nameFirst ? "result-code" : "result-name"
          }`}
        >
          {secondary}
        </p>
      )}
    </Link>
  );
}
