import type { EnergyEstimate, Savings } from "../../shared/types.ts";

/** tool_5 evaluate: savings_1 from energy_before_1 and energy_after_1 (energy feedback). */
export function computeSavings(before: EnergyEstimate, after: EnergyEstimate): Savings {
  const joules = before.joules - after.joules;
  return { joules, percent: before.joules > 0 ? (100 * joules) / before.joules : 0 };
}
