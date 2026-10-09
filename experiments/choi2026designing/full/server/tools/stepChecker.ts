// tool_1 evaluate — step completion checker (deterministic).
// therapy_framework + chat_history + required_variables -> step_status
import type { TherapyFramework } from "../framework.ts";
import type { RequiredVariables, StepStatus } from "../types.ts";

export function isFilled(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t.length > 1 && !["unknown", "n/a", "none yet", "not mentioned", "not yet shared"].includes(t);
}

/**
 * Advances through every step whose required variables are all filled.
 * A step is also closed after `maxTurnsPerStep` user turns so a person who
 * prefers not to share something is never stuck.
 */
export function evaluateStepStatus(
  framework: TherapyFramework,
  requiredVariables: RequiredVariables,
  currentStep: number,
  turnsInStep: number,
): StepStatus & { advancedBy: number } {
  let step = currentStep;
  let turns = turnsInStep;
  const startStep = step;
  while (step < framework.steps.length) {
    const missing = framework.steps[step].variables.filter((v) => !isFilled(requiredVariables[v.key])).map((v) => v.key);
    if (missing.length === 0 || turns >= framework.maxTurnsPerStep) {
      step += 1;
      turns = 0;
      continue;
    }
    break;
  }
  const allComplete = step >= framework.steps.length;
  const missing = allComplete
    ? []
    : framework.steps[step].variables.filter((v) => !isFilled(requiredVariables[v.key])).map((v) => v.key);
  return {
    status: step > startStep ? "complete" : "incomplete",
    currentStep: Math.min(step, framework.steps.length),
    completedSteps: framework.steps.slice(0, step).map((s) => s.id),
    missing,
    allComplete,
    advancedBy: step - startStep,
  };
}
