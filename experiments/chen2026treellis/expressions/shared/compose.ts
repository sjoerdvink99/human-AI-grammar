// `tool compose` steps: assemble the typed records that are sent to the model.

/** generation_input (instruction record) — processes 1 and 6. */
export interface GenerationInput {
  mode: 'create' | 'followup';
  /** prompt_1 (process 1) or followup_prompt_1 (process 6) */
  prompt: string;
  /** scene_1, only in follow-up mode */
  currentScene?: string;
}

/** scoped_input (instruction record) — process 5. */
export interface ScopedInput {
  /** local_request_1 */
  request: string;
  /** subtree_1 */
  subtree: string;
  /** ai_target_1 */
  target: { nodeId: string; name: string; type: string };
  /** scene_1, as read-only context */
  sceneContext: string;
}

export function composeGenerationInput(prompt: string, currentScene?: string): GenerationInput {
  const p = prompt.trim();
  if (!p) throw new Error('Please describe what you want.');
  return currentScene ? { mode: 'followup', prompt: p, currentScene } : { mode: 'create', prompt: p };
}

export function composeScopedInput(
  request: string,
  subtree: string,
  target: ScopedInput['target'],
  sceneContext: string,
): ScopedInput {
  const r = request.trim();
  if (!r) throw new Error('Please describe the change for this part.');
  return { request: r, subtree, target, sceneContext };
}
