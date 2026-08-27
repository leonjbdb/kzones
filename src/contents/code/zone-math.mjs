// Zone geometry in pixel space: the single definition of how a zone's
// percentages become a rect on a monitor, plus the searches built on it
// (closest zone, matching zone, directional neighbour, specular partner).
//
// Every consumer — the overlay renderer, drag-snapping, hotkey snapping and
// state classification — must agree on this formula, so it lives in one place.
// Pure data in, pure data out, so it runs under `node` for unit tests.

import { isArrayLike, layoutAppliesToScreen } from "./layouts.mjs";

// Frame geometry a window lands on is rounded, so comparisons need slack.
export const MATCH_TOLERANCE = 4;

// Config zones use width/height; the meta-arrow pool uses w/h. Accept both.
export function normalizeZone(zone) {
  if (!zone) return null;
  const w = (zone.w !== undefined) ? zone.w : zone.width;
  const h = (zone.h !== undefined) ? zone.h : zone.height;
  return { x: +zone.x, y: +zone.y, w: +w, h: +h };
}

// Zones are inset by `padding` on top/left, and adjacent zones leave a
// `padding` gap between them. The result is absolute (screen-space): callers
// compare it against frameGeometry, which is absolute too.
export function zoneRect(zone, padding, clientArea) {
  const z = normalizeZone(zone);
  if (!z || !clientArea) return null;
  const p = padding || 0;
  return {
    x: Math.round(((z.x / 100) * (clientArea.width - p)) + p + clientArea.x),
    y: Math.round(((z.y / 100) * (clientArea.height - p)) + p + clientArea.y),
    width: Math.round(((z.w / 100) * (clientArea.width - p)) - p),
    height: Math.round(((z.h / 100) * (clientArea.height - p)) - p),
  };
}

export function fullScreenRect(clientArea) {
  return {
    x: Math.round(clientArea.x),
    y: Math.round(clientArea.y),
    width: Math.round(clientArea.width),
    height: Math.round(clientArea.height),
  };
}

// Zone centre in absolute pixels. Padding is deliberately ignored: a centre
// shifts by at most half a padding, far below the distances being compared.
export function zoneCenter(zone, clientArea) {
  const z = normalizeZone(zone);
  return {
    x: (z.x + z.w / 2) / 100 * clientArea.width + clientArea.x,
    y: (z.y + z.h / 2) / 100 * clientArea.height + clientArea.y,
  };
}

export function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectsMatch(a, b, tolerance = MATCH_TOLERANCE) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= tolerance
      && Math.abs(a.y - b.y) <= tolerance
      && Math.abs(a.width - b.width) <= tolerance
      && Math.abs(a.height - b.height) <= tolerance;
}

export function closestZoneIndex(zones, clientArea, point) {
  let closest = null;
  let closestDistance = Infinity;
  for (let i = 0; i < zones.length; i++) {
    const c = zoneCenter(zones[i], clientArea);
    const dx = point.x - c.x;
    const dy = point.y - c.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < closestDistance) {
      closest = i;
      closestDistance = distance;
    }
  }
  return closest;
}

// Index of the zone whose rect matches `rect`, or -1.
export function matchingZoneIndex(zones, padding, clientArea, rect, tolerance = MATCH_TOLERANCE) {
  for (let i = 0; i < zones.length; i++) {
    if (rectsMatch(zoneRect(zones[i], padding, clientArea), rect, tolerance)) return i;
  }
  return -1;
}

// True when `rect` matches a zone of any layout available on this screen.
//
// Layouts scoped to other screens are skipped: their zones describe a
// different monitor, and counting them would classify an arbitrary window as
// snapped. Padding is applied, without which every padded layout failed to
// match and its windows were misclassified as floating.
export function rectMatchesAnyZone(layouts, screenId, clientArea, rect, tolerance = MATCH_TOLERANCE) {
  if (!rect || !clientArea || !clientArea.width || !clientArea.height) return false;
  if (!isArrayLike(layouts)) return false;
  for (let li = 0; li < layouts.length; li++) {
    const layout = layouts[li];
    if (!layout || !isArrayLike(layout.zones)) continue;
    if (!layoutAppliesToScreen(layout, screenId)) continue;
    if (matchingZoneIndex(layout.zones, layout.padding || 0, clientArea, rect, tolerance) !== -1) return true;
  }
  return false;
}

// Nearest zone that borders `fromIndex` on the given side, in percent space.
// Returns -1 when the zone has no neighbour that way (caller then decides
// whether to hand off to the next monitor).
export function neighbourZoneIndex(zones, fromIndex, direction) {
  const current = normalizeZone(zones[fromIndex]);
  if (!current) return -1;

  let target = -1;
  let minDistance = Infinity;

  for (let i = 0; i < zones.length; i++) {
    if (i === fromIndex) continue;
    const zone = normalizeZone(zones[i]);
    if (!zone) continue;

    // A neighbour must sit past the current zone on the travel axis and
    // overlap it on the other axis.
    const overlapsVertically = zone.y < current.y + current.h && zone.y + zone.h > current.y;
    const overlapsHorizontally = zone.x < current.x + current.w && zone.x + zone.w > current.x;

    let isNeighbour = false;
    let distance = Infinity;
    switch (direction) {
      case "left":
        isNeighbour = zone.x + zone.w <= current.x && overlapsVertically;
        distance = current.x - (zone.x + zone.w);
        break;
      case "right":
        isNeighbour = zone.x >= current.x + current.w && overlapsVertically;
        distance = zone.x - (current.x + current.w);
        break;
      case "up":
        isNeighbour = zone.y + zone.h <= current.y && overlapsHorizontally;
        distance = current.y - (zone.y + zone.h);
        break;
      case "down":
        isNeighbour = zone.y >= current.y + current.h && overlapsHorizontally;
        distance = zone.y - (current.y + current.h);
        break;
    }

    if (isNeighbour && distance < minDistance) {
      minDistance = distance;
      target = i;
    }
  }
  return target;
}

// The zone mirrored across the screen's centre line from `fromIndex`, used to
// keep a window on the equivalent side after it crosses to another monitor.
// Falls back to `fromIndex` when the layout has no mirror partner.
export function specularZoneIndex(zones, fromIndex, verticalAxis = false) {
  const current = normalizeZone(zones[fromIndex]);
  if (!current) return fromIndex;

  const currentCenter = { x: current.x + current.w / 2, y: current.y + current.h / 2 };
  const ALIGNMENT_TOLERANCE = 5;

  let specular = null;
  let minDistance = Infinity;

  for (let i = 0; i < zones.length; i++) {
    if (i === fromIndex) continue;
    const zone = normalizeZone(zones[i]);
    if (!zone) continue;
    const center = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };

    const isSpecular = verticalAxis
      ? Math.abs(center.x - currentCenter.x) < ALIGNMENT_TOLERANCE
        && Math.abs((center.y - 50) - (50 - currentCenter.y)) < ALIGNMENT_TOLERANCE
      : Math.abs(center.y - currentCenter.y) < ALIGNMENT_TOLERANCE
        && Math.abs((center.x - 50) - (50 - currentCenter.x)) < ALIGNMENT_TOLERANCE;
    if (!isSpecular) continue;

    const mirrored = {
      x: verticalAxis ? currentCenter.x : (100 - currentCenter.x),
      y: verticalAxis ? (100 - currentCenter.y) : currentCenter.y,
    };
    const dx = center.x - mirrored.x;
    const dy = center.y - mirrored.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < minDistance) {
      specular = i;
      minDistance = distance;
    }
  }

  return specular !== null ? specular : fromIndex;
}
