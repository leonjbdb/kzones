#!/usr/bin/env node
// Unit tests for zone-math: the single definition of how a zone's percentages
// become a rect on a monitor, and the searches built on it. Runs offline (no
// QML / KWin).

import {
  zoneRect,
  zoneCenter,
  rectCenter,
  rectsMatch,
  closestZoneIndex,
  matchingZoneIndex,
  rectMatchesAnyZone,
  neighbourZoneIndex,
  specularZoneIndex,
  normalizeZone,
} from "../src/contents/code/zone-math.mjs";
import { setLayouts } from "../src/contents/code/layouts.mjs";

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log("PASS  " + name);
  } else {
    failed++;
    console.log("FAIL  " + name);
  }
}

function rectEq(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// DP-3 sits at the origin; HDMI-A-1 is offset, which is where the old
// screen-relative formula silently broke.
const PRIMARY = { x: 0, y: 0, width: 1440, height: 2560 };
const SECONDARY = { x: 1440, y: 163, width: 3840, height: 2160 };

const HALVES = [
  { x: 0, y: 0, width: 100, height: 50 },
  { x: 0, y: 50, width: 100, height: 50 },
];
const QUARTERS = [
  { x: 0, y: 0, width: 50, height: 50 },
  { x: 50, y: 0, width: 50, height: 50 },
  { x: 0, y: 50, width: 50, height: 50 },
  { x: 50, y: 50, width: 50, height: 50 },
];
const THIRDS_H = [
  { x: 0, y: 0, width: 33, height: 100 },
  { x: 33, y: 0, width: 34, height: 100 },
  { x: 67, y: 0, width: 33, height: 100 },
];

// ------------------------------------------------------------ normalizeZone
check("normalizeZone accepts width/height", (() => {
  const z = normalizeZone({ x: 1, y: 2, width: 3, height: 4 });
  return z.w === 3 && z.h === 4;
})());

check("normalizeZone accepts w/h", (() => {
  const z = normalizeZone({ x: 1, y: 2, w: 3, h: 4 });
  return z.w === 3 && z.h === 4;
})());

// ---------------------------------------------------------------- zoneRect
check("zoneRect covers the whole area for a full zone",
  rectEq(zoneRect({ x: 0, y: 0, width: 100, height: 100 }, 0, PRIMARY),
    { x: 0, y: 0, width: 1440, height: 2560 }));

check("zoneRect halves the area on the vertical axis",
  rectEq(zoneRect(HALVES[1], 0, PRIMARY), { x: 0, y: 1280, width: 1440, height: 1280 }));

// The regression that mattered: a zone on an offset monitor must be absolute.
check("zoneRect offsets by the screen origin",
  rectEq(zoneRect({ x: 0, y: 0, width: 50, height: 100 }, 0, SECONDARY),
    { x: 1440, y: 163, width: 1920, height: 2160 }));

check("zoneRect insets by padding",
  rectEq(zoneRect({ x: 0, y: 0, width: 100, height: 100 }, 10, PRIMARY),
    { x: 10, y: 10, width: 1420, height: 2540 }));

check("zoneRect returns null for a missing zone", zoneRect(null, 0, PRIMARY) === null);

// -------------------------------------------------------------- rectsMatch
check("rectsMatch tolerates rounding",
  rectsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 2, y: -1, width: 101, height: 98 }));

check("rectsMatch rejects a real difference",
  !rectsMatch({ x: 0, y: 0, width: 100, height: 100 }, { x: 40, y: 0, width: 100, height: 100 }));

// ------------------------------------------------------- centres / closest
check("zoneCenter is absolute", (() => {
  const c = zoneCenter({ x: 0, y: 0, width: 50, height: 100 }, SECONDARY);
  return c.x === 1440 + 960 && c.y === 163 + 1080;
})());

check("rectCenter halves the rect",
  rectCenter({ x: 10, y: 20, width: 100, height: 200 }).x === 60);

check("closestZoneIndex picks the bottom half for a low point",
  closestZoneIndex(HALVES, PRIMARY, { x: 720, y: 2400 }) === 1);

check("closestZoneIndex picks the top half for a high point",
  closestZoneIndex(HALVES, PRIMARY, { x: 720, y: 100 }) === 0);

check("closestZoneIndex works on an offset screen",
  closestZoneIndex(QUARTERS, SECONDARY, { x: 1440 + 3600, y: 163 + 2000 }) === 3);

check("closestZoneIndex returns null with no zones",
  closestZoneIndex([], PRIMARY, { x: 0, y: 0 }) === null);

// -------------------------------------------------------- matchingZoneIndex
check("matchingZoneIndex finds an exactly-placed window",
  matchingZoneIndex(HALVES, 0, PRIMARY, { x: 0, y: 1280, width: 1440, height: 1280 }) === 1);

check("matchingZoneIndex finds a padded window",
  matchingZoneIndex(HALVES, 10, PRIMARY, zoneRect(HALVES[0], 10, PRIMARY)) === 0);

check("matchingZoneIndex reports -1 for a floating window",
  matchingZoneIndex(HALVES, 0, PRIMARY, { x: 300, y: 400, width: 500, height: 500 }) === -1);

// ------------------------------------------------------ rectMatchesAnyZone
const LAYOUTS = [
  { name: "Portrait - Halves", screens: ["DP-3"], padding: 0, zones: HALVES },
  { name: "Landscape - Thirds", screens: ["HDMI-A-1"], padding: 0, zones: THIRDS_H },
  { name: "Padded", screens: ["DP-3"], padding: 20, zones: QUARTERS },
];
setLayouts(LAYOUTS);

check("rectMatchesAnyZone matches a zone of this screen's layout",
  rectMatchesAnyZone(LAYOUTS, "DP-3", PRIMARY, zoneRect(HALVES[1], 0, PRIMARY)));

// Padding used to be ignored, so every padded layout's windows were
// misclassified as floating and spuriously restored.
check("rectMatchesAnyZone honours layout padding",
  rectMatchesAnyZone(LAYOUTS, "DP-3", PRIMARY, zoneRect(QUARTERS[2], 20, PRIMARY)));

// A layout scoped to another monitor describes a different screen; counting it
// would classify arbitrary windows as snapped.
check("rectMatchesAnyZone ignores layouts scoped to another screen",
  !rectMatchesAnyZone(LAYOUTS, "DP-3", PRIMARY, zoneRect(THIRDS_H[1], 0, PRIMARY)));

check("rectMatchesAnyZone matches that layout on its own screen",
  rectMatchesAnyZone(LAYOUTS, "HDMI-A-1", SECONDARY, zoneRect(THIRDS_H[1], 0, SECONDARY)));

check("rectMatchesAnyZone rejects a floating rect",
  !rectMatchesAnyZone(LAYOUTS, "DP-3", PRIMARY, { x: 133, y: 251, width: 640, height: 480 }));

// ------------------------------------------------------- neighbourZoneIndex
check("neighbourZoneIndex finds the zone to the right",
  neighbourZoneIndex(THIRDS_H, 0, "right") === 1);

check("neighbourZoneIndex picks the NEAREST zone to the right",
  neighbourZoneIndex(THIRDS_H, 0, "right") !== 2);

check("neighbourZoneIndex finds the zone to the left",
  neighbourZoneIndex(THIRDS_H, 2, "left") === 1);

check("neighbourZoneIndex reports -1 past the edge",
  neighbourZoneIndex(THIRDS_H, 2, "right") === -1);

check("neighbourZoneIndex requires perpendicular overlap",
  neighbourZoneIndex(QUARTERS, 0, "down") === 2);

check("neighbourZoneIndex finds the zone above",
  neighbourZoneIndex(HALVES, 1, "up") === 0);

check("neighbourZoneIndex reports -1 above the top zone",
  neighbourZoneIndex(HALVES, 0, "up") === -1);

// ------------------------------------------------------- specularZoneIndex
check("specularZoneIndex mirrors left third to right third",
  specularZoneIndex(THIRDS_H, 0, false) === 2);

check("specularZoneIndex mirrors right third to left third",
  specularZoneIndex(THIRDS_H, 2, false) === 0);

check("specularZoneIndex mirrors top half to bottom half vertically",
  specularZoneIndex(HALVES, 0, true) === 1);

check("specularZoneIndex keeps a centred zone where it is",
  specularZoneIndex(THIRDS_H, 1, false) === 1);

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
