import type { BriefTemplate } from "../shared/types.ts";

/** Default r1 brief template. Editable in the app. */
export const DEFAULT_TEMPLATE: BriefTemplate = [
  { key: "occasion", label: "Occasion", description: "the event or setting where the speech is given", required: true },
  { key: "audience", label: "Audience", description: "who will be listening and what they already know", required: true },
  { key: "purpose", label: "Purpose", description: "what the speech should achieve: inform, persuade, celebrate, thank…", required: true },
  { key: "duration", label: "Duration", description: "how long the speech should take, in minutes", required: true },
  { key: "speaker", label: "Speaker", description: "who gives the speech and their relationship to the audience", required: true },
  { key: "keyMessages", label: "Key messages", description: "the main points, stories or facts to include", required: true },
  { key: "tone", label: "Tone", description: "the desired tone, e.g. warm, humorous, formal, inspiring", required: false },
];
