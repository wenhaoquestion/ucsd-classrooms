import { useEffect, useRef, useState } from "react";
import { buildings } from "../../lib/buildings";
import { CampusScene, campusPosition, campusSceneUrl, openCampusScene } from "./campusScene";

declare const LOCAL_CAMPUS_SURVEY: boolean;

const buildingOptions = Object.values(buildings).sort((a, b) => a.name.localeCompare(b.name));

function LiveScene({ selected }: { selected: string | null }) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<CampusScene>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!container.current) return;
    const controller = new AbortController();
    const fail = () => setStatus("error");
    openCampusScene(container.current, null, controller.signal, fail).then((loaded) => {
      if (!controller.signal.aborted) {
        scene.current = loaded;
        setStatus("ready");
      }
    }).catch(() => {
      if (!controller.signal.aborted) fail();
    });
    return () => {
      scene.current = null;
      controller.abort();
    };
  }, [attempt]);

  useEffect(() => {
    if (status !== "ready" || !selected) return;
    let ignore = false;
    campusPosition(selected).then((place) => {
      if (!ignore && place) scene.current?.focus(place);
    });
    return () => { ignore = true; };
  }, [selected, status]);

  return (
    <>
      <div className="campus-3d-surface" ref={container} aria-label="UC San Diego aerial 3D map" />
      {status !== "ready" && (
        <div className="campus-3d-message" role="status">
          {status === "loading" ? "Loading UC San Diego’s 3D campus…" : (
            <>
              <p>The 3D campus scene couldn’t load.</p>
              <button type="button" className="chip" onClick={() => {
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}>Try again</button>
              <a className="link" href={campusSceneUrl} target="_blank" rel="noopener noreferrer">
                Open UC San Diego’s scene
              </a>
            </>
          )}
        </div>
      )}
      {status === "ready" && (
        <button type="button" className="chip campus-3d-overview" onClick={() => scene.current?.focus(null)}>
          Campus overview
        </button>
      )}
    </>
  );
}

function OfflineScene({ selected }: { selected: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded || !selected) return;
    let ignore = false;
    campusPosition(selected).then((place) => {
      if (!ignore && place) {
        frame.current?.contentWindow?.postMessage(
          { type: "ucsd-campus-focus", name: place.name }, window.location.origin
        );
      }
    });
    return () => { ignore = true; };
  }, [loaded, selected]);
  return <iframe
    ref={frame}
    className="campus-3d-surface"
    title="Offline UC San Diego aerial 3D map"
    src={new URL("campus-offline/?embed=1", document.baseURI).href}
    onLoad={() => setLoaded(true)}
  />;
}

export default function Campus3D({
  selected,
  onSelect,
  onDismissBuilding,
}: {
  selected: string | null;
  onSelect(code: string): void;
  onDismissBuilding(): void;
}) {
  const [jumpedTo, setJumpedTo] = useState<string | null>(null);
  const focused = selected ?? jumpedTo;
  return (
    <section className="campus-3d" aria-label="3D campus">
      {LOCAL_CAMPUS_SURVEY ? <OfflineScene selected={focused} /> : <LiveScene selected={focused} />}
      <div className="campus-3d-buildings">
        <select aria-label="Jump to a campus building" value={focused && buildings[focused] ? focused : ""}
          onChange={(event) => {
            setJumpedTo(event.target.value);
            if (selected) onDismissBuilding();
          }}>
            <option value="" disabled>Jump to a building</option>
            {buildingOptions.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
        {focused && buildings[focused] && (
          <button type="button" className="chip" onClick={() => onSelect(focused)}>Classrooms</button>
        )}
      </div>
    </section>
  );
}
