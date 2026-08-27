// Which layout is active, and where that choice is remembered.
//
// The active layout is scoped by the user's tracking settings: globally, per
// screen, per virtual desktop, or per screen+desktop pair. The store is a
// plain object owned by the caller so QML keeps its property semantics.

export function isAvailable(availableLayouts, index) {
  for (let i = 0; i < availableLayouts.length; i++) {
    if (availableLayouts[i].index === index) return true;
  }
  return false;
}

// Index of the first layout on this screen. Callers treat the `-1` from an
// empty list as "no layout applies here" and skip the action, rather than
// falling back to layout 0 — which is a layout the screen filter just excluded.
export function firstAvailableIndex(availableLayouts) {
  return availableLayouts.length > 0 ? availableLayouts[0].index : -1;
}

export function nextAvailableIndex(availableLayouts, currentIndex, step) {
  if (availableLayouts.length === 0) return -1;
  let position = -1;
  for (let i = 0; i < availableLayouts.length; i++) {
    if (availableLayouts[i].index === currentIndex) {
      position = i;
      break;
    }
  }
  const count = availableLayouts.length;
  const next = ((position + step) % count + count) % count;
  return availableLayouts[next].index;
}

// Storage key for the active layout under the current tracking settings.
// Empty string means "one layout for everything".
export function layoutKey({ trackPerScreen, trackPerDesktop, screenName, desktopId }) {
  const parts = [];
  if (trackPerScreen && screenName) parts.push(String(screenName));
  if (trackPerDesktop && desktopId != null) parts.push(String(desktopId));
  return parts.join(":");
}

export function isTracked({ trackPerScreen, trackPerDesktop }) {
  return !!(trackPerScreen || trackPerDesktop);
}

// Resolves the layout that should be active, repairing a stored or current
// index that the screen filter no longer allows.
export function resolveLayout({ store, key, tracked, availableLayouts, currentIndex }) {
  if (tracked) {
    const stored = store[key];
    if (stored === undefined || !isAvailable(availableLayouts, stored)) {
      store[key] = firstAvailableIndex(availableLayouts);
    }
    return store[key];
  }
  if (!isAvailable(availableLayouts, currentIndex)) return firstAvailableIndex(availableLayouts);
  return currentIndex;
}

export function rememberLayout({ store, key, tracked, index }) {
  if (tracked) store[key] = index;
}
