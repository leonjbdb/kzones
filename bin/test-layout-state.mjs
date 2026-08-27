#!/usr/bin/env node
// Unit tests for layout-state (which layout is active, and where that choice
// is remembered) and layouts (the catalogue + per-screen filtering).

import {
  isAvailable,
  firstAvailableIndex,
  nextAvailableIndex,
  layoutKey,
  isTracked,
  resolveLayout,
  rememberLayout,
} from "../src/contents/code/layout-state.mjs";
import {
  setLayouts,
  getLayoutsForScreen,
  layoutAppliesToScreen,
  hasScreenScopedLayout,
  layoutAt,
  zonesAt,
  paddingAt,
} from "../src/contents/code/layouts.mjs";

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

const LAYOUTS = [
  { name: "Portrait A", screens: ["DP-3"], zones: [{ x: 0, y: 0, width: 100, height: 50 }] },
  { name: "Portrait B", screens: ["DP-3"], padding: 12, zones: [{ x: 0, y: 0, width: 100, height: 100 }] },
  { name: "Landscape A", screens: ["HDMI-A-1"], zones: [{ x: 0, y: 0, width: 50, height: 100 }] },
  { name: "Everywhere", zones: [{ x: 0, y: 0, width: 100, height: 100 }] },
];
setLayouts(LAYOUTS);

const onPrimary = getLayoutsForScreen("DP-3");
const onSecondary = getLayoutsForScreen("HDMI-A-1");

// ------------------------------------------------------------- the catalogue
check("getLayoutsForScreen returns this screen's layouts plus unscoped ones",
  onPrimary.length === 3 && onPrimary[0].index === 0 && onPrimary[2].index === 3);

check("getLayoutsForScreen keeps original indices",
  onSecondary.length === 2 && onSecondary[0].index === 2 && onSecondary[1].index === 3);

check("a layout with no screens applies everywhere",
  layoutAppliesToScreen(LAYOUTS[3], "anything"));

check("a layout with an empty screens list applies everywhere",
  layoutAppliesToScreen({ screens: [] }, "DP-3"));

check("a scoped layout does not apply elsewhere",
  !layoutAppliesToScreen(LAYOUTS[0], "HDMI-A-1"));

check("hasScreenScopedLayout detects a scoped config", hasScreenScopedLayout());

check("layoutAt rejects negative indices", layoutAt(-1) === null);
check("zonesAt returns [] for a missing layout", zonesAt(99).length === 0);
check("paddingAt defaults to 0", paddingAt(0) === 0);
check("paddingAt reads the layout's padding", paddingAt(1) === 12);

// --------------------------------------------------------------- availability
check("isAvailable finds a listed layout", isAvailable(onPrimary, 3));
check("isAvailable rejects a layout scoped to another screen", !isAvailable(onPrimary, 2));

check("firstAvailableIndex returns the first index", firstAvailableIndex(onSecondary) === 2);

// -1 rather than 0: falling back to layout 0 handed back a layout the screen
// filter had just excluded.
check("firstAvailableIndex reports -1 when nothing applies", firstAvailableIndex([]) === -1);

// -------------------------------------------------------------------- cycling
check("nextAvailableIndex steps forward", nextAvailableIndex(onPrimary, 0, 1) === 1);
check("nextAvailableIndex wraps forward", nextAvailableIndex(onPrimary, 3, 1) === 0);
check("nextAvailableIndex steps backward", nextAvailableIndex(onPrimary, 1, -1) === 0);
check("nextAvailableIndex wraps backward", nextAvailableIndex(onPrimary, 0, -1) === 3);
check("nextAvailableIndex reports -1 with no layouts", nextAvailableIndex([], 0, 1) === -1);

// An index that is not on this screen has position -1; stepping forward from
// there must still land on a real entry.
check("nextAvailableIndex recovers from an unavailable current index",
  onPrimary.some(e => e.index === nextAvailableIndex(onPrimary, 2, 1)));

// ------------------------------------------------------------------- the key
check("layoutKey is empty when tracking nothing",
  layoutKey({ trackPerScreen: false, trackPerDesktop: false, screenName: "DP-3", desktopId: 7 }) === "");

check("layoutKey scopes by screen",
  layoutKey({ trackPerScreen: true, trackPerDesktop: false, screenName: "DP-3", desktopId: 7 }) === "DP-3");

check("layoutKey scopes by desktop",
  layoutKey({ trackPerScreen: false, trackPerDesktop: true, screenName: "DP-3", desktopId: 7 }) === "7");

check("layoutKey scopes by both",
  layoutKey({ trackPerScreen: true, trackPerDesktop: true, screenName: "DP-3", desktopId: 7 }) === "DP-3:7");

check("isTracked is false only when tracking nothing",
  !isTracked({ trackPerScreen: false, trackPerDesktop: false })
  && isTracked({ trackPerScreen: true, trackPerDesktop: false })
  && isTracked({ trackPerScreen: false, trackPerDesktop: true }));

// --------------------------------------------------------------- resolution
check("resolveLayout stores a first choice per key", (() => {
  const store = {};
  const got = resolveLayout({ store, key: "DP-3", tracked: true, availableLayouts: onPrimary, currentIndex: 0 });
  return got === 0 && store["DP-3"] === 0;
})());

check("resolveLayout keeps separate layouts per screen", (() => {
  const store = {};
  resolveLayout({ store, key: "DP-3", tracked: true, availableLayouts: onPrimary, currentIndex: 0 });
  rememberLayout({ store, key: "DP-3", tracked: true, index: 1 });
  const secondary = resolveLayout({ store, key: "HDMI-A-1", tracked: true, availableLayouts: onSecondary, currentIndex: 1 });
  return store["DP-3"] === 1 && secondary === 2;
})());

// The stored index is repaired when a monitor change makes it invalid.
check("resolveLayout repairs a stored index the screen no longer allows", (() => {
  const store = { "DP-3": 2 };
  const got = resolveLayout({ store, key: "DP-3", tracked: true, availableLayouts: onPrimary, currentIndex: 0 });
  return got === 0 && store["DP-3"] === 0;
})());

check("resolveLayout untracked keeps a valid current index",
  resolveLayout({ store: {}, key: "", tracked: false, availableLayouts: onPrimary, currentIndex: 3 }) === 3);

check("resolveLayout untracked repairs an invalid current index",
  resolveLayout({ store: {}, key: "", tracked: false, availableLayouts: onPrimary, currentIndex: 2 }) === 0);

check("resolveLayout reports -1 when the screen has no layouts",
  resolveLayout({ store: {}, key: "X", tracked: true, availableLayouts: [], currentIndex: 0 }) === -1);

check("rememberLayout is a no-op when untracked", (() => {
  const store = {};
  rememberLayout({ store, key: "", tracked: false, index: 2 });
  return Object.keys(store).length === 0;
})());

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
