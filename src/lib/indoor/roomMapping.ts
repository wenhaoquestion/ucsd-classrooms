import { compareRoomNums } from "../compareRoomNums";
import {
  IndoorBuilding,
  IndoorFloor,
  IndoorRoom,
  INSTRUCTIONAL_ROOM_TYPES,
  UnplacedRoom,
} from "./schema";

export type IndoorIndex = {
  building: IndoorBuilding;
  roomsById: Map<string, IndoorRoom>;
  /** Exact schedule key (including aliases) -> geometry room. */
  roomsByScheduleKey: Map<string, IndoorRoom>;
  floorsById: Map<string, IndoorFloor>;
  /** Geometry room ID -> the schedule key used for navigation. */
  scheduleKeyByRoomId: Map<string, string>;
  /** Schedule key of an unplaced room -> its floor and the room entry. */
  unplacedByKey: Map<string, { floor: IndoorFloor; room: UnplacedRoom }>;
};

/**
 * Indexes a validated layout. Schedule keys are matched exactly as strings;
 * aliases must be listed explicitly in `scheduleAliases`. Throws on ambiguous
 * mappings, which `validateIndoorBuilding` also reports.
 */
export function indexIndoorBuilding(building: IndoorBuilding): IndoorIndex {
  const roomsById = new Map<string, IndoorRoom>();
  const roomsByScheduleKey = new Map<string, IndoorRoom>();
  const floorsById = new Map<string, IndoorFloor>();
  const scheduleKeyByRoomId = new Map<string, string>();
  const unplacedByKey: IndoorIndex["unplacedByKey"] = new Map();
  const assign = (key: string, room: IndoorRoom) => {
    const existing = roomsByScheduleKey.get(key);
    if (existing && existing !== room) {
      throw new RangeError(
        `Schedule key ${key} maps to both ${existing.id} and ${room.id}.`
      );
    }
    roomsByScheduleKey.set(key, room);
  };
  for (const floor of building.floors) {
    floorsById.set(floor.id, floor);
    for (const room of floor.rooms) {
      roomsById.set(room.id, room);
      if (room.scheduleKey !== null) {
        assign(room.scheduleKey, room);
        scheduleKeyByRoomId.set(room.id, room.scheduleKey);
      }
    }
    for (const room of floor.unplaced ?? []) {
      if (room.scheduleKey !== null && !unplacedByKey.has(room.scheduleKey)) {
        unplacedByKey.set(room.scheduleKey, { floor, room });
      }
    }
  }
  for (const alias of building.scheduleAliases ?? []) {
    const room = roomsById.get(alias.room);
    if (!room) {
      throw new RangeError(`Alias ${alias.scheduleKey} -> unknown ${alias.room}.`);
    }
    assign(alias.scheduleKey, room);
    if (!scheduleKeyByRoomId.has(room.id)) {
      scheduleKeyByRoomId.set(room.id, alias.scheduleKey);
    }
  }
  return {
    building,
    roomsById,
    roomsByScheduleKey,
    floorsById,
    scheduleKeyByRoomId,
    unplacedByKey,
  };
}

/**
 * The room key to navigate to when a geometry room is selected. Rooms without
 * a schedule key fall back to their printed label so they still get a URL,
 * even though no schedule exists for them.
 */
export function navigationKeyForRoom(index: IndoorIndex, room: IndoorRoom): string {
  return index.scheduleKeyByRoomId.get(room.id) ?? room.label;
}

/** Resolves a room key from a URL or the room list to a geometry room. */
export function roomForKey(
  index: IndoorIndex,
  key: string | null
): IndoorRoom | null {
  if (key === null) {
    return null;
  }
  const byKey = index.roomsByScheduleKey.get(key);
  if (byKey) {
    return byKey;
  }
  // Only fall back to labels for rooms that have no schedule mapping at all, so
  // a label can never shadow an explicit schedule key.
  for (const room of index.roomsById.values()) {
    if (room.label === key && !index.scheduleKeyByRoomId.has(room.id)) {
      return room;
    }
  }
  return null;
}

export type RoomCoverage = {
  /** Schedule rooms that have geometry. */
  mapped: { key: string; room: IndoorRoom }[];
  /** Schedule rooms whose floor is known but not their position. */
  unplaced: { key: string; floor: IndoorFloor }[];
  /** Schedule rooms with no geometry; their schedules stay accessible. */
  scheduleOnly: string[];
  /**
   * Instructional geometry rooms (or rooms with a schedule key) with no
   * meetings in the loaded schedule data.
   */
  geometryOnly: IndoorRoom[];
};

export function computeCoverage(
  index: IndoorIndex,
  scheduleRoomKeys: string[]
): RoomCoverage {
  const mapped: RoomCoverage["mapped"] = [];
  const unplaced: RoomCoverage["unplaced"] = [];
  const scheduleOnly: string[] = [];
  const seen = new Set<IndoorRoom>();
  for (const key of [...scheduleRoomKeys].sort(compareRoomNums)) {
    const room = index.roomsByScheduleKey.get(key);
    if (room) {
      mapped.push({ key, room });
      seen.add(room);
    } else if (index.unplacedByKey.has(key)) {
      unplaced.push({ key, floor: index.unplacedByKey.get(key)!.floor });
    } else {
      scheduleOnly.push(key);
    }
  }
  const geometryOnly = [...index.roomsById.values()].filter(
    (room) =>
      !seen.has(room) &&
      (room.scheduleKey !== null || INSTRUCTIONAL_ROOM_TYPES.has(room.type))
  );
  return { mapped, unplaced, scheduleOnly, geometryOnly };
}
