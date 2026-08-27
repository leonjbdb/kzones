export const TOL = 1.0;

export function eq(a, b) {
  return Math.abs(a - b) < TOL;
}

export function centerX(z) {
  return z.x + z.w / 2;
}

export function centerY(z) {
  return z.y + z.h / 2;
}

export function touchesEdge(z, dir) {
  switch (dir) {
    case "up":    return Math.abs(z.y) < TOL;
    case "down":  return Math.abs(z.y + z.h - 100) < TOL;
    case "left":  return Math.abs(z.x) < TOL;
    case "right": return Math.abs(z.x + z.w - 100) < TOL;
  }
  return false;
}

export function isWidthPreserveDirection(dir) {
  return dir === "up" || dir === "down";
}

export function clientToSourcePct(client, clientArea) {
  if (!client || !clientArea || !clientArea.width || !clientArea.height) return null;
  const g = client.frameGeometry;
  // Clip to the chosen monitor's client area. If a sliver of the window
  // bleeds onto an adjacent screen, we still want the source rect we plan
  // against to describe the portion actually visible on this monitor —
  // otherwise cycling / direction filters operate on an off-screen anchor
  // and the algorithm jumps out one monitor too eagerly.
  const left   = Math.max(g.x, clientArea.x);
  const top    = Math.max(g.y, clientArea.y);
  const right  = Math.min(g.x + g.width,  clientArea.x + clientArea.width);
  const bottom = Math.min(g.y + g.height, clientArea.y + clientArea.height);
  const wPx = Math.max(0, right - left);
  const hPx = Math.max(0, bottom - top);
  return {
    x: (left - clientArea.x) / clientArea.width  * 100,
    y: (top  - clientArea.y) / clientArea.height * 100,
    w: wPx / clientArea.width  * 100,
    h: hPx / clientArea.height * 100,
  };
}

export function isFullscreenSized(client, clientArea) {
  if (!client || !clientArea) return false;
  const src = clientToSourcePct(client, clientArea);
  if (!src) return false;
  return eq(src.x, 0) && eq(src.y, 0) && eq(src.w, 100) && eq(src.h, 100);
}
