#!/usr/bin/env node
// Unit tests for screens (enumeration + geometry queries) and window-filter
// (which windows kzones is allowed to touch).

import {
  screenName,
  screenRect,
  listScreens,
  findByName,
  containsPoint,
  screenAtPoint,
  screenContainingRect,
  overlapArea,
  screenForRect,
} from "../src/contents/code/screens.mjs";
import {
  isNormalWindow,
  parseFilterList,
  matchesUserFilter,
  isManaged,
  FILTER_MODE_INCLUDE,
  FILTER_MODE_EXCLUDE,
} from "../src/contents/code/window-filter.mjs";

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

const PRIMARY = { name: "DP-3", geometry: { x: 0, y: 0, width: 1440, height: 2560 } };
const SECONDARY = { name: "HDMI-A-1", geometry: { x: 1440, y: 163, width: 3840, height: 2160 } };
const SCREENS = [PRIMARY, SECONDARY];

// ---------------------------------------------------------------- basics
check("screenName reads the connector name", screenName(PRIMARY) === "DP-3");
check("screenName is empty for a missing screen", screenName(null) === "");

check("screenRect unwraps geometry", (() => {
  const r = screenRect(SECONDARY);
  return r.x === 1440 && r.y === 163 && r.width === 3840 && r.name === "HDMI-A-1";
})());

check("screenRect accepts a flat rect", (() => {
  const r = screenRect({ name: "X", x: 5, y: 6, width: 7, height: 8 });
  return r.x === 5 && r.height === 8;
})());

// KWin exposes outputs three different ways depending on Plasma version.
check("listScreens reads an array", listScreens({ screens: SCREENS }).length === 2);

check("listScreens reads an array-like", (() => {
  const arrayLike = { length: 2, 0: PRIMARY, 1: SECONDARY };
  return listScreens({ screens: arrayLike }).length === 2;
})());

check("listScreens falls back to numScreens/screenAt", (() => {
  const workspace = { numScreens: 2, screenAt: i => SCREENS[i] };
  return listScreens(workspace).length === 2;
})());

check("listScreens returns [] for a missing workspace", listScreens(null).length === 0);

check("listScreens reports enumeration failure", (() => {
  let reported = false;
  const hostile = { get screens() { throw new Error("boom"); } };
  const got = listScreens(hostile, () => { reported = true; });
  return got.length === 0 && reported;
})());

check("findByName locates a screen", findByName(SCREENS, "HDMI-A-1") === SECONDARY);
check("findByName returns null when absent", findByName(SCREENS, "DP-9") === null);

// ------------------------------------------------------------- containment
check("containsPoint accepts an interior point",
  containsPoint(screenRect(PRIMARY), 700, 1200));

check("containsPoint rejects an outside point",
  !containsPoint(screenRect(PRIMARY), 2000, 1200));

check("screenAtPoint finds the secondary screen",
  screenAtPoint(SCREENS, { x: 3000, y: 1000 }) === SECONDARY);

check("screenAtPoint returns null in a gap",
  screenAtPoint(SCREENS, { x: 2000, y: 50 }) === null);

check("screenContainingRect uses the rect's centre",
  screenContainingRect(SCREENS, { x: 1300, y: 200, width: 400, height: 400 }) === SECONDARY);

// ----------------------------------------------------------------- overlap
check("overlapArea computes the intersection",
  overlapArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 }) === 2500);

check("overlapArea is 0 when disjoint",
  overlapArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 }) === 0);

// A sliver bleeding onto the neighbour must not win the screen.
check("screenForRect ignores a bleeding sliver",
  screenForRect(SCREENS, { x: 1340, y: 300, width: 200, height: 800 }) === PRIMARY);

check("screenForRect picks the screen holding most of the window",
  screenForRect(SCREENS, { x: 1500, y: 300, width: 1200, height: 800 }) === SECONDARY);

check("screenForRect returns null without screens",
  screenForRect([], { x: 0, y: 0, width: 10, height: 10 }) === null);

// ----------------------------------------------------------- window filter
const normal = { normalWindow: true, popupWindow: false, skipTaskbar: false, resourceClass: "zen" };
const popup = { normalWindow: true, popupWindow: true, resourceClass: "zen" };
const panel = { normalWindow: false, resourceClass: "plasmashell" };

check("isNormalWindow accepts a normal window", isNormalWindow(normal));
check("isNormalWindow rejects a popup", !isNormalWindow(popup));
check("isNormalWindow rejects a panel", !isNormalWindow(panel));
check("isNormalWindow rejects null", !isNormalWindow(null));

check("parseFilterList splits and trims", (() => {
  const entries = parseFilterList("zen\n  konsole  \n\ndolphin\n");
  return entries.length === 3 && entries[1] === "konsole";
})());

check("parseFilterList handles an empty list", parseFilterList("").length === 0);

check("an empty filter matches everything",
  matchesUserFilter(normal, FILTER_MODE_INCLUDE, ""));

check("include mode keeps a listed window",
  matchesUserFilter(normal, FILTER_MODE_INCLUDE, "zen\nkonsole"));

check("include mode drops an unlisted window",
  !matchesUserFilter(normal, FILTER_MODE_INCLUDE, "konsole"));

check("exclude mode drops a listed window",
  !matchesUserFilter(normal, FILTER_MODE_EXCLUDE, "zen"));

check("exclude mode keeps an unlisted window",
  matchesUserFilter(normal, FILTER_MODE_EXCLUDE, "konsole"));

check("isManaged combines both rules",
  isManaged(normal, { filterMode: FILTER_MODE_INCLUDE, filterList: "zen" })
  && !isManaged(panel, { filterMode: FILTER_MODE_INCLUDE, filterList: "plasmashell" }));

check("isManaged tolerates a config without filter settings", isManaged(normal, {}));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
