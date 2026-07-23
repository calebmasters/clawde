# Clod Expansion: Projects, Presets, and Interaction Polish

**Date:** 2026-07-23
**Status:** Approved
**Scope:** Four phases — quick wins, projects (workspaces), presets (modes) with keybinds, inline selectable options.

## Overview

Clod today is a single-workspace overlay: one hotkey, one set of tabs, chat collapsed
by default, CLI handoff hardcoded to Terminal.app. This design adds:

1. **Phase 0 — Quick wins:** chat visible by default; "Open CLI" uses the user's
   actual terminal (Ghostty, iTerm2, etc.) instead of hardcoded Terminal.app.
2. **Phase 1 — Projects:** first-class named workspaces, each with its own
   directory, defaults, and tab set, plus a switcher UI.
3. **Phase 2 — Presets:** named launch modes (project + model + permission mode +
   UI state), each bindable to its own global keybind.
4. **Phase 3 — Inline options:** selectable option cards when Claude asks a
   question, and a real skills/commands picker in the `/` menu.

Build order is 0 → 1 → 2 → 3. Presets depend on projects. Inline options are
independent but carry CLI-protocol research risk, so they go last.

## Decisions log

| Question | Decision |
|----------|----------|
| What are "modes"? | Full presets/profiles: model + permission mode + project + UI state, each with a keybind. |
| What is a "project"? | Workspace per project: named directory + own tab set + session history + default settings. Switching swaps the tab strip. |
| Presets vs projects relationship | Two entities; presets *reference* projects. Allows "same repo, plan mode" and "same repo, auto-accept" on different keybinds. |
| Quick copy | Deprioritized — existing per-reply copy button suffices once chat is visible by default. Bump it from hover-only to always visible. |
| Default terminal | No macOS "default terminal" exists; detect (setting → running → installed priority) with a Settings override. User's terminal is Ghostty. |

## Phase 0 — Quick wins

### 0a. Chat visible by default

- `isExpanded` initial value changes `false → true` in `sessionStore`.
- Sending a prompt auto-expands the card (so streaming is visible without a click).
- New Settings toggle **"Start expanded"** (default on), persisted with the other
  theme-store settings.
- Copy button on replies (`ConversationView.tsx` `CopyButton`) becomes always
  visible instead of hover-only.

### 0b. Open CLI in the user's terminal

New module `src/main/terminal-launcher.ts` replacing the inline AppleScript in
`src/main/index.ts` (`IPC.OPEN_IN_TERMINAL` handler, ~line 1215).

**Resolution order:**
1. Explicit user setting (Settings dropdown).
2. A supported terminal currently running.
3. Installed-app priority list: Ghostty, iTerm2, WezTerm, Kitty, Alacritty, Warp.
4. Terminal.app fallback.

**Launch strategies** (per terminal, all receiving `cwd` + optional
`claude --resume <uuid>` command):
- Terminal.app / iTerm2: AppleScript (existing escaping rules retained —
  single-quote shell escaping, AppleScript string escaping, UUID validation,
  absolute-path check).
- Ghostty / Kitty / Alacritty / WezTerm: CLI args via `open -na <App> --args …`
  (e.g. kitty `--directory`, wezterm `start --cwd`). **Research task:** verify
  exact Ghostty macOS flags for working directory + command execution.
- Warp: URI scheme / launch configuration. **Research task:** verify; if
  unreliable, Warp falls back to opening at `cwd` only.

**Detection:** check `/Applications` + `~/Applications` for known bundles;
check running processes for a supported terminal.

**Settings UI:** dropdown listing detected terminals + "System default
(auto)". Stored in the main-process settings alongside hotkey config.

**Error handling:** launch failure logs and falls back to Terminal.app; if that
also fails, surface a toast in the renderer.

## Phase 1 — Projects (workspaces)

### Data model

```ts
interface Project {
  id: string            // uuid
  name: string
  path: string          // absolute directory
  defaults?: {
    model?: string
    permissionMode?: PermissionMode
  }
  createdAt: number
  lastUsedAt: number
}
```

- Persisted as JSON at `<userData>/projects.json`, owned by the main process:
  new `src/main/projects/store.ts` (load/validate/save, atomic write via
  temp-file rename).
- A built-in **Scratch** workspace (home directory, not persisted as a real
  project) preserves today's default behavior and hosts pre-existing tabs.

### Workspace semantics

- Every tab belongs to exactly one project (`projectId` on the renderer tab
  state; `Scratch` = `null`).
- TabStrip renders only the active project's tabs. Switching projects swaps the
  visible tab set. **Tabs in other projects keep running** — ControlPlane is
  tab-keyed and unaware of grouping; no process-layer changes.
- New tabs inherit the active project's `path` and `defaults`.
- HistoryPicker filters sessions to the active project's path by default, with
  an "All projects" toggle (sessions already carry `projectPath` — this is a
  filter, not a migration).

### IPC (all via `IPC.*` constants in `src/shared/types.ts`)

- `PROJECTS_LIST`, `PROJECTS_CREATE`, `PROJECTS_UPDATE`, `PROJECTS_DELETE`.
- Active project id lives in renderer state (persisted via the existing
  renderer persistence path); main process needs it only when presets activate
  (Phase 2).

### UI

- **Project switcher** at the left edge of the TabStrip: current project name,
  click → dropdown listing projects (name + dimmed path), "New project…"
  (name field + existing directory-picker dialog), and an edit/manage entry
  opening a Settings section.
- Deleting a project never deletes sessions or directories; its tabs move to
  Scratch.

### State changes (`sessionStore`)

- Add `projects: Project[]`, `activeProjectId: string | null`,
  `tab.projectId: string | null`.
- Tab visibility is a derived filter — no change to tab lifecycle events.

## Phase 2 — Presets (modes) with keybinds

### Data model

```ts
interface Preset {
  id: string
  name: string
  keybind: PresetKeybind      // see below
  projectId?: string          // optional project to activate
  model?: string
  permissionMode?: PermissionMode
  startExpanded?: boolean
}

type PresetKeybind =
  | { kind: 'double-tap'; modifier: 'option' | 'command' }
  | { kind: 'accelerator'; accelerator: string }  // Electron accelerator
  | { kind: 'none' }
```

Persisted at `<userData>/presets.json` (same store pattern as projects).
Example set: "Deep work" ⌥⌥ → clawde + opus + plan; "Quick fix" ⌘⌘ → clawde +
sonnet + acceptEdits; "Scratch" ⌃⌥Space → no project + haiku + default.

### Keybind engine

Generalizes the current single-binding hotkey system (`src/main/index.ts`
`applyHotkeyConfig` + `modifier-double-tap.ts`):

- The uiohook double-tap detector already distinguishes Option vs Command; it
  dispatches to whichever preset claims that modifier.
- Arbitrary accelerators register via `globalShortcut`, one per preset.
- The legacy single "toggle hotkey" setting becomes the keybind of a default
  preset (migration: existing hotkey config → "Default" preset). The
  `Cmd+Shift+K` fallback shortcut stays registered and maps to the Default
  preset.
- Flow: keybind fires in main → main shows/hides the window and broadcasts a
  `preset_activated` event → renderer applies project switch + defaults.
  (Project/preset switching is renderer state; main only owns window
  visibility and keybind dispatch.)
- Registration conflicts (accelerator taken by the OS or another preset) are
  reported to the renderer and shown as an error state in Settings — never
  silently dropped.

### Activation semantics

Pressing a preset's keybind:
- Overlay hidden → show it with the preset applied.
- Overlay visible, same preset → hide (toggle, preserving today's feel).
- Overlay visible, different preset → switch in place.

Applying a preset = switch to its project (if set), set model/permission
defaults for **new** prompts, apply `startExpanded`. Per-tab overrides the user
makes afterward always win. Presets are defaults-at-activation, not locks.

### UI

- Active preset badge in the StatusBar; click → quick-switch menu.
- Settings section to create/edit/delete presets, reusing the existing
  accelerator recorder for keybind capture and adding double-tap options.

## Phase 3 — Inline selectable options

### 3a. Claude asks a question (AskUserQuestion)

- Add `AskUserQuestion` to `PERMISSION_REQUIRED_TOOLS` handling in
  `src/main/hooks/permission-server.ts`, with a dedicated branch: instead of a
  permission decision, it produces a **question payload** (question text,
  options with labels/descriptions, multiSelect flag) from the tool input.
- New `NormalizedEvent` variant `question_request` (and `question_resolved`)
  in `src/shared/types.ts`, emitted through the existing ControlPlane broadcast
  path.
- New renderer component `QuestionCard` (sibling of `PermissionCard`):
  selectable option buttons inline in the conversation, keyboard navigable
  (arrows + enter), free-text "Other" input, multi-select support.
- Answer returns via the existing hook response channel. **Research task:**
  exact reply mechanism — PreToolUse deny-with-reason (answer embedded in the
  block reason, which Claude reads and continues) vs. the control-protocol
  answer path. Both are viable; pick whichever the pinned CLI version supports
  cleanly, verified with a spike before building the UI.
- Unanswered questions auto-resolve after the existing 5-minute permission
  timeout (treated as "user didn't answer" — deny path).

### 3b. Skills / commands picker

- New IPC `SKILLS_LIST`: main process scans `~/.claude/skills/` and installed
  plugin skill/command directories (reusing parsing in
  `src/main/skills/manifest.ts`) and returns
  `{ name, description, source }[]`. Cached with short TTL; refreshed when the
  marketplace installs/uninstalls.
- `SlashCommandMenu` gains a two-level flow: top-level `/` menu as today
  (real installed commands merged in); typing `/skills` (or selecting the
  Skills entry) opens a filterable submenu of actual skills; selection inserts
  the invocation (e.g. `/skill-name `) into the input for the user to finish
  and send.

## Error handling summary

| Failure | Behavior |
|---------|----------|
| Terminal launch fails | Fall back to Terminal.app; toast on double failure. |
| `projects.json` / `presets.json` corrupt | Back up the bad file (`.bak`), start with defaults, log. |
| Keybind registration conflict | Error state in Settings; preset stays, binding marked failed. |
| Question card timeout (5 min) | Auto-deny via existing permission timeout path. |
| Skills scan fails | `/` menu falls back to the static command list. |

## Testing

- **Unit (vitest, existing setup):** terminal detection ordering + per-terminal
  command construction (escaping preserved); projects/presets store
  load/save/corrupt-file recovery; keybind→preset mapping incl. migration from
  legacy hotkey config; event-normalizer handling of `question_request`;
  skills manifest scanning.
- **Manual per phase:** `npm run typecheck` + `npm test` green; overlay smoke
  test (summon via each bound keybind, switch projects with runs in flight,
  answer an inline question end-to-end, open CLI into Ghostty).

## Out of scope

- Quick-copy keybind / collapsed-pill copy affordance (dropped by decision).
- Parsing options out of Claude's *plain-text* questions (only structured
  AskUserQuestion tool calls get cards).
- Cross-machine sync of projects/presets.
- Any change to the permission server's security model (localhost bind,
  per-launch secret, per-run tokens, deny-by-default all retained).

## Research tasks (resolve during planning/spike)

1. Ghostty macOS CLI: working-directory + run-command flags via `open --args`.
2. Warp launch mechanism (URI scheme vs launch config), or degrade to cwd-only.
3. AskUserQuestion answer channel: PreToolUse block-with-reason vs control
   protocol on the CLI version Clod pins.
