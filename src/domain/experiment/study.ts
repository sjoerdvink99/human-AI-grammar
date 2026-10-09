import type { Canvas } from "./canvas";

export const conditions = ["text", "canvas"] as const;

export type Condition = (typeof conditions)[number];

export const conditionLabels: Record<Condition, string> = { text: "Text prompt", canvas: "Grammar canvas" };

export const timeBox = 15 * 60;

export const tasks = {
  A: {
    title: "Screening papers for a literature review",
    description:
      "A researcher starts a systematic literature review by writing a research question and a short list of inclusion criteria. The system turns these into a search query, runs it against a scholarly database, and collects the matching papers. A language model reads every abstract and suggests whether to include or exclude the paper, with a one-sentence reason. If the results look wrong, for example far too many or too few papers, the researcher rewrites the question or criteria and the search runs again. Otherwise the researcher goes through the suggestions and accepts or overrides each one. For every included paper, the model fills in a table with the study's method, sample size, and main finding, which the researcher checks and corrects before exporting it.",
    reference: [
      "(question_1: instruction language) + (criteria_1: instruction language) -> [model translate]~ -> (query_1: instruction formal) -> [tool execute] -> (papers_1: artifact record)* -> [model evaluate]~ -> (papers_1: artifact record)* + (labels_1: label language)* -> [human modify] -> (question_1: instruction language) + (criteria_1: instruction language)",
      "(papers_1: artifact record)* + (labels_1: label language)* -> [human select] -> (included_1: artifact record)* -> [model extract]~ -> (table_1: artifact tabular) -> [human modify] -> (table_2: artifact tabular)",
    ],
  },
  B: {
    title: "Creating a campaign image",
    description:
      "A marketer at a small shop needs an image for a new product campaign. They write a short brief describing the product, the mood, and the audience, and attach a photo of the product. An image model generates six candidate images. If none of them fit, the marketer rewrites the brief and the model generates a new set. Otherwise the marketer picks the most promising image, circles an area they want to change, and says in words what should change there; the model then regenerates only that area. When the marketer is happy, the system automatically crops and resizes the image into the formats needed for the website, social media, and a printed poster.",
    reference: [
      "(brief_1: instruction language) + (photo_1: artifact visual) -> [model generate]~ -> (images_1: artifact visual)* -> [human modify] -> (brief_1: instruction language) + (photo_1: artifact visual)",
      "(images_1: artifact visual)* -> [human select] -> (image_1: artifact visual) -> [human specify] -> (image_1: artifact visual) + (region_1: selection spatial) + (change_1: instruction language) -> [model modify]~ -> (image_2: artifact visual) -> [tool translate] -> (formats_1: artifact visual)*",
    ],
  },
} as const;

export type TaskId = keyof typeof tasks;

export const taskOrder: TaskId[] = ["A", "B"];

export const instruction = "Specify this system so that an AI coding agent, such as Claude Code, could build it from what you write.";

export const tips = [
  "Add a representation for each piece of information: its role, what it is for, and its medium, the form it takes. Tick many for a collection.",
  "Add a step for each action: who acts, a human, a model, or a tool, and what they do. Tick generative when the step creates new content.",
  "Drag from the dot on the right of a node to connect it to the next one, or into empty space to create that node. A step can read and produce several representations.",
  "Connect a step back to an earlier representation to make a loop. Remove a node with its ×, or click a connection and press its ×.",
  "Use the notes to say in words what a representation contains or how a step works.",
];

export const tutorialCanvas: Canvas = {
  nodes: [
    { id: "prompt", type: "representation", position: { x: 0, y: 96 }, data: { name: "prompt", role: "instruction", medium: "language", collection: false, note: "What the user wants written" } },
    { id: "generate", type: "step", position: { x: 288, y: 96 }, data: { actor: "model", operation: "generate", generative: true, note: "Writes three alternatives" } },
    { id: "drafts", type: "representation", position: { x: 576, y: 96 }, data: { name: "drafts", role: "artifact", medium: "language", collection: true, note: "" } },
    { id: "select", type: "step", position: { x: 864, y: 96 }, data: { actor: "human", operation: "select", generative: false, note: "" } },
    { id: "draft", type: "representation", position: { x: 1152, y: 96 }, data: { name: "draft", role: "artifact", medium: "language", collection: false, note: "" } },
    { id: "modify", type: "step", position: { x: 576, y: 352 }, data: { actor: "human", operation: "modify", generative: false, note: "Rewrites the prompt and tries again" } },
  ],
  edges: [
    { id: "prompt-generate", source: "prompt", target: "generate" },
    { id: "generate-drafts", source: "generate", target: "drafts" },
    { id: "drafts-select", source: "drafts", target: "select" },
    { id: "select-draft", source: "select", target: "draft" },
    { id: "draft-modify", source: "draft", target: "modify" },
    { id: "modify-prompt", source: "modify", target: "prompt" },
  ],
};
