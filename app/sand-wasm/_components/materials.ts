// Material ids, shared with `rust/sand-engine/src/engine.rs`. Kept in their own
// module so the page can name a material without pulling in the wasm loader.
//
// These MUST match the Rust constants; the engine indexes its palette with them.

export const EMPTY = 0;
export const WALL = 1;
export const SAND_PLACED = 2;
export const SAND_ACTIVE = 3;
export const SAND_COMPLETED = 4;
export const SAND_REMOVED = 5;

export type SandMaterial =
  | typeof SAND_PLACED
  | typeof SAND_ACTIVE
  | typeof SAND_COMPLETED
  | typeof SAND_REMOVED;
