# Preset System Prompts

**Date:** 2026-07-25
**Status:** Approved
**Scope:** Per-preset custom system prompts, so a "quick question" mode answers
general-knowledge questions instead of deflecting them as out of scope.

## Problem

Clod presets (modes) can already set project, model, permission mode, and start-expanded
state. What they cannot set is *what kind of assistant the mode is*.

A "quick question" preset therefore still inherits Claude Code's software-engineering
framing, and general-knowledge questions get deflected as outside its wheelhouse.

Two causes, both fixable here:

1. **Claude Code's own default system prompt** frames the assistant as a
   software-engineering CLI tool. Nothing in Clod currently overrides it.
2. **`CLOD_SYSTEM_HINT`** (`src/main/claude/run-manager.ts:35`) is appended to
   *every* run and ends with *"You are still a software engineering assistant."*
   Clod is actively reinforcing the behavior it wants to suppress.

The plumbing is half-built already: `RunOptions.systemPrompt` exists
(`src/shared/types.ts:238`) and maps to `--system-prompt` (`run-manager.ts:206`),
but nothing in the renderer ever sets it. Dead code.

## Decisions log

| Question | Decision |
|----------|----------|
| Where does the prompt live? | A field on each `Preset`, edited in the existing `PresetEditor`. Not a global setting, not a separate prompt library, not a per-tab override. |
| Append or replace the CLI default? | Per-preset toggle. Replace for quick-question (fully drops the engineering framing); append for layering rules onto a coding mode. |
| What happens to `CLOD_SYSTEM_HINT`? | Split it. The rich-UI/markdown half applies to every mode; the software-engineering half applies only when a preset has no custom prompt. |
| Global state or per-tab? | Global, exactly like `preferredModel` and `permissionMode`. Activating a preset changes subsequent runs in all tabs. |
| Ship a starter prompt? | Yes — a `GENERAL_ASSISTANT_PROMPT` constant, inserted into the textarea by a button and editable afterwards. Never applied silently. |
| Combine `--system-prompt` with `--append-system-prompt`? | No. Clod composes the full replacement string itself. |

## Design

### 1. Preset type

`src/shared/types.ts`, added to `Preset`:

```ts
/** undefined = leave current prompt as-is; null = reset to CLI default; string = custom */
systemPrompt?: string | null
/** How a custom prompt combines with the CLI default. Default 'append'. */
systemPromptMode?: 'append' | 'replace'
```

The tri-state `undefined | null | string` mirrors the existing `projectId` field on
the same type.

It exists to avoid a footgun. `applyPreset` only applies fields that are set —
`if (preset.model) ...` — so a plain optional string would mean: activate
quick-question, switch back to a coding preset, and the general-assistant prompt
silently stays in force, because "no prompt" is indistinguishable from "don't change
the prompt". `null` gives presets an explicit way to say *reset to the CLI default*.

`PresetInput` is `Omit<Preset, 'id'>`, so it picks both fields up automatically.

### 2. Prompt assembly — `src/main/claude/system-prompt.ts` (new)

`CLOD_SYSTEM_HINT` splits into two exported constants:

- **`CLOD_UI_HINT`** — everything about Clod being a GUI with rich markdown:
  clickable links, images, tables, code blocks, headers. Applied in every mode.
- **`CLOD_ENGINEER_HINT`** — the *"You are still a software engineering assistant…
  keep using your tools normally"* paragraph. Applied **only when the preset has no
  custom prompt**, preserving today's behavior for every existing preset.

The module exports one pure function:

```ts
buildSystemPromptArgs(opts: {
  systemPrompt?: string
  systemPromptMode?: 'append' | 'replace'
}): string[]
```

| Case | Args produced |
|------|---------------|
| No custom prompt | `['--append-system-prompt', UI_HINT + '\n\n' + ENGINEER_HINT]` |
| Custom, `append` (default) | `['--append-system-prompt', UI_HINT + '\n\n' + custom]` |
| Custom, `replace` | `['--system-prompt', custom + '\n\n' + UI_HINT]` |

Custom text goes **last** in append mode so it carries the most authority against
the base prompt. A blank or whitespace-only `systemPrompt` is treated as absent.

Replace mode composes the entire prompt in Clod and emits a single `--system-prompt`,
rather than pairing `--system-prompt` with `--append-system-prompt`. The CLI documents
`--append-system-prompt` as appending to *the default* prompt; its behavior when a
replacement prompt is also supplied is unspecified. Composing here is deterministic
and unit-testable, and costs nothing.

`run-manager.ts:206-210` collapses to:

```ts
args.push(...buildSystemPromptArgs(options))
```

The legacy `pty-run-manager.ts` and `process-manager.ts` paths are left untouched —
`RunManager` is the live path.

### 3. Shared constant — `src/shared/prompts.ts` (new)

`GENERAL_ASSISTANT_PROMPT` lives in `shared/` because main composes prompts and the
renderer offers the template button. Content: answer any question directly — general
knowledge, science, history, writing, advice, or code; there is no software-engineering
restriction in this mode; use `WebSearch`/`WebFetch` for current events or uncertain
facts rather than guessing; lead with the answer, then supporting detail.

### 4. Renderer plumbing

Mirrors `permissionMode` step for step:

- **State** (`sessionStore.ts`): `systemPrompt: string | null`,
  `systemPromptMode: 'append' | 'replace'`.
- **Persistence**: both added to `SessionPrefs`, `DEFAULT_PREFS`
  (`null` / `'append'`), the type-guarded `loadPrefs()` reader, and `prefsSnapshot()`.
- **Activation** (`applyPreset`, `sessionStore.ts:388`): `undefined` leaves state
  alone; `null` clears to `null`; a string sets prompt and mode together.
- **Send** (`submitPrompt`, `sessionStore.ts:943`): passes `systemPrompt ?? undefined`
  and `systemPromptMode` in `RunOptions`.

`RunOptions` gains `systemPromptMode?: 'append' | 'replace'` next to the existing
`systemPrompt`. No new IPC channels — presets CRUD and `PROMPT` already carry
everything. No `ControlPlane` or `TabState` changes.

### 5. PresetEditor UI

A **System prompt** section in the existing pill style, below Permissions:

- Row of three: `—` (leave unchanged) / `Default` (reset to CLI default) / `Custom`.
- When `Custom` is active: an `Append` / `Replace` pill pair, a textarea, and a
  **"Use general-assistant template"** button that fills the textarea with
  `GENERAL_ASSISTANT_PROMPT` for further editing.
- Colors come from `useColors()`; icons, if any, from Phosphor.

Saving with `Custom` selected and an empty textarea saves `undefined` (leave
unchanged), so an empty box can never be mistaken for a deliberate blank prompt.

### 6. Validation and errors

`isValidInput` in `src/main/presets/store.ts`:

- `systemPrompt`: `undefined`, `null`, or a string of at most **8000 characters**.
- `systemPromptMode`: `undefined`, `'append'`, or `'replace'`.

Invalid presets are rejected by `create`/`update` (returning `null`, as today) and
dropped on load by `JsonFileStore`'s guard, which already backs up corrupt files.
The 8000-character cap keeps `presets.json` and the spawned argv sane; macOS `ARG_MAX`
is far higher, so it is a sanity bound rather than a hard limit.

Prompt text reaches the CLI through `spawn()`'s argv array with no shell involved,
so there is no injection surface. The text is user-authored and never leaves the
machine except as an argument to the local `claude` process.

## Testing

- **`system-prompt.test.ts`** (new): all three branches of `buildSystemPromptArgs`;
  `CLOD_ENGINEER_HINT` present only in the no-custom-prompt case; `CLOD_UI_HINT`
  present in all three; custom text ordered last in append mode and first in replace
  mode; blank/whitespace prompt treated as absent; `systemPromptMode` defaulting to
  `append`.
- **`presets/store.test.ts`** (extend): accepts `undefined`/`null`/string prompts and
  both modes; rejects an over-length prompt, a non-string non-null prompt, and an
  invalid mode; round-trips both fields through `create` and `update`.
- **Manual**: create a quick-question preset with the template in replace mode, ask
  a general-knowledge question, confirm it answers and that markdown links still
  render. Switch to a preset with `Default` selected and confirm coding behavior is
  unchanged.

Existing preset files without the new fields load unchanged and behave exactly as
today — both fields are optional, and absent means "no custom prompt".

## Out of scope

- Per-tab prompt capture (a preset switch does affect in-flight tabs — consistent
  with how model and permission mode already behave).
- A reusable named prompt library shared across presets.
- `--exclude-dynamic-system-prompt-sections`.
- Restricting or expanding the tool set in quick-question mode.
- Updating the legacy `pty-run-manager.ts` / `process-manager.ts` spawn paths.
