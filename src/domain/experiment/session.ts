import { deriveProcesses, type Canvas } from "./canvas";
import { conditions, taskOrder, type Condition, type TaskId } from "./study";

export type Phase = "tutorial" | "brief" | "work" | "done";

export interface StudyEvent {
  at: string;
  type: string;
}

export interface Session {
  participant: string;
  part: number;
  condition: Condition;
  task: TaskId;
  phase: Phase;
  started?: string;
  finished?: string;
  name: string;
  goal: string;
  description: string;
  prompt: string;
  canvas: Canvas;
  events: StudyEvent[];
}

export interface SessionFile {
  name: string;
  type: string;
  content: string;
}

export const newSession = (participant: string, part: number, condition: Condition, task: TaskId): Session => ({
  participant: participant.trim(),
  part,
  condition,
  task,
  phase: condition === "canvas" ? "tutorial" : "brief",
  name: "",
  goal: "",
  description: "",
  prompt: "",
  canvas: { nodes: [], edges: [] },
  events: [],
});

export const newStudy = (participant: string, random = Math.random) =>
  (random() < 0.5 ? conditions : [...conditions].reverse()).map((condition, index) => newSession(participant, index + 1, condition, taskOrder[index]));

export const elapsedSeconds = (started: string, until: string | Date = new Date()) =>
  Math.max(0, Math.round((new Date(until).getTime() - new Date(started).getTime()) / 1000));

const study = ({ participant, part, condition, task, started, finished }: Session) => ({
  participant,
  part,
  condition,
  task,
  started,
  finished,
  seconds: started && finished ? elapsedSeconds(started, finished) : undefined,
});

const fileName = (session: Session, extension: string) =>
  `${session.participant.replace(/[^\p{L}\p{N}]+/gu, "-") || "participant"}-${session.part}-${session.condition}-${session.task}.${extension}`;

function textFile(session: Session): SessionFile {
  const frontmatter = Object.entries(study(session))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  const body = [session.name && `# ${session.name}`, session.goal && `Goal: ${session.goal}`, session.prompt].filter(Boolean).join("\n\n");
  return { name: fileName(session, "md"), type: "text/markdown", content: `---\n${frontmatter.join("\n")}\n---\n\n${body}\n` };
}

function canvasFile(session: Session): SessionFile {
  const { processes, representations } = deriveProcesses(session.canvas);
  const content = {
    name: session.name,
    goal: session.goal,
    description: session.description,
    processes,
    representations,
    references: [],
    images: [],
    study: { ...study(session), events: session.events },
    canvas: {
      nodes: session.canvas.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: session.canvas.edges.map(({ id, source, target }) => ({ id, source, target })),
    },
  };
  return { name: fileName(session, "json"), type: "application/json", content: `${JSON.stringify(content, null, 2)}\n` };
}

export const sessionFile = (session: Session) => (session.condition === "text" ? textFile(session) : canvasFile(session));
