# Overlay disturbs AeroSpace tiling window manager — RESOLVED

Originally a handoff document after an unsuccessful debugging session. The
investigation described at the bottom found the root cause; this file now
records the mechanism and the fix so it does not regress.

## Symptom (historical)

With AeroSpace running (accordion layout):

1. Summoning the overlay made background windows **rearrange**.
2. Dismissing it moved focus to the **furthest-right window** in the
   accordion, not the window the user came from.
3. An `on-window-detected` float rule for `com.clod.app` in
   `~/.aerospace.toml` appeared to change nothing.

Raycast on the same machine caused no disturbance.

## Root cause

AeroSpace discovers windows via the Accessibility (AX) API and decides how to
treat each one with heuristics
(`Sources/AppBundle/util/AxUiElementMockEx.swift` at v0.19.2, now
`Sources/AppBundle/model/AxUiElementWindowType.swift`). Windows classify as
`window` (tiled), `dialog` (floating in the workspace), or `popup` (bound to
a separate `MacosPopupWindowsContainer`, invisible to layout and focus logic).

Electron windows — regardless of `type: 'panel'`, frameless, or style mask —
report `AXSubrole: "AXStandardWindow"`. Electron's "panel" is an `NSWindow`
subclass that fakes the non-activating style mask, not a real `NSPanel`, and
with the default `roundedCorners: true` a frameless window keeps a hidden
titled frame whose close/minimize/zoom buttons are still exposed through AX.
Measured with `aerospace debug-windows --window-id <id>`: the overlay was
classified **dialog** and bound into the workspace.

Any workspace-bound window (tiled *or* floating) triggers, in AeroSpace:

- **Hide** → the window looks destroyed → `MacWindow.garbageCollect()`
  caches the entire world into `closedWindowsCache` **and force-calls
  `nativeFocus()`** on the workspace's presumed live-focus window ("fix
  macOS annoyance with focused apps without windows", issue #65). That is
  symptom 2 — the focus jump happens for *any* dying workspace window, not
  just the focused one.
- **Show** → same CGWindowID re-detected → `restoreClosedWindowsCacheIfNeeded`
  finds it in the cache and **rebuilds every workspace's tiling tree from the
  frozen snapshot** (symptom 1), and — key detail — the cache-restore path
  **skips `on-window-detected` callbacks entirely**, which is why the float
  rule appeared to do nothing.

Raycast escapes all of this because its panel reports
`AXSubrole: "AXSystemDialog"`, empty title, and no buttons → classified
**popup** → never enters the workspace tree, the cache, or the focus-forcing
path. Confirmed by AeroSpace's own test fixture (`axDumps/raycast.json5`).

## The fix (three layers)

1. **`native/mac-ax` addon** (`clod_mac_ax.node`, pure Node-API, built by
   `scripts/build-native.sh` into `resources/native/`, asarUnpack'd):
   `createWindow()` calls `setWindowSubrole(handle, 'AXSystemDialog')` on the
   overlay NSWindow via `applyOverlayAxIdentity()`. AppKit projects the
   override to AX clients, so AeroSpace (all versions) classifies the overlay
   as **popup** — same as Raycast. This is the load-bearing fix: it holds even
   if the app gets registered by the window manager (e.g. after a native file
   dialog activates the app).
2. **Borderless style mask** (`roundedCorners: false` + `minimizable/
   maximizable/closable/fullscreenable: false` on darwin): removes the hidden
   traffic-light buttons from AX. Visually inert (the pill is CSS-drawn on a
   transparent window). On current AeroSpace main, "accessory-policy app with
   no close button" is popup by itself — a second independent layer.
3. **`LSUIElement: true`** (electron-builder `extendInfo`): the packaged app
   is an accessory app from process start, so AeroSpace's app-registration
   loop (which only actively registers `activationPolicy == .regular` apps)
   never picks it up — `app.dock.hide()` at runtime always lost that race.
   Also removes the dock-icon flash at launch.

Keyboard behavior is unaffected: `ElectronNSWindow.canBecomeKeyWindow` is
`focusable`-based and independent of style mask, so the panel still takes key
status when shown without activating the app.

## Verification

- PoC: a titled `NSWindow` (default `AXStandardWindow`, would be tiled) with
  `setAccessibilitySubrole(.systemDialog)` → AeroSpace dump shows
  `AXSubrole: "AXSystemDialog"`, type **popup**, `workspace: nil`.
- End-to-end: Electron + Clod's exact window flags + the built addon →
  window absent from `aerospace list-windows`, AeroSpace focus unchanged
  across hide/show cycles. Control run (old flags) → listed and classified
  dialog.

To re-verify after future Electron/AeroSpace upgrades:

```bash
# Summon the overlay, then:
aerospace list-windows --monitor all --app-bundle-id com.clod.app
# Expect: no output. If the window appears, classification has regressed —
# dump it:
aerospace debug-windows --window-id <id>   # expect AxUiElementWindowType popup
```

Note: `aerospace list-windows --all` silently conflicts with filtering flags
such as `--app-bundle-id`; `--monitor all` is the form that accepts them.

The float rule for `com.clod.app` in `~/.aerospace.toml` is now inert
(popups never reach `on-window-detected`) and can be removed.

## Do not regress

- Don't remove the `applyOverlayAxIdentity()` call or the `mac-ax` addon.
- Don't revert `roundedCorners: false` for cosmetic reasons — it is part of
  the WM-invisibility contract, and it is visually inert.
- Don't drop `LSUIElement` from `build.mac.extendInfo`.
- `showWindow()` must not call `webContents.focus()` — that activates the app
  (`applicationDidBecomeActive`) and deactivates the app the user was in
  (fixed separately in `ee46494`).

## Investigation notes (for posterity)

The original session made three confident but incomplete diagnoses before
measuring; the breakthrough came from reading AeroSpace's source at the
installed tag (v0.19.2-Beta) instead of guessing, and from
`aerospace debug-windows --window-id`, which dumps a window's AX attributes
and AeroSpace's classification using AeroSpace's own permissions. Dead ends
ruled out on the way: capturing/restoring focus around toggles (treats the
symptom; `aerospace focus` itself re-expands the accordion), float rules
(bypassed by the closed-windows cache), and borderless style mask alone
(buttons disappear but the subrole stays `AXStandardWindow`).
