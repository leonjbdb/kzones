import "../code/core.mjs" as Core
import "../code/layout-state.mjs" as LayoutState
import "../code/layouts.mjs" as Layouts
import "../code/meta-arrow/geometry.mjs" as MetaGeom
import "../code/meta-arrow/move-memory.mjs" as MoveMemory
import "../code/meta-arrow/snap-executor.mjs" as SnapExecutor
import "../code/meta-arrow/snap-planner.mjs" as SnapPlanner
import "../code/pristine-geometry.mjs" as Pristine
import "../code/screens.mjs" as Screens
import "../code/utils.mjs" as Utils
import "../code/window-filter.mjs" as WindowFilter
import "../code/zone-math.mjs" as ZoneMath
import QtQuick
import QtQuick.Layouts
import "components" as Components
import org.kde.kwin
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.core as PlasmaCore

Item {
    id: root

    property var config: new Object()
    property bool moving: false
    property bool moved: false
    property bool resizing: false
    property var clientArea: new Object()
    property var displaySize: new Object()
    property int currentLayout: 0
    property var screenLayouts: new Object()
    property int highlightedZone: -1
    property bool fullscreenPendingSnap: false
    property var activeScreen: null
    // [{ layout, index }, ...] — layouts visible on activeScreen. `index` is
    // the position in the unfiltered config.layouts so existing references
    // (client.layout, repeaterLayout.itemAt(...), etc.) stay valid.
    property var availableLayouts: []
    property bool showZoneOverlay: config.zoneOverlayShowWhen == 0
    property var lastActiveWindow: null

    // ── screens ───────────────────────────────────────────────────────────

    function screenList() {
        return Screens.listScreens(Workspace, function(e) {
            Utils.log("screen enumeration failed: " + e);
        });
    }

    function areaOfScreen(screen) {
        if (!screen)
            return null;

        try {
            const area = Workspace.clientArea(KWin.FullScreenArea, screen, Workspace.currentDesktop);
            if (area && area.width && area.height)
                return area;
        } catch (e) {
            Utils.log("clientArea lookup failed: " + e);
        }
        return null;
    }

    function areaOfScreenNamed(screenName) {
        const area = areaOfScreen(Screens.findByName(screenList(), screenName));
        if (!area)
            return null;

        return {
            "x": area.x,
            "y": area.y,
            "width": area.width,
            "height": area.height
        };
    }

    // The screen a window currently occupies, derived from its frame rather
    // than from client.screen: during a cross-monitor jump the geometry change
    // fires before KWin updates client.screen, so trusting the latter
    // mid-transition evaluates the window against the wrong monitor.
    function screenOfClient(client) {
        if (!client || !client.frameGeometry)
            return activeScreen;

        return Screens.screenContainingRect(screenList(), client.frameGeometry) || activeScreen;
    }

    function areaOfClient(client) {
        return areaOfScreen(screenOfClient(client)) || clientArea;
    }

    // ── active screen / layout ────────────────────────────────────────────

    function refreshClientArea(screen) {
        activeScreen = screen || Workspace.activeScreen;
        clientArea = Workspace.clientArea(KWin.FullScreenArea, activeScreen, Workspace.currentDesktop);
        displaySize = Workspace.virtualScreenSize;
        availableLayouts = Layouts.getLayoutsForScreen(Screens.screenName(activeScreen));
        currentLayout = getCurrentLayout();
    }

    function isLayoutAvailable(index) {
        return LayoutState.isAvailable(availableLayouts, index);
    }

    function layoutTracking() {
        return {
            "trackPerScreen": config.trackLayoutPerScreen,
            "trackPerDesktop": config.trackLayoutPerDesktop,
            // Prefer the QML `activeScreen` property — it tracks kzones's
            // notion of the active screen, which refreshClientArea() updates
            // eagerly during cross-monitor smart-snap jumps.
            // `Workspace.activeScreen` is owned by KWin and only switches when
            // the cursor or focus moves, so it lags during a jump and would
            // key per-screen layout storage to the SOURCE screen instead of
            // the DESTINATION.
            "screenName": Screens.screenName(activeScreen) || Screens.screenName(Workspace.activeScreen),
            "desktopId": Workspace.currentDesktop && Workspace.currentDesktop.id
        };
    }

    function getCurrentLayout() {
        const tracking = layoutTracking();
        return LayoutState.resolveLayout({
            "store": screenLayouts,
            "key": LayoutState.layoutKey(tracking),
            "tracked": LayoutState.isTracked(tracking),
            "availableLayouts": availableLayouts,
            "currentIndex": currentLayout
        });
    }

    function setCurrentLayout(index) {
        if (!isLayoutAvailable(index))
            return ;

        const tracking = layoutTracking();
        LayoutState.rememberLayout({
            "store": screenLayouts,
            "key": LayoutState.layoutKey(tracking),
            "tracked": LayoutState.isTracked(tracking),
            "index": index
        });
        currentLayout = index;
    }

    function cycleLayout(step) {
        clearMetaArrowMemory(Workspace.activeWindow);
        refreshClientArea(Screens.screenAtPoint(screenList(), Workspace.cursorPos));
        const next = LayoutState.nextAvailableIndex(availableLayouts, currentLayout, step);
        if (next === -1)
            return ;

        setCurrentLayout(next);
        highlightedZone = -1;
        showLayoutOsd();
    }

    // ── window state classification ───────────────────────────────────────

    function computeWindowState(client) {
        if (!client)
            return Pristine.FLOATING;

        if (client.fullScreen)
            return Pristine.FULLSCREEN;

        if (client.maximizeMode !== undefined && client.maximizeMode !== null && client.maximizeMode !== 0)
            return Pristine.FULLSCREEN;

        const screen = screenOfClient(client);
        const area = areaOfScreen(screen) || clientArea;
        if (MetaGeom.isFullscreenSized(client, area))
            return Pristine.FULLSCREEN;

        if (ZoneMath.rectMatchesAnyZone(config.layouts, Screens.screenName(screen), area, client.frameGeometry))
            return Pristine.SNAPPED;

        return Pristine.FLOATING;
    }

    // ── zone assignment ───────────────────────────────────────────────────

    function isManaged(client) {
        return WindowFilter.isManaged(client, config);
    }

    function saveClientProperties(client, zone, layout) {
        Utils.log("Saving geometry for client " + client.resourceClass.toString());
        client.zone = zone;
        client.layout = (layout === undefined) ? currentLayout : layout;
        client.desktop = Workspace.currentDesktop;
        client.activity = Workspace.currentActivity;
    }

    // Tags a client with the zone its geometry already occupies, without
    // moving it. Used after a manual resize and for windows that spawn
    // pre-positioned.
    function matchZone(client) {
        if (!client || !client.frameGeometry)
            return ;

        refreshClientArea();
        const zones = Layouts.zonesAt(currentLayout);
        const index = ZoneMath.matchingZoneIndex(zones, Layouts.paddingAt(currentLayout), clientArea, client.frameGeometry);
        client.zone = index;
        if (index !== -1)
            client.layout = currentLayout;

    }

    function moveClientToZone(client, zone) {
        if (!isManaged(client))
            return ;

        Utils.log("Moving client " + client.resourceClass.toString() + " to zone " + zone);
        refreshClientArea();
        saveClientProperties(client, zone);
        if (zone === -1)
            return ;

        const rect = ZoneMath.zoneRect(Layouts.zonesAt(currentLayout)[zone], Layouts.paddingAt(currentLayout), clientArea);
        if (!rect)
            return ;

        client.setMaximize(false, false);
        client.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
    }

    // Steps the active window to the next/previous zone of the current
    // layout, wrapping around.
    function shiftActiveWindowZone(step) {
        const client = Workspace.activeWindow;
        if (!client)
            return ;

        clearMetaArrowMemory(client);
        if (client.zone == -1)
            moveClientToClosestZone(client);

        const zoneCount = Layouts.zonesAt(currentLayout).length;
        if (zoneCount === 0)
            return ;

        moveClientToZone(client, ((client.zone + step) % zoneCount + zoneCount) % zoneCount);
    }

    function moveClientToClosestZone(client) {
        if (!isManaged(client))
            return null;

        Utils.log("Moving client " + client.resourceClass.toString() + " to closest zone");
        refreshClientArea();
        const zones = Layouts.zonesAt(currentLayout);
        const closest = ZoneMath.closestZoneIndex(zones, clientArea, ZoneMath.rectCenter(client.frameGeometry));
        if (closest === null)
            return null;

        if (client.zone !== closest || client.layout !== currentLayout)
            moveClientToZone(client, closest);

        return closest;
    }

    function moveAllClientsToClosestZone() {
        Utils.log("Moving all clients to closest zone");
        let count = 0;
        for (let i = 0; i < Workspace.stackingOrder.length; i++) {
            const client = Workspace.stackingOrder[i];
            if (client.move)
                continue;

            // Compare against null explicitly: zone 0 is a valid result and a
            // truthiness test silently dropped it from the count.
            if (moveClientToClosestZone(client) !== null)
                count++;

        }
        Utils.log("Moved " + count + " clients to closest zone");
        return count;
    }

    function moveClientToNeighbour(client, direction) {
        if (!isManaged(client))
            return null;

        Utils.log("Moving client " + client.resourceClass.toString() + " to neighbour " + direction);
        refreshClientArea();
        const zones = Layouts.zonesAt(currentLayout);
        if (client.zone === -1 || client.layout !== currentLayout) {
            moveClientToClosestZone(client);
            return client.zone;
        }
        const target = ZoneMath.neighbourZoneIndex(zones, client.zone, direction);
        if (target !== -1) {
            moveClientToZone(client, target);
            return target;
        }
        // No neighbour this way: hand the window to the adjacent monitor,
        // landing on the mirrored zone so it keeps the equivalent position.
        if (config.trackLayoutPerScreen)
            return target;

        const toScreenSlot = {
            "left": "slotWindowToPrevScreen",
            "right": "slotWindowToNextScreen",
            "up": "slotWindowToAboveScreen",
            "down": "slotWindowToBelowScreen"
        };
        const slot = toScreenSlot[direction];
        if (slot && Workspace[slot]) {
            const verticalAxis = direction === "up" || direction === "down";
            const closest = ZoneMath.closestZoneIndex(zones, clientArea, ZoneMath.rectCenter(client.frameGeometry));
            const specular = (closest === null) ? null : ZoneMath.specularZoneIndex(zones, closest, verticalAxis);
            Workspace[slot]();
            if (specular !== null)
                moveClientToZone(client, specular);

        }
        return target;
    }

    // ── zone occupancy ────────────────────────────────────────────────────

    function getWindowsInZone(zone, layout) {
        const windows = [];
        const activeWindow = Workspace.activeWindow;
        if (!activeWindow)
            return windows;

        for (let i = 0; i < Workspace.stackingOrder.length; i++) {
            const client = Workspace.stackingOrder[i];
            if (client.zone === zone && client.layout === layout && client.desktop === Workspace.currentDesktop && client.activity === Workspace.currentActivity && client.screen === activeWindow.screen && isManaged(client))
                windows.push(client);

        }
        return windows;
    }

    function switchActiveWindowInZone(reverse) {
        const client = Workspace.activeWindow;
        if (!client)
            return ;

        switchWindowInZone(client.zone, client.layout, reverse);
    }

    function switchWindowInZone(zone, layout, reverse) {
        const clientsInZone = getWindowsInZone(zone, layout);
        if (clientsInZone.length === 0)
            return ;

        if (reverse)
            clientsInZone.reverse();

        const index = clientsInZone.indexOf(Workspace.activeWindow);
        Workspace.activeWindow = (index === -1) ? clientsInZone[0] : clientsInZone[(index + 1) % clientsInZone.length];
    }

    // ── smart (meta+arrow) snapping ───────────────────────────────────────

    function snapExecutorDeps() {
        return {
            "getClientAreaForScreen": areaOfScreenNamed,
            "getFullscreenPadding": function() {
                return config.fullscreenSnapPadding || 0;
            },
            "getLayoutPadding": Layouts.paddingAt,
            "getZoneRef": function(layoutIndex, zoneIndex) {
                const zone = Layouts.zonesAt(layoutIndex)[zoneIndex];
                if (!zone)
                    return null;

                return {
                    "x": +zone.x,
                    "y": +zone.y,
                    "w": +zone.width,
                    "h": +zone.height,
                    "sourceLayoutIndex": layoutIndex,
                    "sourceZoneIndex": zoneIndex,
                    "padding": Layouts.paddingAt(layoutIndex)
                };
            },
            "setMaximize": function(c, h, v) {
                c.setMaximize(h, v);
            },
            "setFrameGeometry": function(c, r) {
                c.frameGeometry = Qt.rect(r.x, r.y, r.width, r.height);
            },
            "saveClientProperties": function(c, layoutIndex, zoneIndex) {
                // -1 means "this geometry belongs to no layout" (restore /
                // fullscreen). Preserving the previous value instead left
                // windows tagged with the layout of the monitor they came
                // FROM after a cross-screen restore, so a later fullscreen
                // resolved against that other screen's zones.
                c.zone = zoneIndex;
                c.layout = layoutIndex;
                c.desktop = Workspace.currentDesktop;
                c.activity = Workspace.currentActivity;
            },
            "log": Utils.log
        };
    }

    function smartSnapMetaArrow(client, direction) {
        if (!isManaged(client))
            return ;

        const screens = screenList();
        const screen = Screens.screenForRect(screens, client.frameGeometry, direction) || Workspace.activeScreen;
        const sourceArea = areaOfScreenNamed(Screens.screenName(screen));
        if (!sourceArea) {
            Utils.log("smartSnapMetaArrow: no client area for " + Screens.screenName(screen));
            return ;
        }
        const action = SnapPlanner.planSnap({
            "client": client,
            "source": MetaGeom.clientToSourcePct(client, sourceArea),
            "clientArea": sourceArea,
            "dir": direction,
            "screens": screens,
            "currentScreen": screen,
            "layouts": config.layouts
        });
        Utils.log("smartSnapMetaArrow: dir=" + direction + " action=" + JSON.stringify(action));
        // Silently sync the active layout to whichever layout the snapped
        // zone came from. Keeps the layout pool + overlay consistent with
        // the geometry the user just locked into, without showing an OSD.
        applyActiveLayoutForAction(action, screens, screen);
        SnapExecutor.executeSnap(action, client, snapExecutorDeps(), direction);
    }

    function applyActiveLayoutForAction(action, screens, sourceScreen) {
        if (!action)
            return ;

        const zoneAction = (action.type === "zone") ? action : (action.type === "jump" && action.nextAction && action.nextAction.type === "zone") ? action.nextAction : null;
        if (!zoneAction || zoneAction.layoutIndex == null || zoneAction.layoutIndex < 0)
            return ;

        refreshClientArea(Screens.findByName(screens, zoneAction.screenName) || sourceScreen);
        setCurrentLayout(zoneAction.layoutIndex);
    }

    function clearMetaArrowMemory(client) {
        MoveMemory.clearMemory(client);
    }

    function moveActiveWindow(direction) {
        if (config.smartHotkeys)
            smartSnapMetaArrow(Workspace.activeWindow, direction);
        else
            moveClientToNeighbour(Workspace.activeWindow, direction);
    }

    // ── OSD ───────────────────────────────────────────────────────────────

    function osdLayoutName() {
        const layout = Layouts.layoutAt(currentLayout);
        const name = layout ? layout.name : "";
        const scope = [];
        if (config.trackLayoutPerScreen) {
            const screenName = Screens.screenName(activeScreen) || Screens.screenName(Workspace.activeScreen);
            if (screenName)
                scope.push(screenName);

        }
        if (config.trackLayoutPerDesktop)
            scope.push(Workspace.currentDesktop.name);

        return scope.length > 0 ? `${name} (${scope.join(' / ')})` : name;
    }

    function showLayoutOsd() {
        if (!config.showOsdMessages)
            return ;

        const layout = Layouts.layoutAt(currentLayout);
        if (!layout)
            return ;

        layoutOsd.show(layout.zones, osdLayoutName(), activeScreen);
    }

    // ── signal wiring ─────────────────────────────────────────────────────

    function connectSignals(client) {
        // Handlers outlive their script instance.
        //
        // KWin reloads a script by destroying the old QML root and building a
        // new one, but the handlers below were connected imperatively to KWin
        // Window objects, which KWin keeps alive — so every reload leaves
        // another generation of closures attached to every window. Left
        // unchecked they run against a destroyed root and race the live
        // instance into moving windows onto the wrong screen.
        //
        // Disconnecting them is not possible: Component.onDestruction is NOT
        // invoked when KWin unloads a script (verified — a probe there never
        // fires), and KWin exposes no unload signal. What does hold is that a
        // destroyed root reads back as `null` through its own closures, so
        // each handler checks that and bails.
        function instanceAlive() {
            return root !== null;
        }

        function onInteractiveMoveResizeStarted() {
            if (!instanceAlive())
                return ;

            Utils.log("Interactive move/resize started for client " + client.resourceClass.toString());
            if (!client.resizeable || !isManaged(client))
                return ;

            if (client.move) {
                if (config.fadeWindowsWhileMoving)
                    setFadeWhileMoving(true);

                moving = true;
                moved = false;
                resizing = false;
                mainDialog.show();
            }
            if (client.resize) {
                moving = false;
                moved = false;
                resizing = true;
            }
        }

        function onInteractiveMoveResizeStepped() {
            if (!instanceAlive())
                return ;

            if (client.resizeable && moving && isManaged(client))
                moved = true;

        }

        function onInteractiveMoveResizeFinished() {
            if (!instanceAlive())
                return ;

            Utils.log("Interactive move/resize finished for client " + client.resourceClass.toString());
            if (config.fadeWindowsWhileMoving)
                setFadeWhileMoving(false);

            if (moving) {
                if (moved) {
                    if (!mainDialog.visible)
                        saveClientProperties(client, -1);
                    else if (fullscreenPendingSnap)
                        snapClientToFullscreen(client);
                    else
                        moveClientToZone(client, highlightedZone);
                }
                mainDialog.hide();
            } else if (resizing) {
                matchZone(client);
                Utils.log("Resizing end: Matched client " + client.resourceClass.toString() + " to layout.zone " + client.layout + " " + client.zone);
                saveClientProperties(client, client.zone);
            }
            moving = false;
            moved = false;
            resizing = false;
        }

        // fix from https://github.com/gerritdevriese/kzones/pull/25
        function onFullScreenChanged() {
            if (!instanceAlive())
                return ;

            Utils.log("Client fullscreen: " + client.resourceClass.toString() + " (fullscreen " + client.fullScreen + ")");
            if (client.fullScreen == true) {
                // zone -2 marks a fullscreen-snapped window and layout -1 an
                // unassigned one; neither indexes into a layout's zones.
                const layout = Layouts.layoutAt(client.layout);
                const zone = (layout && client.zone >= 0) ? Layouts.zonesAt(client.layout)[client.zone] : null;
                if (layout && zone && (layout.fullscreen == true || zone.fullscreen == true)) {
                    const rect = ZoneMath.zoneRect(zone, Layouts.paddingAt(client.layout), areaOfClient(client));
                    Utils.log("Fullscreen client " + client.resourceClass.toString() + " to zone " + client.zone + " with geometry " + JSON.stringify(rect));
                    client.setMaximize(false, false);
                    client.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
                }
            }
            mainDialog.hide();
        }

        function onInteractiveMoveResizeStartedClearMemory() {
            // User started dragging / resizing — the undo memory becomes
            // stale the moment they move off our snapped rect. Clear up front.
            clearMetaArrowMemory(client);
        }

        function onMinimizedChanged() {
            clearMetaArrowMemory(client);
            // Pristine is intentionally preserved across minimize: geometry
            // doesn't change, and the user should still be able to un-minimize
            // and drag-away to the original size.
        }

        // ── pristine-geometry wiring ──────────────────────────────────────
        const pristineDeps = {
            "computeState": function(c) {
                return computeWindowState(c);
            },
            "applyFrame": function(c, rect) {
                const clipped = clipRectToArea(rect, areaForRect(rect, c));
                c.setMaximize(false, false);
                c.frameGeometry = Qt.rect(clipped.x, clipped.y, clipped.width, clipped.height);
            },
            "unmaximize": function(c) {
                c.setMaximize(false, false);
            },
            "log": Utils.log
        };

        function onFrameGeometryChangedForPristine(oldGeom) {
            if (!instanceAlive())
                return ;

            // Gate: skip while a user-initiated interactive drag/resize is in
            // flight. Those phases are handled explicitly by onInteractiveStart
            // / onInteractiveEnd to avoid the mid-drag applyFrame we issue from
            // here cascading back into another state-transition.
            if (moving || resizing)
                return ;

            Pristine.onStateMaybeChanged(client, oldGeom, pristineDeps);
        }

        function onInteractiveStartedForPristine() {
            if (!instanceAlive())
                return ;

            Pristine.onInteractiveStart(client, client.frameGeometry, pristineDeps);
        }

        function onInteractiveFinishedForPristine() {
            if (!instanceAlive())
                return ;

            Pristine.onInteractiveEnd(client, resizing, pristineDeps);
        }

        function onClosedForPristine() {
            Pristine.clear(client);
        }
        // ──────────────────────────────────────────────────────────────────

        if (!isManaged(client))
            return ;

        Utils.log("Connecting signals for client " + client.resourceClass.toString());
        client.onInteractiveMoveResizeStarted.connect(onInteractiveMoveResizeStarted);
        client.onInteractiveMoveResizeStarted.connect(onInteractiveMoveResizeStartedClearMemory);
        client.onInteractiveMoveResizeStepped.connect(onInteractiveMoveResizeStepped);
        client.onInteractiveMoveResizeFinished.connect(onInteractiveMoveResizeFinished);
        client.onFullScreenChanged.connect(onFullScreenChanged);
        if (client.minimizedChanged)
            client.minimizedChanged.connect(onMinimizedChanged);

        if (config.rememberWindowGeometries) {
            if (client.frameGeometryChanged)
                client.frameGeometryChanged.connect(onFrameGeometryChangedForPristine);

            client.onInteractiveMoveResizeStarted.connect(onInteractiveStartedForPristine);
            client.onInteractiveMoveResizeFinished.connect(onInteractiveFinishedForPristine);
            if (client.closed)
                client.closed.connect(onClosedForPristine);

        }
    }

    // ── pristine restore helpers ──────────────────────────────────────────

    // Client area of the screen a rect belongs to, for restore clipping.
    //
    // Must NOT use the root `clientArea`: that tracks Workspace.activeScreen
    // and is only refreshed on screen-change signals or while the drag overlay
    // is visible, so during an app-initiated fullscreen cycle it is routinely
    // stale or pointing at another monitor. Clamping a restore against the
    // wrong monitor's rect slides the window onto that monitor instead of
    // putting it back where it came from.
    function areaForRect(rect, client) {
        return areaOfScreen(Screens.screenContainingRect(screenList(), rect)) || areaOfClient(client);
    }

    // Clip a pristine rect to its own screen's client area so a restore onto a
    // different (or smaller) monitor doesn't put the window off-screen.
    function clipRectToArea(rect, area) {
        if (!rect || !area || !area.width || !area.height)
            return rect;

        const width = Math.min(rect.width, area.width);
        const height = Math.min(rect.height, area.height);
        return {
            "x": Math.min(Math.max(rect.x, area.x), area.x + area.width - width),
            "y": Math.min(Math.max(rect.y, area.y), area.y + area.height - height),
            "width": width,
            "height": height
        };
    }

    // ── drag helpers ──────────────────────────────────────────────────────

    function setFadeWhileMoving(fade) {
        for (let i = 0; i < Workspace.stackingOrder.length; i++) {
            const client = Workspace.stackingOrder[i];
            if (!fade) {
                client.opacity = client.previousOpacity || 1;
                continue;
            }
            client.previousOpacity = client.opacity;
            if (client.move || !client.normalWindow)
                continue;

            client.opacity = 0.5;
        }
    }

    function snapClientToFullscreen(client) {
        const padding = config.fullscreenSnapPadding || 0;
        if (padding === 0) {
            client.setMaximize(true, true);
        } else {
            const rect = ZoneMath.zoneRect({
                "x": 0,
                "y": 0,
                "w": 100,
                "h": 100
            }, padding, clientArea);
            client.setMaximize(false, false);
            client.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
        }
        // zone -2 marks "snapped to the whole monitor" rather than to a tile.
        saveClientProperties(client, -2);
    }

    Component.onCompleted: {
        Utils.log("Loading script (" + Qt.resolvedUrl("./main.qml") + ")");
        Core.init(KWin, Workspace);
        Core.registerQMLComponent("root", root);
        Core.loadConfig();
        if (config.layoutsError)
            Utils.osd("KZones: invalid layout JSON, using defaults");

        Pristine.setConfigGate(function() {
            return config.rememberWindowGeometries;
        });
        refreshClientArea();
        // match all clients to zones and connect signals
        for (let i = 0; i < Workspace.stackingOrder.length; i++) {
            matchZone(Workspace.stackingOrder[i]);
            connectSignals(Workspace.stackingOrder[i]);
        }
        Utils.log("Everything loaded successfully");
    }

    PlasmaCore.Dialog {
        id: mainDialog

        function show() {
            mainDialog.visible = true;
            mainDialog.setWidth(Workspace.virtualScreenSize.width);
            mainDialog.setHeight(Workspace.virtualScreenSize.height);
            refreshClientArea();
        }

        function hide() {
            mainDialog.visible = false;
            zoneSelector.expanded = false;
            zoneSelector.near = false;
            highlightedZone = -1;
            fullscreenPendingSnap = false;
            showZoneOverlay = config.zoneOverlayShowWhen == 0;
        }

        title: "KZones Overlay"
        location: PlasmaCore.Types.Desktop
        type: PlasmaCore.Dialog.OnScreenDisplay
        backgroundHints: PlasmaCore.Types.NoBackground
        flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
        hideOnWindowDeactivate: true
        visible: false
        outputOnly: true
        opacity: 1
        width: displaySize.width
        height: displaySize.height

        Item {
            id: mainItem

            property alias repeaterLayout: repeaterLayout

            // Zone under the cursor according to the overlay tiles, or -1.
            function hoveredOverlayZone() {
                const currentZones = repeaterLayout.itemAt(currentLayout);
                if (!currentZones || !config.enableZoneOverlay || !showZoneOverlay || zoneSelector.expanded)
                    return -1;

                let hovering = -1;
                currentZones.repeater.model.forEach((zone, zoneIndex) => {
                    const item = currentZones.repeater.itemAt(zoneIndex);
                    if (item && Utils.isHovering(item.children[config.zoneOverlayHighlightTarget]))
                        hovering = zoneIndex;

                });
                return hovering;
            }

            // Zone under the cursor in the expanded layout selector, or -1.
            // Hovering a tile there also activates that layout.
            function hoveredSelectorZone() {
                if (!zoneSelector.expanded || zoneSelector.animating)
                    return -1;

                let hovering = -1;
                zoneSelector.repeater.model.forEach((entry, repeaterIndex) => {
                    const layoutItem = zoneSelector.repeater.itemAt(repeaterIndex);
                    if (!layoutItem)
                        return ;

                    entry.layout.zones.forEach((zone, zoneIndex) => {
                        if (Utils.isHovering(layoutItem.children[zoneIndex])) {
                            hovering = zoneIndex;
                            setCurrentLayout(entry.index);
                        }
                    });
                });
                return hovering;
            }

            function updateSelectorProximity() {
                zoneSelector.expanded = Utils.isHovering(zoneSelector) && (Workspace.cursorPos.y - clientArea.y) >= 0;
                const triggerDistance = config.zoneSelectorTriggerDistance * 50 + 25;
                zoneSelector.near = (Workspace.cursorPos.y - clientArea.y) < zoneSelector.y + zoneSelector.height + triggerDistance;
            }

            function cursorNearScreenEdge() {
                const triggerDistance = (config.edgeSnappingTriggerDistance + 1) * 10;
                const cursor = Workspace.cursorPos;
                return cursor.x <= clientArea.x + triggerDistance || cursor.x >= clientArea.x + clientArea.width - triggerDistance || cursor.y <= clientArea.y + triggerDistance || cursor.y >= clientArea.y + clientArea.height - triggerDistance;
            }

            // Zone whose padding-expanded bounds contain the cursor, or -1.
            // Tiles on a screen edge stretch outward so the cursor can reach
            // them past the layout's padding.
            function edgeSnapZone() {
                const currentZones = repeaterLayout.itemAt(currentLayout);
                if (!currentZones || !config.enableEdgeSnapping || !cursorNearScreenEdge())
                    return -1;

                const padding = Layouts.paddingAt(currentLayout);
                const halfPadding = padding / 2;
                let hovering = -1;
                currentZones.repeater.model.forEach((zone, zoneIndex) => {
                    const zoneItem = currentZones.repeater.itemAt(zoneIndex);
                    if (!zoneItem)
                        return ;

                    const itemGlobal = zoneItem.mapToGlobal(Qt.point(0, 0));
                    let bounds = {
                        "x": itemGlobal.x - halfPadding,
                        "y": itemGlobal.y - halfPadding,
                        "width": zoneItem.width + padding,
                        "height": zoneItem.height + padding
                    };
                    if (bounds.x <= halfPadding) {
                        bounds.x = 0;
                        bounds.width += padding;
                    }
                    if (bounds.y <= halfPadding) {
                        bounds.y = 0;
                        bounds.height += padding;
                    }
                    if (bounds.x + bounds.width >= clientArea.width - halfPadding)
                        bounds.width += halfPadding;

                    if (bounds.y + bounds.height >= clientArea.height - halfPadding)
                        bounds.height += halfPadding;

                    if (Utils.isPointInside(Workspace.cursorPos.x, Workspace.cursorPos.y, bounds))
                        hovering = zoneIndex;

                });
                return hovering;
            }

            // Cursor flicked beyond the top of the workspace (into the panel
            // area) means the user wants a full-monitor toss snap, not a
            // top-edge tile. Detected purely by position — no velocity
            // tracking.
            function fullscreenTossPending() {
                return config.enableEdgeSnapping && config.enableFullscreenSnap && Workspace.cursorPos.y < clientArea.y;
            }

            width: mainDialog.width
            height: mainDialog.height

            // main polling timer
            Timer {
                id: timer

                triggeredOnStart: true
                interval: config.pollingRate
                running: mainDialog.visible
                repeat: true
                onTriggered: {
                    refreshClientArea();
                    let hovering = mainItem.hoveredOverlayZone();

                    if (config.enableZoneSelector) {
                        const selectorZone = mainItem.hoveredSelectorZone();
                        if (selectorZone !== -1)
                            hovering = selectorZone;

                        mainItem.updateSelectorProximity();
                    }

                    const edgeZone = mainItem.edgeSnapZone();
                    if (edgeZone !== -1)
                        hovering = edgeZone;

                    // Fullscreen toss takes priority over any in-layout zone
                    // we may have just highlighted.
                    const tossPending = mainItem.fullscreenTossPending();
                    if (tossPending)
                        hovering = -1;

                    if (root.fullscreenPendingSnap !== tossPending)
                        root.fullscreenPendingSnap = tossPending;

                    if (hovering != highlightedZone) {
                        Utils.log("Highlighting zone " + hovering + " in layout " + currentLayout);
                        highlightedZone = hovering;
                    }
                }
            }

            Item {
                x: clientArea.x || 0
                y: clientArea.y || 0
                width: clientArea.width || 0
                height: clientArea.height || 0
                clip: true

                Components.Debug {
                    info: ({
                        "activeWindow": {
                            "caption": Workspace.activeWindow && Workspace.activeWindow.caption,
                            "resourceClass": Workspace.activeWindow && Workspace.activeWindow.resourceClass && Workspace.activeWindow.resourceClass.toString(),
                            "frameGeometry": {
                                "x": Workspace.activeWindow && Workspace.activeWindow.frameGeometry && Workspace.activeWindow.frameGeometry.x,
                                "y": Workspace.activeWindow && Workspace.activeWindow.frameGeometry && Workspace.activeWindow.frameGeometry.y,
                                "width": Workspace.activeWindow && Workspace.activeWindow.frameGeometry && Workspace.activeWindow.frameGeometry.width,
                                "height": Workspace.activeWindow && Workspace.activeWindow.frameGeometry && Workspace.activeWindow.frameGeometry.height
                            },
                            "zone": Workspace.activeWindow && Workspace.activeWindow.zone
                        },
                        "highlightedZone": highlightedZone,
                        "moving": moving,
                        "resizing": resizing,
                        "oldGeometry": Workspace.activeWindow && Workspace.activeWindow.oldGeometry,
                        "activeScreen": activeScreen && activeScreen.name,
                        "currentLayout": currentLayout,
                        "screenLayouts": screenLayouts,
                        "availableLayouts": availableLayouts.map((e) => {
                            return e.index + ":" + e.layout.name;
                        })
                    })
                    config: root.config
                }

                Repeater {
                    id: repeaterLayout

                    model: config.layouts

                    Components.Zones {
                        id: zones

                        config: root.config
                        clientArea: root.clientArea
                        overlayVisible: root.showZoneOverlay
                        selectorExpanded: zoneSelector.expanded
                        currentLayout: root.currentLayout
                        highlightedZone: root.highlightedZone
                        layoutIndex: index
                        visible: index === root.currentLayout && root.isLayoutAvailable(index) && !root.fullscreenPendingSnap
                    }

                }

                // Fullscreen-drag preview: reuses the standard Zones renderer
                // with a synthetic single-zone layout covering the entire
                // client area, so the user sees the same indicator card +
                // highlight they get for a normal drag-snap.
                Components.Zones {
                    id: fullscreenSnapPreview

                    visible: root.fullscreenPendingSnap
                    config: root.config
                    clientArea: root.clientArea
                    overlayVisible: root.showZoneOverlay
                    selectorExpanded: zoneSelector.expanded
                    currentLayout: -1
                    highlightedZone: -1
                    layoutIndex: -1
                    overrideZones: [{
                        "x": 0,
                        "y": 0,
                        "width": 100,
                        "height": 100
                    }]
                    overridePadding: config.fullscreenSnapPadding || 0
                    overrideAlwaysActive: root.fullscreenPendingSnap
                    z: 50
                }

                Components.Selector {
                    id: zoneSelector

                    config: root.config
                    currentLayout: root.currentLayout
                    highlightedZone: root.highlightedZone
                    availableLayouts: root.availableLayouts
                }

            }

        }

    }

    Components.LayoutOsd {
        id: layoutOsd
    }

    Components.Shortcuts {
        onCycleLayouts: cycleLayout(1)
        onCycleLayoutsReversed: cycleLayout(-1)
        onMoveActiveWindowToNextZone: shiftActiveWindowZone(1)
        onMoveActiveWindowToPreviousZone: shiftActiveWindowZone(-1)
        onToggleZoneOverlay: {
            if (!config.enableZoneOverlay)
                Utils.osd("Zone overlay is disabled");
            else if (moving)
                showZoneOverlay = !showZoneOverlay;
            else
                Utils.osd("The overlay can only be shown while moving a window");
        }
        onSwitchToNextWindowInCurrentZone: switchActiveWindowInZone(false)
        onSwitchToPreviousWindowInCurrentZone: switchActiveWindowInZone(true)
        onMoveActiveWindowToZone: {
            clearMetaArrowMemory(Workspace.activeWindow);
            moveClientToZone(Workspace.activeWindow, zone);
        }
        onActivateLayout: {
            clearMetaArrowMemory(Workspace.activeWindow);
            refreshClientArea(Screens.screenAtPoint(screenList(), Workspace.cursorPos));
            if (layout >= 0 && layout < availableLayouts.length) {
                setCurrentLayout(availableLayouts[layout].index);
                highlightedZone = -1;
                showLayoutOsd();
            } else {
                Utils.osd(`Layout ${layout + 1} does not exist on ${Screens.screenName(activeScreen) || "this screen"}`);
            }
        }
        onMoveActiveWindowUp: moveActiveWindow("up")
        onMoveActiveWindowDown: moveActiveWindow("down")
        onMoveActiveWindowLeft: moveActiveWindow("left")
        onMoveActiveWindowRight: moveActiveWindow("right")
        onSnapActiveWindow: {
            clearMetaArrowMemory(Workspace.activeWindow);
            moveClientToClosestZone(Workspace.activeWindow);
        }
        onSnapAllWindows: {
            for (let i = 0; i < Workspace.stackingOrder.length; i++) clearMetaArrowMemory(Workspace.stackingOrder[i])
            moveAllClientsToClosestZone();
        }
        onShowDetectedMonitors: {
            const screens = Core.getDetectedScreens();
            if (screens.length === 0) {
                Utils.osd("KZones: no monitors detected");
                return ;
            }
            Utils.osd("Monitors: " + screens.map((s) => {
                return `${s.name} (${s.width}x${s.height})`;
            }).join("   "));
        }
    }

    DBusCall {
        id: dbusCall

        function exec(service, path, method, args = []) {
            this.service = service;
            this.path = path;
            this.method = method;
            this.arguments = args;
            this.call();
        }

        Component.onCompleted: {
            Core.registerQMLComponent("dbusCall", dbusCall);
        }
    }

    // workspace connection
    Connections {
        function onCurrentDesktopChanged() {
            if (config.trackLayoutPerDesktop)
                currentLayout = getCurrentLayout();

        }

        function onActiveScreenChanged() {
            refreshClientArea();
        }

        function onScreensChanged() {
            refreshClientArea();
        }

        function onWindowActivated(client) {
            if (lastActiveWindow && lastActiveWindow !== client)
                clearMetaArrowMemory(lastActiveWindow);

            lastActiveWindow = client;
        }

        function onWindowAdded(client) {
            connectSignals(client);
            // check if client is in a zone application list
            const zones = Layouts.zonesAt(currentLayout);
            for (let i = 0; i < zones.length; i++) {
                const zone = zones[i];
                if (zone.applications && zone.applications.includes(client.resourceClass.toString())) {
                    moveClientToZone(client, i);
                    return ;
                }
            }
            // auto snap to closest zone
            if (config.autoSnapAllNew && isManaged(client))
                moveClientToClosestZone(client);

            // check if new window spawns in a zone
            if (client.zone == undefined || client.zone == -1)
                matchZone(client);

        }

        target: Workspace
    }

    Connections {
        //! still not working, hopefully it will at some point 😐
        function onConfigChanged() {
            Core.loadConfig();
        }

        target: Options
    }


}
