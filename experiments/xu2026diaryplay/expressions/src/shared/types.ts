// Representations from design.json. Names follow the design identifiers without versions.

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Door {
  x: number;
  y: number;
}

/** (layouts: artifact spatial)* and (layout: artifact spatial) — a floor plan */
export interface Layout {
  id: string;
  name: string;
  width: number;
  height: number;
  rooms: Room[];
  doors: Door[];
}

/** (characters: artifact record)* */
export interface Character {
  id: string;
  name: string;
  description: string;
  traits: string[];
  isPlayer: boolean;
  color: string;
  x: number | null;
  y: number | null;
}

/** (room_labels: label language)* */
export interface RoomLabel {
  roomId: string;
  name: string;
  description: string;
}

/** (objects: artifact record)* */
export interface GameObject {
  id: string;
  name: string;
  emoji: string;
  description: string;
  roomId: string;
  x: number | null;
  y: number | null;
}

export type Tile = "wall" | "floor" | "door" | "void";

/** (environment: artifact spatial) — a tile grid with labelled rooms */
export interface Environment {
  width: number;
  height: number;
  tiles: Tile[][]; // tiles[y][x]
  rooms: (Room & { name: string; description: string })[];
}

/** (activities: artifact record)* */
export interface Activity {
  id: string;
  objectId: string;
  verb: string;
  description: string;
}

/** (events: artifact record)* */
export interface PlotEvent {
  id: string;
  description: string;
  activityId: string | null;
  roomId: string | null;
  characterIds: string[];
}

/** (vignette: artifact record) */
export interface Vignette {
  title: string;
  story: string;
  environment: Environment;
  objects: GameObject[];
  characters: Character[];
  activities: Activity[];
  events: PlotEvent[];
  playerId: string;
}

export type NpcStep =
  | { kind: "goto"; objectId: string }
  | { kind: "activity"; activityId: string }
  | { kind: "say"; text: string }
  | { kind: "wait" };

/** (npc_plans: artifact record)* */
export interface NpcPlan {
  characterId: string;
  eventIndex: number;
  steps: NpcStep[];
}

/** (player_action: instruction record) */
export type PlayerAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "interact"; activityId: string }
  | { type: "wait" };

export interface LogEntry {
  tick: number;
  kind: "action" | "event" | "dialogue" | "inner_voice" | "system";
  speaker?: string;
  text: string;
}

/** (runtime_state: artifact record) */
export interface RuntimeState {
  tick: number;
  positions: Record<string, { x: number; y: number }>;
  eventIndex: number;
  completedEvents: string[];
  doneActivities: { characterId: string; activityId: string; tick: number }[];
  bubbles: Record<string, { text: string; until: number }>;
  log: LogEntry[];
  finished: boolean;
  eventStartTick: number;
  offTrackStreak: number;
  lastInnerVoiceTick: number;
}

/** (deviation: evaluation categorical) */
export type Deviation = "on_track" | "minor" | "major";

export interface Project {
  story: string;
  characters: Character[];
  layoutId: string | null;
  roomLabels: RoomLabel[];
  objects: GameObject[];
  environment: Environment | null;
  activities: Activity[];
  events: PlotEvent[];
  vignette: Vignette | null;
}
