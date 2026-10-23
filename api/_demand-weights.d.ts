// Type surface for the shared plain-JS weight table (api/_demand-weights.js) so
// src/demands.ts can import it under `strict` without `allowJs`. The runtime
// module is the single source of the per-demand axis weights; this file only
// describes its shape and must track it.

export type WeightAxis = 'wit' | 'specificity' | 'audacity' | 'economy' | 'flattery';

export interface DemandWeightEntry {
  id: string;
  axisWeights: Record<WeightAxis, number>;
}

export const DEMAND_WEIGHTS: DemandWeightEntry[];
export function scramble(n: number): number;
export function weightsFor(id: string): Record<WeightAxis, number>;
export function selectDailyWeights(day: number): DemandWeightEntry;
