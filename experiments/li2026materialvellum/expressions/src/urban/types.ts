import type { InpaintMask, FunctionPrompt, Point } from '../shared/api';
export type { InpaintMask, FunctionPrompt };

export const ZONES = ['residential', 'commercial', 'office', 'industrial', 'green'] as const;
export type Zone = (typeof ZONES)[number];
export type CellUse = Zone | 'road' | 'water' | 'empty';

export const ZONE_COLORS: Record<CellUse, string> = {
  residential: '#f2b35b',
  commercial: '#e5655a',
  office: '#5b8def',
  industrial: '#9b7bd1',
  green: '#6cbf6a',
  road: '#d8d8d8',
  water: '#78b7e0',
  empty: '#f4f1ea',
};

/** (urban_site: artifact spatial) */
export interface UrbanSite {
  size: number; // px
  grid: number; // cells per side
  water: boolean[]; // grid*grid
}

/** (zoning_bands: instruction spatial)* */
export interface ZoningBand {
  id: string;
  zone: Zone;
  width: number; // px
  points: Point[];
}

/** (urban_plan: artifact spatial) */
export interface UrbanPlan {
  grid: number;
  size: number;
  cells: CellUse[];
}

export interface Building {
  id: string;
  col: number;
  row: number;
  /** footprint inset within the cell, 0..1 */
  footprint: number;
  height: number; // metres
  zone: Zone;
}

/** (city_model: artifact spatial) */
export interface CityModel {
  plan: UrbanPlan;
  buildings: Building[];
}

/** (density_grid: instruction spatial) — values 0..1, one per block of cells */
export interface DensityGrid {
  blocks: number; // per side
  values: number[];
}

/** (depth_map: artifact visual) */
export interface DepthMap {
  pngDataUrl: string;
  width: number;
  height: number;
  grid: number;
  levels: number[];
  maxHeightM: number;
}

/** (render: artifact visual) */
export interface Render {
  version: number;
  svg: string;
  width: number;
  height: number;
}

export const FUNCTIONS = ['park', 'plaza', 'school', 'hospital', 'market', 'stadium', 'museum', 'waterfront'] as const;
export type UrbanFunction = (typeof FUNCTIONS)[number];
export const FUNCTION_ICONS: Record<UrbanFunction, string> = {
  park: '🌳', plaza: '⛲', school: '🏫', hospital: '🏥', market: '🛒', stadium: '🏟️', museum: '🏛️', waterfront: '🌊',
};

/** (function_magnets: instruction spatial)* */
export interface FunctionMagnet {
  id: string;
  fn: UrbanFunction;
  x: number;
  y: number;
  r: number;
}
