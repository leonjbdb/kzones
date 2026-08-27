// KWin API handles, QML component registry, and configuration loading.
//
// Layout filtering lives in layouts.mjs and screen geometry in screens.mjs;
// this module only wires KWin's config into those.

import { setLayouts, hasScreenScopedLayout } from "./layouts.mjs";
import { listScreens } from "./screens.mjs";

export let KWin = null;
export let Workspace = null;
export let QML = {};
export let config = {};

const DEFAULT_LAYOUTS = [
  {
    name: "Priority Grid",
    padding: 0,
    zones: [
      { x: 0, y: 0, height: 100, width: 25 },
      { x: 25, y: 0, height: 100, width: 50 },
      { x: 75, y: 0, height: 100, width: 25 },
    ],
  },
  {
    name: "Quadrant Grid",
    zones: [
      { x: 0, y: 0, height: 50, width: 50 },
      { x: 0, y: 50, height: 50, width: 50 },
      { x: 50, y: 50, height: 50, width: 50 },
      { x: 50, y: 0, height: 50, width: 50 },
    ],
  },
];

// [key, default] for every scalar setting. Table-driven so adding a setting
// means adding one row rather than another near-identical readConfig line.
const SETTINGS = [
  ["enableZoneSelector", true],
  ["zoneSelectorTriggerDistance", 1],
  ["enableZoneOverlay", true],
  ["zoneOverlayShowWhen", 0],
  ["zoneOverlayHighlightTarget", 0],
  ["zoneOverlayIndicatorDisplay", 0],
  ["enableEdgeSnapping", false],
  ["edgeSnappingTriggerDistance", 1],
  ["enableFullscreenSnap", true],
  ["fullscreenSnapPadding", 0],
  ["rememberWindowGeometries", true],
  ["trackLayoutPerScreen", false],
  ["smartHotkeys", false],
  ["trackLayoutPerDesktop", false],
  ["showOsdMessages", true],
  ["fadeWindowsWhileMoving", false],
  ["autoSnapAllNew", false],
  ["filterMode", 0],
  ["filterList", ""],
  ["pollingRate", 100],
  ["enableDebugLogging", false],
  ["enableDebugOverlay", false],
];

export function init(kwin, workspace) {
  console.log("KZones: Loading APIs...");
  KWin = kwin || null;
  Workspace = workspace || null;
}

export function registerQMLComponent(name, component) {
  console.log("KZones: Registering QML component:", name);
  try {
    QML[name] = component;
  } catch (error) {
    console.error("KZones: Error registering QML component:", error);
  }
}

// Enumerate attached monitors. Surfaces the connector names users need for the
// per-layout `screens` field; KWin scripting can't auto-populate the KCM.
export function getDetectedScreens() {
  return listScreens(Workspace, e => console.error("KZones: screen enumeration failed:", e)).map(s => {
    const g = (s && s.geometry) || {};
    return {
      name: (s && s.name) ? String(s.name) : "",
      width: g.width || 0,
      height: g.height || 0,
    };
  });
}

// Parses the layout JSON, returning the defaults and an error message when the
// user's JSON is malformed. Split out from loadConfig so the failure is
// reportable rather than silently swallowed — a bad config used to look
// exactly like a working one.
export function parseLayouts(raw) {
  try {
    return { layouts: JSON.parse(raw), error: null };
  } catch (e) {
    return { layouts: DEFAULT_LAYOUTS, error: String(e && e.message ? e.message : e) };
  }
}

export function loadConfig() {
  console.log("KZones: Loading config...");

  const parsed = parseLayouts(KWin.readConfig("layoutsJson", JSON.stringify(DEFAULT_LAYOUTS)));
  setLayouts(parsed.layouts);
  config.layoutsError = parsed.error;

  for (let i = 0; i < SETTINGS.length; i++) {
    const key = SETTINGS[i][0];
    config[key] = KWin.readConfig(key, SETTINGS[i][1]);
  }

  // Any screen-scoped layout forces per-screen tracking; otherwise switching
  // screens could land on an index hidden by the filter.
  config.trackLayoutPerScreen = config.trackLayoutPerScreen || hasScreenScopedLayout();
  config.layouts = parsed.layouts;

  QML.root.config = config;

  if (parsed.error) console.error("KZones: invalid layout JSON, using defaults:", parsed.error);
  console.log("KZones: Config loaded:", JSON.stringify(config));
}
