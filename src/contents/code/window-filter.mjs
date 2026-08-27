// Decides which windows kzones is allowed to touch: structural exclusions
// (docks, panels, popups) plus the user's allow/deny list.

export const FILTER_MODE_INCLUDE = 0;
export const FILTER_MODE_EXCLUDE = 1;

// Docks, panels, popups and taskbar-skipping windows are never tiled.
export function isNormalWindow(client) {
  if (!client) return false;
  return !!client.normalWindow && !client.popupWindow && !client.skipTaskbar;
}

export function parseFilterList(filterList) {
  if (!filterList) return [];
  return String(filterList)
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

export function matchesUserFilter(client, filterMode, filterList) {
  const entries = parseFilterList(filterList);
  if (entries.length === 0) return true;
  const resourceClass = (client && client.resourceClass) ? String(client.resourceClass) : "";
  const listed = entries.indexOf(resourceClass) !== -1;
  return (filterMode === FILTER_MODE_EXCLUDE) ? !listed : listed;
}

export function isManaged(client, config) {
  if (!isNormalWindow(client)) return false;
  return matchesUserFilter(client, config ? config.filterMode : FILTER_MODE_INCLUDE, config ? config.filterList : "");
}
