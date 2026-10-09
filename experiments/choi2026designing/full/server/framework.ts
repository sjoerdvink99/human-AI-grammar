// therapy_framework_1 (instruction record): the steps of the therapy session
// and the information each step needs before moving on.
export interface FrameworkVariable {
  key: string;
  description: string;
}
export interface FrameworkStep {
  id: string;
  title: string;
  goal: string;
  variables: FrameworkVariable[];
}
export interface TherapyFramework {
  name: string;
  principles: string[];
  steps: FrameworkStep[];
  /** tool_1 moves on after this many user turns in a step even if a variable is still missing */
  maxTurnsPerStep: number;
}

export const THERAPY_FRAMEWORK: TherapyFramework = {
  name: "Songwriting for self-expression",
  principles: [
    "Be warm, patient and non-judgmental; validate feelings before asking more.",
    "The person is Deaf or Hard-of-Hearing. Never assume they hear music the way hearing people do; welcome vibration, rhythm, visuals, lyrics, signing and memories as ways of experiencing music.",
    "Ask one short, plain-language question at a time.",
    "Never pressure the person to disclose; offer choices and allow them to skip.",
  ],
  steps: [
    {
      id: "experiences",
      title: "Personal experiences",
      goal: "Learn about a personal experience the person would like to explore or express.",
      variables: [
        { key: "experience", description: "a personal experience, event or situation they want to talk about" },
        { key: "context", description: "when/where it happened or who was involved" },
      ],
    },
    {
      id: "emotions",
      title: "Emotions",
      goal: "Help the person name the feelings connected to that experience.",
      variables: [
        { key: "emotions", description: "the main emotions connected to the experience" },
        { key: "current_feeling", description: "how they feel about it now" },
      ],
    },
    {
      id: "motivation",
      title: "Motivation",
      goal: "Understand why they want to make a song about this and who it is for.",
      variables: [
        { key: "motivation", description: "why they want to express this through a song" },
        { key: "audience", description: "who the song is for (themselves, someone specific, other people)" },
      ],
    },
    {
      id: "musical_preferences",
      title: "Musical preferences",
      goal: "Learn how the person experiences music and what music they like.",
      variables: [
        { key: "music_experience", description: "how they experience music (e.g. vibration, lyrics, visuals, hearing aids, signing)" },
        { key: "preferred_music", description: "genres, artists, songs or moods they like" },
      ],
    },
  ],
  maxTurnsPerStep: 4,
};

export const ALL_VARIABLE_KEYS = THERAPY_FRAMEWORK.steps.flatMap((s) => s.variables.map((v) => v.key));
