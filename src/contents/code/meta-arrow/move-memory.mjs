import { keyFor, cloneGeom } from "../client-key.mjs";

// Universal one-step undo memory for Meta+Arrow moves.
//
// Memory is stored in a module-level Map keyed via the shared client-key
// helper so the pristine-geometry module and this module agree on identity
// for the same KWin client.
//
// `prevGeometry`    is the absolute pixel rect the window had before the move.
// `direction`       is the direction that produced the current state.
// `snappedGeometry` is the absolute rect we set after applying the move; used
//                   to detect when the user has dragged / resized the window
//                   off our last snap so we can invalidate memory.

const memory = new Map();

export function captureMove(client, prevGeometry, direction, snappedGeometry) {
  const key = keyFor(client);
  if (!key) return;
  memory.set(key, {
    prevGeometry: cloneGeom(prevGeometry),
    direction: direction || null,
    snappedGeometry: cloneGeom(snappedGeometry),
  });
}

export function getMoveMemory(client) {
  const key = keyFor(client);
  if (!key) return null;
  return memory.get(key) || null;
}

export function clearMemory(client) {
  const key = keyFor(client);
  if (!key) return;
  memory.delete(key);
}

