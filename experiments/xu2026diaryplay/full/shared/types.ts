// Typed representations named after the design's identifiers (without versions).

export interface Point { x: number; y: number }

/** layouts / layout: (artifact spatial) — a room layout on a tile grid. */
export interface Room { id: string; x: number; y: number; w: number; h: number }
export interface Layout {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  rooms: Room[];
  /** door tiles that connect adjacent rooms (they replace a wall tile) */
  doors: Point[];
}

/** characters: (artifact record)* — the people in the story, with persona fields. */
export interface Character {
  id: string;
  name: string;
  isPlayer: boolean;
  description: string;
  personality: string;
  background: string;
  goals: string;
  speakingStyle: string;
  traits: string[];
  color: string;
}

/** room_labels: (label language)* — what each room is, keyed by room id. */
export type RoomLabels = Record<string, string>;

/** objects: (artifact record)* — objects placed in the rooms. */
export interface GameObject {
  id: string;
  name: string;
  roomId: string;
  w: number;
  h: number;
  againstWall: boolean;
  emoji: string;
  /** interaction verbs (assigned by model in P1.7) */
  affordances: string[];
  /** set by tool_1 placement; null when it could not be placed */
  pos: Point | null;
}

/** environment: (artifact spatial) — rooms and objects together. */
export interface Environment {
  layoutId: string;
  width: number;
  height: number;
  rooms: (Room & { label: string })[];
  doors: Point[];
  /** objects with positions (mirrors objects but is what the canvas renders) */
  objects: GameObject[];
}

/** activities: (artifact record)* — actions characters take with objects. */
export interface Activity {
  id: string;
  characterId: string;
  action: string;
  objectId: string | null;
  description: string;
}

/** events: (artifact record)* — concurrent activities, in chronological order. */
export interface KeyEvent {
  id: string;
  order: number;
  title: string;
  activityIds: string[];
}

/** vignette: (artifact record) — the finished playable scene. */
export interface Vignette {
  id: string;
  title: string;
  story: string;
  environment: Environment;
  characters: Character[];
  activities: Activity[];
  events: KeyEvent[];
  startPositions: Record<string, Point>;
  createdAt: string;
}

/** runtime_state: (artifact record) — where everyone is and which event comes next. */
export interface RuntimeState {
  positions: Record<string, Point>;
  eventIndex: number;
  doneActivityIds: string[];
  /** what each character is currently doing (for display and model context) */
  doing: Record<string, string>;
  log: string[];
  round: number;
  finished: boolean;
}

/** One planned activity for an NPC. */
export interface PlannedActivity {
  characterId: string;
  action: string;
  objectId: string | null;
  /** id of a key-event activity this fulfils, if any */
  activityId: string | null;
  say: string;
}

/** npc_plans: (artifact record)* — two possible next activities for each character. */
export interface NpcPlan {
  characterId: string;
  follow: PlannedActivity;
  diverge: PlannedActivity;
}

/** player_action: (instruction record) — what the player does. */
export type PlayerAction =
  | { kind: 'interact'; objectId: string; verb: string }
  | { kind: 'idle' }
  | { kind: 'wait' };

/** deviation: (evaluation categorical) */
export type Deviation = 'follows' | 'diverges';

/** The authoring project kept in the client (all authoring representations). */
export interface Project {
  story: string;
  characters: Character[];
  layoutId: string | null;
  layoutReason: string;
  roomLabels: RoomLabels;
  objects: GameObject[];
  environment: Environment | null;
  activities: Activity[];
  events: KeyEvent[];
  vignetteId: string | null;
}
