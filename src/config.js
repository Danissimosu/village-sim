// Global constants for the Lyubimivka village world.
export const BASE = (import.meta.env && import.meta.env.BASE_URL) || './';
export const TERRAIN_SIZE = 1400;       // metres, square, centred on (0,0)
export const PLAY_HALF = 500;           // player may walk in the central 1 km x 1 km
export const SEG = 350;                 // terrain mesh segments per side (4 m)
export const SPLAT_RES = 1536;          // splat map resolution (~0.91 m / px)
export const GRID_RES = 1;              // collision grid cell (m)
export const VILLAGE_NAME = 'Любимівка';

export const QUALITY = {
  low:    { label: 'Низкое',  pr: 1.0, shadows: false, shadowMap: 1024, shadowRange: 40, grassR: 24, grassDensity: 2.5, aniso: 2,  reflect: 0,    treeDist: 380, waterRes: 0, npcDist: 150, npcNear: 18, npcMaxNear: 10, npcMax: 140, npcFrac: 0.55 },
  medium: { label: 'Среднее', pr: 1.5, shadows: true,  shadowMap: 1024, shadowRange: 45, grassR: 36, grassDensity: 3.5, aniso: 4,  reflect: 0,    treeDist: 600, waterRes: 0, npcDist: 260, npcNear: 28, npcMaxNear: 22, npcMax: 220, npcFrac: 0.85 },
  high:   { label: 'Высокое', pr: 2.0, shadows: true,  shadowMap: 2048, shadowRange: 60, grassR: 50, grassDensity: 4.5, aniso: 8,  reflect: 512,  treeDist: 900, waterRes: 512, npcDist: 380, npcNear: 38, npcMaxNear: 36, npcMax: 300, npcFrac: 1 },
  ultra:  { label: 'Ультра',  pr: 3.0, shadows: true,  shadowMap: 2048, shadowRange: 70, grassR: 62, grassDensity: 5.5, aniso: 16, reflect: 1024, treeDist: 1200, waterRes: 1024, npcDist: 520, npcNear: 46, npcMaxNear: 56, npcMax: 300, npcFrac: 1 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
export const POPULATION = 300;
export const TIME_SPEED = 1 / 150;       // game hours per real second (1 game-minute = 2.5 s): villagers walk in real time, so the day must be slow enough
