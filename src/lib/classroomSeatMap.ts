/**
 * Returns a web search URL for finding seating maps/charts for a classroom.
 *
 * UC San Diego does not publish a single canonical API for every classroom's
 * seating map, so this links to a targeted search query.
 */
export function getClassroomSeatMapSearchUrl(
  buildingCode: string,
  roomNumber: string
): string {
  const query = `UCSD ${buildingCode} ${roomNumber} classroom seating chart`;
  return `https://www.google.com/search?${new URLSearchParams({ q: query }).toString()}`;
}
