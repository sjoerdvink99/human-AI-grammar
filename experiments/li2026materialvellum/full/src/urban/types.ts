export type Vec = [number, number];

/** urban_site: the empty site the user plans a neighborhood on. */
export const SITE = 600; // site edge in site units (= px in the zoning view)
export const N_BLOCKS = 12; // 12×12 block grid
export const CELL = SITE / N_BLOCKS; // 50
export const STREET = 8; // street width between blocks
export const DENSITY_RES = 24; // density_grid resolution (2×2 cells per block)
export const RENDER_SIZE = 512; // render image size

export interface UrbanSite { size: number; blocks: number; cell: number; street: number }
export const urbanSite1: UrbanSite = { size: SITE, blocks: N_BLOCKS, cell: CELL, street: STREET };

export type Zone = 'residential' | 'commercial' | 'mixed' | 'industrial' | 'park';
export const ZONES: Zone[] = ['residential', 'commercial', 'mixed', 'industrial', 'park'];
export const ZONE_COLOR: Record<Zone | 'none', string> = {
  residential: '#f2b84b',
  commercial: '#4b8ff2',
  mixed: '#b36bf2',
  industrial: '#8a8a8a',
  park: '#5cb85c',
  none: '#e9e4da',
};

/** zoning_bands: elastic closed loops marking zone boundaries. */
export interface ZoningBand { id: string; zone: Zone; points: Vec[] }

/** urban_plan: the zones and blocks of the neighborhood. */
export interface PlanBlock { i: number; j: number; zone: Zone | 'none' }
export interface UrbanPlan { blocks: PlanBlock[] }

/** density_grid: building density shaped like clay (DENSITY_RES², values 0..1). */
export type DensityGrid = number[][];

/** function_magnets: functions that attract or repel each other. */
export type UrbanFunction = 'park' | 'school' | 'hospital' | 'market' | 'plaza' | 'library' | 'sports';
export const FUNCTIONS: UrbanFunction[] = ['park', 'school', 'hospital', 'market', 'plaza', 'library', 'sports'];
export const FUNCTION_ICON: Record<UrbanFunction, string> = {
  park: '🌳', school: '🏫', hospital: '🏥', market: '🛒', plaza: '⛲', library: '📚', sports: '⚽',
};
export interface Magnet { id: string; fn: UrbanFunction; x: number; y: number } // render coords
