// Screen enumeration and geometry queries.
//
// KWin's Workspace exposes attached outputs through three different shapes
// depending on the Plasma version, so enumeration lives here once and every
// caller (config, main.qml, monitor adjacency) shares it. Everything below
// operates on plain data, so it runs unmodified under `node` for unit tests.

export function screenName(screen) {
  return (screen && screen.name) ? String(screen.name) : "";
}

// Normalised { name, x, y, width, height } for a KWin screen. Falls back to
// flat x/y/width/height for the plain objects used in tests.
export function screenRect(screen) {
  if (!screen) return null;
  const g = screen.geometry;
  if (g) return { name: screenName(screen), x: g.x, y: g.y, width: g.width, height: g.height };
  return {
    name: screenName(screen),
    x: screen.x || 0,
    y: screen.y || 0,
    width: screen.width || 0,
    height: screen.height || 0,
  };
}

export function listScreens(workspace, onError) {
  if (!workspace) return [];
  try {
    const screens = workspace.screens;
    if (Array.isArray(screens)) return screens.slice();
    if (screens && typeof screens.length === "number") {
      const out = [];
      for (let i = 0; i < screens.length; i++) out.push(screens[i]);
      return out;
    }
    if (typeof workspace.numScreens === "number" && typeof workspace.screenAt === "function") {
      const out = [];
      for (let i = 0; i < workspace.numScreens; i++) out.push(workspace.screenAt(i));
      return out;
    }
  } catch (e) {
    if (onError) onError(e);
  }
  return [];
}

export function findByName(screens, name) {
  const wanted = String(name || "");
  if (!wanted) return null;
  for (let i = 0; i < screens.length; i++) {
    if (screenName(screens[i]) === wanted) return screens[i];
  }
  return null;
}

export function containsPoint(rect, x, y) {
  if (!rect) return false;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function screenAtPoint(screens, point) {
  if (!point) return null;
  for (let i = 0; i < screens.length; i++) {
    const r = screenRect(screens[i]);
    if (r && containsPoint(r, point.x, point.y)) return screens[i];
  }
  return null;
}

// The screen geometrically containing a rect's centre. Used instead of
// `client.screen` during cross-monitor moves: the frame geometry changes
// before KWin updates `client.screen`, so trusting the latter mid-transition
// evaluates the window against the wrong monitor's client area.
export function screenContainingRect(screens, rect) {
  if (!rect) return null;
  const c = rectCenter({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  return screenAtPoint(screens, c);
}

export function overlapArea(a, b) {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

// Screen with the largest overlap against `rect`, so a tiny sliver bleeding
// onto an adjacent monitor doesn't win. When two screens overlap equally,
// `direction` breaks the tie in favour of the one the window travels toward.
export function screenForRect(screens, rect, direction) {
  if (!rect || screens.length === 0) return null;

  let best = null;
  let bestRect = null;
  let bestOverlap = -1;
  const overlaps = [];

  for (let i = 0; i < screens.length; i++) {
    const r = screenRect(screens[i]);
    if (!r || !screens[i] || !screens[i].geometry) {
      overlaps.push(-1);
      continue;
    }
    const overlap = overlapArea(rect, r);
    overlaps.push(overlap);
    if (overlap > bestOverlap) {
      best = screens[i];
      bestRect = r;
      bestOverlap = overlap;
    }
  }

  if (direction && best && bestOverlap > 0) {
    for (let i = 0; i < screens.length; i++) {
      const candidate = screens[i];
      if (candidate === best || overlaps[i] !== bestOverlap) continue;
      const c = screenRect(candidate);
      if (!c) continue;
      if (direction === "left" && c.x + c.width <= bestRect.x + 1) return candidate;
      if (direction === "right" && c.x >= bestRect.x + bestRect.width - 1) return candidate;
      if (direction === "up" && c.y + c.height <= bestRect.y + 1) return candidate;
      if (direction === "down" && c.y >= bestRect.y + bestRect.height - 1) return candidate;
    }
  }

  return best;
}
