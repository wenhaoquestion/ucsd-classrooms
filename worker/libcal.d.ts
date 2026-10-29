// Types for worker/libcal.js, which stays plain JavaScript so the Worker needs no build step.

export const CACHE_SECONDS: number;

export type ProxySlot = [start: string, end: string, status: "free" | "booked" | "closed"];

export type GeiselDay = {
  date: string;
  fetchedAt: string;
  windowEnd: boolean;
  spaces: Record<string, ProxySlot[]>;
};

export function fetchGeiselDay(date: string, fetchImpl?: typeof fetch): Promise<GeiselDay>;

export function handleLibcalRequest(
  request: Request,
  path: string,
  fetchImpl?: typeof fetch
): Promise<Response | null>;
