// The layout catalogue: the parsed user layouts plus the rules deciding which
// of them apply to a given screen.
//
// Held here rather than read back from `config.layouts` because QML coerces a
// JS array to QVariantList when it crosses the property boundary, which loses
// Array identity (`Array.isArray` starts returning false). Keeping the native
// reference module-side means every consumer sees a real Array.

let layouts = [];

// QML wraps JS arrays as QVariantList across the property-var boundary, so
// `Array.isArray` is not a reliable test for anything reaching us from QML.
export function isArrayLike(value) {
  return value != null && typeof value !== "string" && typeof value.length === "number";
}

export function setLayouts(next) {
  layouts = isArrayLike(next) ? next : [];
}

export function getLayouts() {
  return layouts;
}

export function layoutAt(index) {
  if (index == null || index < 0) return null;
  return layouts[index] || null;
}

export function zonesAt(index) {
  const layout = layoutAt(index);
  return (layout && isArrayLike(layout.zones)) ? layout.zones : [];
}

export function paddingAt(index) {
  const layout = layoutAt(index);
  return (layout && layout.padding) || 0;
}

// Missing/empty `screens` means: apply to every monitor (back-compat).
export function layoutAppliesToScreen(layout, screenId) {
  if (!layout) return true;
  const screens = layout.screens;
  if (!isArrayLike(screens) || screens.length === 0) return true;
  for (let i = 0; i < screens.length; i++) {
    if (String(screens[i]) === screenId) return true;
  }
  return false;
}

// Returns [{ layout, index }, ...] visible on `screenId`. `index` is the
// position in the unfiltered layouts array so callers can keep referring to
// layouts by their original index.
export function getLayoutsForScreen(screenId) {
  const out = [];
  for (let i = 0; i < layouts.length; i++) {
    if (layoutAppliesToScreen(layouts[i], screenId)) out.push({ layout: layouts[i], index: i });
  }
  return out;
}

// True when any layout restricts itself to specific screens. Such a config
// forces per-screen layout tracking: without it, switching screens could land
// on a layout index the filter hides on the new screen.
export function hasScreenScopedLayout() {
  for (let i = 0; i < layouts.length; i++) {
    const screens = layouts[i] && layouts[i].screens;
    if (isArrayLike(screens) && screens.length > 0) return true;
  }
  return false;
}
