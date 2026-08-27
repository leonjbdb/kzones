import { screenRect } from "../screens.mjs";

function verticalOverlap(a, b) {
  return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}

// Picks the screen physically adjacent to `current` along `dir`. Diagonal-only
// neighbours (no perpendicular overlap) are intentionally ignored — meta+arrow
// shouldn't teleport diagonally.
export function findScreenInDirection(screens, current, dir) {
  if (!screens || !current) return null;
  const src = screenRect(current);
  if (!src) return null;

  let best = null;
  let bestOverlap = 0;
  let bestAxisDist = Infinity;

  for (let i = 0; i < screens.length; i++) {
    const dst = screenRect(screens[i]);
    if (!dst) continue;
    if (dst.name && src.name && dst.name === src.name) continue;

    let overlap = 0;
    let axisDist = Infinity;
    let valid = false;

    switch (dir) {
      case "left":
        if (dst.x + dst.width <= src.x + 1) {
          overlap = verticalOverlap(dst, src);
          axisDist = src.x - (dst.x + dst.width);
          valid = overlap > 0;
        }
        break;
      case "right":
        if (dst.x >= src.x + src.width - 1) {
          overlap = verticalOverlap(dst, src);
          axisDist = dst.x - (src.x + src.width);
          valid = overlap > 0;
        }
        break;
      case "up":
        if (dst.y + dst.height <= src.y + 1) {
          overlap = horizontalOverlap(dst, src);
          axisDist = src.y - (dst.y + dst.height);
          valid = overlap > 0;
        }
        break;
      case "down":
        if (dst.y >= src.y + src.height - 1) {
          overlap = horizontalOverlap(dst, src);
          axisDist = dst.y - (src.y + src.height);
          valid = overlap > 0;
        }
        break;
    }

    if (!valid) continue;
    if (overlap > bestOverlap || (overlap === bestOverlap && axisDist < bestAxisDist)) {
      best = screens[i];
      bestOverlap = overlap;
      bestAxisDist = axisDist;
    }
  }

  return best;
}
