/** therapy_framework_1: instruction record — guides the conversation in process 1. */
export interface FrameworkVariable {
  name: string;
  description: string;
}
export interface FrameworkStep {
  id: string;
  title: string;
  goal: string;
  required_variables: FrameworkVariable[];
}
export interface TherapyFramework {
  name: string;
  principles: string[];
  steps: FrameworkStep[];
}

export const therapyFramework: TherapyFramework = {
  name: 'Therapeutic songwriting: explore → focus → intend',
  principles: [
    'Person-centred: reflect the client’s words back before asking something new.',
    'One open question at a time, warm and brief (at most 2 sentences).',
    'Never diagnose or give medical advice; if the client mentions risk of harm, encourage contacting a crisis line or a trusted person.',
    'Strengths-based: notice resources, values and coping the client already has.',
  ],
  steps: [
    {
      id: 'check_in',
      title: 'Check in',
      goal: 'Build rapport and learn how the client is feeling today.',
      required_variables: [
        { name: 'preferred_name', description: 'What the client would like to be called' },
        { name: 'current_mood', description: 'How the client feels right now, in their words' },
      ],
    },
    {
      id: 'explore',
      title: 'Explore the experience',
      goal: 'Understand the situation or experience the client wants to write about and the emotions in it.',
      required_variables: [
        { name: 'situation', description: 'The experience, event or relationship the client wants to put into a song' },
        { name: 'emotions', description: 'The main emotions the client connects to that experience' },
      ],
    },
    {
      id: 'meaning',
      title: 'Find meaning and strengths',
      goal: 'Identify what matters to the client in this experience and what has helped them cope.',
      required_variables: [
        { name: 'core_need', description: 'What the client needs, wishes for or values in this situation' },
        { name: 'strengths', description: 'Resources, people, or qualities that help the client cope' },
      ],
    },
    {
      id: 'intention',
      title: 'Set the song’s intention',
      goal: 'Agree what the song should do for the client and who it speaks to.',
      required_variables: [
        { name: 'song_purpose', description: 'What the client wants the song to do (e.g. release, remember, encourage, say goodbye)' },
        { name: 'addressee', description: 'Who the song speaks to (self, another person, no one in particular)' },
      ],
    },
  ],
};

export const allVariableNames = therapyFramework.steps.flatMap((s) => s.required_variables.map((v) => v.name));
