/** tool_1 evaluate: deterministic check of the framework step against required_variables. */
import type { TherapyFramework } from '../framework.ts';
import type { RequiredVariables, StepStatus } from '../types.ts';

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

export function evaluateStep(framework: TherapyFramework, vars: RequiredVariables, previous?: StepStatus): StepStatus {
  for (let i = 0; i < framework.steps.length; i++) {
    const missing = framework.steps[i].required_variables.map((v) => v.name).filter((n) => !filled(vars[n]));
    if (missing.length > 0) {
      const advanced = previous !== undefined && i > previous.current_step;
      return { status: advanced ? 'step_complete' : 'in_progress', current_step: i, missing };
    }
  }
  return { status: 'all_complete', current_step: framework.steps.length - 1, missing: [] };
}
