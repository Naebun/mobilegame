// Constants shared by every first-person module. World units are roughly metres.
// Axes: x east, y up, z south. Map tile (col, row) has its centre at ((col + 0.5) * TILE, (row + 0.5) * TILE).
export const TILE = 2; // world units per map tile
export const WALL_H = 3.4; // full-height wall and ceiling height
export const EYE = 1.65; // camera height
export const PLAYER_R = 0.45; // player collision radius
export const CEIL_VARIANTS = 2; // plaster ceiling variants side by side in the baked atlas (assets/textures/plaster-*.webp)
export const FLAG_VARIANTS = 2; // flagstone layouts side by side in the baked atlas (assets/textures/flag-*.webp), one per floor tile

// Neon palette shared with the 2D UI.
export const COLOURS = {
  magenta: 0xff2e93,
  cyan: 0x22d3ee,
  purple: 0x7c3aed,
  amber: 0xfbbf24,
  red: 0xff2a2a,
  bg: 0x050309,
};
