import { INDOOR_MANIFEST } from "./manifest";
import { IndoorIndex, indexIndoorBuilding } from "./roomMapping";
import { IndoorBuilding } from "./schema";
import { IndoorIssue, validateIndoorBuilding } from "./validate";

export class IndoorLoadError extends Error {
  name = "IndoorLoadError";
  constructor(
    readonly kind: "missing" | "fetch" | "invalid",
    message: string,
    readonly issues: IndoorIssue[] = []
  ) {
    super(message);
  }
}

const cache = new Map<string, Promise<IndoorIndex | null>>();

async function load(building: string): Promise<IndoorIndex | null> {
  const entry = INDOOR_MANIFEST[building];
  if (!entry) {
    return null;
  }
  let data: unknown;
  try {
    const response = await fetch(new URL(entry.file, document.baseURI));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (error) {
    throw new IndoorLoadError(
      "fetch",
      `Couldn't load the indoor map for ${building} (${String(error)}).`
    );
  }
  const { ok, issues } = validateIndoorBuilding(data, building);
  if (!ok) {
    console.warn(`Invalid indoor layout for ${building}`, issues);
    throw new IndoorLoadError(
      "invalid",
      `The indoor map for ${building} failed validation.`,
      issues
    );
  }
  const layout = data as IndoorBuilding;
  if (layout.geometryStatus !== entry.status) {
    throw new IndoorLoadError(
      "invalid",
      `${building} is listed as ${entry.status} but the file says ${layout.geometryStatus}.`
    );
  }
  try {
    return indexIndoorBuilding(layout);
  } catch (error) {
    throw new IndoorLoadError("invalid", String(error));
  }
}

/**
 * Fetches, validates, and indexes a building's detailed layout, or resolves to
 * `null` if it has none (it may still get an exterior shell). Results are
 * cached; failures are evicted so a later attempt can retry.
 */
export function loadIndoorLayout(building: string): Promise<IndoorIndex | null> {
  let promise = cache.get(building);
  if (!promise) {
    promise = load(building);
    cache.set(building, promise);
    promise.catch(() => cache.delete(building));
  }
  return promise;
}
