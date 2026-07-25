# Preset System Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Clod preset (mode) carry a custom system prompt, so a "quick question" mode answers general-knowledge questions instead of deflecting them as outside software engineering.

**Architecture:** A preset gains a tri-state `systemPrompt` field (`undefined` = leave current, `null` = reset to CLI default, `string` = custom) plus an `append`/`replace` mode. A pure function in the main process composes the final `--system-prompt` / `--append-system-prompt` arguments, splitting Clod's existing always-appended hint into a rich-UI half (every mode) and a software-engineering half (only modes with no custom prompt). The renderer mirrors the existing `permissionMode` pattern exactly: global store state, persisted to localStorage, set on preset activation, read at prompt time.

**Tech Stack:** TypeScript (strict), Electron 33, React 19, Zustand 5, Tailwind 4, Phosphor icons, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-25-preset-system-prompts-design.md`

## Global Constraints

- TypeScript strict mode: `npm run typecheck` must report zero errors before any commit.
- `npm test` (vitest) must pass before any commit.
- Use `IPC.*` constants for IPC channel names — this plan adds **no** new IPC channels.
- Renderer colors come from the `useColors()` hook — never hardcode a color value.
- Renderer and main never import each other. `src/shared/` is importable by both.
- Immutable updates only — spread to new objects, never mutate in place.
- Main-process changes require a full `npm run dev` restart; the renderer hot-reloads.
- Commit messages are conventional-commit subject lines with no attribution trailer, matching repo history (`feat: …`, `test: …`).
- Max system prompt length: **8000** characters.
- No new network calls, no new dependencies.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | `Preset.systemPrompt`, `Preset.systemPromptMode`, `RunOptions.systemPromptMode` |
| `src/shared/prompts.ts` | Create | `GENERAL_ASSISTANT_PROMPT` template text, shared by main and renderer |
| `src/main/presets/store.ts` | Modify | Validate the two new preset fields |
| `src/main/presets/store.test.ts` | Modify | Cover the new validation cases |
| `src/main/claude/system-prompt.ts` | Create | `CLOD_UI_HINT`, `CLOD_ENGINEER_HINT`, `buildSystemPromptArgs()` |
| `src/main/claude/system-prompt.test.ts` | Create | Unit tests for all three branches |
| `src/main/claude/run-manager.ts` | Modify | Drop the inline hint constant, delegate to `buildSystemPromptArgs()` |
| `src/renderer/lib/preset-prompt.ts` | Create | `resolvePromptState()` — pure tri-state resolution |
| `src/renderer/lib/preset-prompt.test.ts` | Create | Unit tests for tri-state semantics |
| `src/renderer/stores/sessionStore.ts` | Modify | State, persistence, `applyPreset`, `submitPrompt` |
| `src/renderer/components/PresetEditor.tsx` | Modify | System prompt section in the editor panel |

Build order is 1 → 2 → 3 → 4. Task 2 depends on the types from Task 1; Tasks 3 and 4 depend on both.

---

### Task 1: Preset fields, shared template, and validation

**Files:**
- Modify: `src/shared/types.ts:238` (RunOptions), `src/shared/types.ts:328-338` (Preset)
- Create: `src/shared/prompts.ts`
- Modify: `src/main/presets/store.ts:10` (constants), `src/main/presets/store.ts:27-34` (`isValidInput`)
- Test: `src/main/presets/store.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `Preset.systemPrompt?: string | null` and `Preset.systemPromptMode?: 'append' | 'replace'` — `PresetInput` inherits both via `Omit<Preset, 'id'>`
  - `RunOptions.systemPromptMode?: 'append' | 'replace'` (alongside the existing `RunOptions.systemPrompt?: string`)
  - `GENERAL_ASSISTANT_PROMPT: string` exported from `src/shared/prompts.ts`

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe('PresetsStore', …)` block in `src/main/presets/store.test.ts`, after the `'rejects invalid input'` test:

```typescript
  it('accepts systemPrompt undefined (leave as-is), null (reset), and a custom string', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: 'A', keybind: { kind: 'none' } })).not.toBeNull()
    expect(store.create({ name: 'B', keybind: { kind: 'none' }, systemPrompt: null })).not.toBeNull()
    const custom = store.create({
      name: 'C',
      keybind: { kind: 'none' },
      systemPrompt: 'Answer anything.',
      systemPromptMode: 'replace',
    })
    expect(custom).not.toBeNull()
    const reloaded = new PresetsStore(file).list()
    expect(reloaded).toHaveLength(3)
    expect(reloaded[1].systemPrompt).toBeNull()
    expect(reloaded[2]).toMatchObject({ systemPrompt: 'Answer anything.', systemPromptMode: 'replace' })
  })

  it('rejects an over-length prompt, a non-string prompt, and an invalid prompt mode', () => {
    const store = new PresetsStore(file)
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'x'.repeat(8001) })).toBeNull()
    // @ts-expect-error runtime validation of a non-string prompt
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 42 })).toBeNull()
    // @ts-expect-error runtime validation of a bad prompt mode
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPromptMode: 'merge' })).toBeNull()
    expect(store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'x'.repeat(8000) })).not.toBeNull()
    expect(store.list()).toHaveLength(1)
  })

  it('round-trips prompt fields through update', () => {
    const store = new PresetsStore(file)
    const p = store.create({ name: 'A', keybind: { kind: 'none' }, systemPrompt: 'first' })!
    const updated = store.update(p.id, { systemPrompt: 'second', systemPromptMode: 'append' })
    expect(updated).toMatchObject({ systemPrompt: 'second', systemPromptMode: 'append' })
    expect(store.update(p.id, { systemPrompt: 'x'.repeat(8001) })).toBeNull()
    expect(store.list()[0].systemPrompt).toBe('second')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/main/presets/store.test.ts`
Expected: FAIL. The two `@ts-expect-error` lines will also report as *unused* directives until validation exists, and the over-length prompt is accepted because nothing checks it yet.

- [ ] **Step 3: Add the two fields to `Preset` in `src/shared/types.ts`**

Inside the `Preset` interface (currently ending with `startExpanded?: boolean` at line 337), add:

```typescript
  /**
   * Custom system prompt for this mode.
   * undefined = leave the current prompt as-is; null = reset to the CLI default;
   * string = use this prompt. The tri-state mirrors `projectId` above.
   */
  systemPrompt?: string | null
  /** How a custom prompt combines with the CLI default. Defaults to 'append'. */
  systemPromptMode?: 'append' | 'replace'
```

- [ ] **Step 4: Add `systemPromptMode` to `RunOptions` in `src/shared/types.ts`**

Directly below the existing `systemPrompt?: string` line (line 238):

```typescript
  /** 'replace' passes --system-prompt; 'append' (default) passes --append-system-prompt. */
  systemPromptMode?: 'append' | 'replace'
```

- [ ] **Step 5: Create `src/shared/prompts.ts`**

```typescript
/**
 * Prompt text shared by the main process (which composes CLI system-prompt
 * arguments) and the renderer (which offers this as a starting template in the
 * preset editor). Lives in shared/ because both layers need the exact same text.
 */

/**
 * Starting template for a general-purpose "quick question" mode.
 * Inserted into the preset editor by an explicit button — never applied silently.
 */
export const GENERAL_ASSISTANT_PROMPT = [
  'You are a knowledgeable, helpful assistant. Answer whatever the user asks —',
  'general knowledge, science, history, culture, writing, advice, planning, or code.',
  '',
  'There is no software-engineering restriction in this mode. Never deflect a question',
  'because it is not a coding or engineering task, and never suggest the user ask',
  'somewhere else. If you can answer it, answer it.',
  '',
  'Use your tools when they make the answer better: WebSearch and WebFetch for current',
  'events, recent releases, prices, or any fact you are not confident about. Prefer',
  'looking something up over guessing, and say so plainly when you are unsure.',
  '',
  'Lead with the direct answer, then supporting detail. Keep it brief unless the user',
  'asks for depth.',
].join('\n')
```

- [ ] **Step 6: Add validation to `src/main/presets/store.ts`**

Below the existing `const MAX_NAME_LENGTH = 64` (line 10):

```typescript
const MAX_SYSTEM_PROMPT_LENGTH = 8000
```

Below `isValidKeybind` (after line 25):

```typescript
/** undefined = leave as-is, null = reset to CLI default, string = custom (length-bounded). */
function isValidSystemPrompt(v: unknown): boolean {
  if (v === undefined || v === null) return true
  return typeof v === 'string' && v.length <= MAX_SYSTEM_PROMPT_LENGTH
}
```

Inside `isValidInput`, before the final `return true`:

```typescript
  if (!isValidSystemPrompt(v.systemPrompt)) return false
  if (v.systemPromptMode !== undefined && v.systemPromptMode !== 'append' && v.systemPromptMode !== 'replace') return false
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/main/presets/store.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 8: Type-check**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/prompts.ts src/main/presets/store.ts src/main/presets/store.test.ts
git commit -m "feat: preset system prompt fields with validation"
```

---

### Task 2: System prompt composition and run-manager wiring

**Files:**
- Create: `src/main/claude/system-prompt.ts`
- Create: `src/main/claude/system-prompt.test.ts`
- Modify: `src/main/claude/run-manager.ts:16-39` (delete `CLOD_SYSTEM_HINT`), `src/main/claude/run-manager.ts:206-210` (arg building), import block at the top

**Interfaces:**
- Consumes: `RunOptions.systemPrompt`, `RunOptions.systemPromptMode` from Task 1
- Produces:
  - `buildSystemPromptArgs(options: Pick<RunOptions, 'systemPrompt' | 'systemPromptMode'>): string[]`
  - `CLOD_UI_HINT: string`, `CLOD_ENGINEER_HINT: string`

- [ ] **Step 1: Write the failing test**

Create `src/main/claude/system-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPromptArgs, CLOD_UI_HINT, CLOD_ENGINEER_HINT } from './system-prompt'

describe('buildSystemPromptArgs', () => {
  it('appends the UI hint and the engineer hint when there is no custom prompt', () => {
    const [flag, value] = buildSystemPromptArgs({})
    expect(flag).toBe('--append-system-prompt')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).toContain(CLOD_ENGINEER_HINT)
  })

  it('drops the engineer hint in append mode so a custom prompt is not contradicted', () => {
    const [flag, value] = buildSystemPromptArgs({ systemPrompt: 'Answer anything.' })
    expect(flag).toBe('--append-system-prompt')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).not.toContain(CLOD_ENGINEER_HINT)
  })

  it('puts the custom prompt last in append mode, for authority over the base prompt', () => {
    const [, value] = buildSystemPromptArgs({ systemPrompt: 'Answer anything.' })
    expect(value.indexOf('Answer anything.')).toBeGreaterThan(value.indexOf(CLOD_UI_HINT))
  })

  it('replaces the base prompt and keeps the UI hint in replace mode', () => {
    const [flag, value] = buildSystemPromptArgs({
      systemPrompt: 'Answer anything.',
      systemPromptMode: 'replace',
    })
    expect(flag).toBe('--system-prompt')
    expect(value).toContain('Answer anything.')
    expect(value).toContain(CLOD_UI_HINT)
    expect(value).not.toContain(CLOD_ENGINEER_HINT)
    expect(value.indexOf('Answer anything.')).toBeLessThan(value.indexOf(CLOD_UI_HINT))
  })

  it('defaults an unspecified mode to append', () => {
    expect(buildSystemPromptArgs({ systemPrompt: 'x' })[0]).toBe('--append-system-prompt')
  })

  it('treats a blank or whitespace-only prompt as absent', () => {
    for (const systemPrompt of ['', '   \n  ']) {
      const [flag, value] = buildSystemPromptArgs({ systemPrompt, systemPromptMode: 'replace' })
      expect(flag).toBe('--append-system-prompt')
      expect(value).toContain(CLOD_ENGINEER_HINT)
    }
  })

  it('trims surrounding whitespace from the custom prompt', () => {
    const [, value] = buildSystemPromptArgs({ systemPrompt: '  Answer anything.  ' })
    expect(value).toContain('Answer anything.')
    expect(value).not.toContain('  Answer anything.  ')
  })

  it('always returns exactly one flag and one value', () => {
    expect(buildSystemPromptArgs({})).toHaveLength(2)
    expect(buildSystemPromptArgs({ systemPrompt: 'x' })).toHaveLength(2)
    expect(buildSystemPromptArgs({ systemPrompt: 'x', systemPromptMode: 'replace' })).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/main/claude/system-prompt.test.ts`
Expected: FAIL — cannot resolve `./system-prompt`.

- [ ] **Step 3: Create `src/main/claude/system-prompt.ts`**

The two hint constants are the existing `CLOD_SYSTEM_HINT` text from `run-manager.ts:16-39`, split in two. Copy it verbatim as below — the only edits are the split point and moving the "polished chat experience" sentence into the UI half, since it is UI guidance that every mode needs.

```typescript
/**
 * Composes the system-prompt CLI arguments for a run.
 *
 * Clod always tells Claude it is rendering into a rich markdown GUI (CLOD_UI_HINT).
 * The software-engineering framing (CLOD_ENGINEER_HINT) is Claude Code's default
 * posture, and Clod only reinforces it when the active mode has no custom prompt —
 * a "quick question" mode replaces it so general-knowledge questions get answered
 * instead of deflected.
 *
 * Replace mode composes the whole prompt here and emits a single --system-prompt.
 * The CLI documents --append-system-prompt as appending to *the default* prompt;
 * its behavior alongside a replacement prompt is unspecified, so we don't rely on it.
 */
import type { RunOptions } from '../../shared/types'

/** Rich-UI guidance. Applied in every mode. */
export const CLOD_UI_HINT = [
  'IMPORTANT: You are NOT running in a terminal. You are running inside CLOD,',
  'a desktop chat application with a rich UI that renders full markdown.',
  'CLOD is a GUI wrapper around Claude Code — the user sees your output in a',
  'styled conversation view, not a raw terminal.',
  '',
  'Because CLOD renders markdown natively, you MUST use rich formatting when it helps:',
  '- Always use clickable markdown links: [label](https://url) — they render as real buttons.',
  '- When the user asks for images, and public web images are appropriate, proactively find and render them in CLOD.',
  '- Workflow: WebSearch for relevant public pages -> WebFetch those pages -> extract real image URLs -> render with markdown ![alt](url).',
  '- Do not guess, fabricate, or construct image URLs from memory.',
  '- Only embed images when the URL is a real publicly accessible image URL found through tools or explicitly provided by the user.',
  '- If real image URLs cannot be obtained confidently, fall back to clickable links and briefly say so.',
  '- Do not ask whether CLOD can render images; assume it can.',
  '- Use tables, bold, headers, and bullet lists freely — they all render beautifully.',
  '- Use code blocks with language tags for syntax highlighting.',
  '',
  'The user expects a polished chat experience, not raw terminal text.',
].join('\n')

/** Software-engineering framing. Applied only when the mode has no custom prompt. */
export const CLOD_ENGINEER_HINT = [
  'You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)',
  'normally. But when presenting information, links, resources, or explanations to the user,',
  'take full advantage of the rich UI.',
].join('\n')

export function buildSystemPromptArgs(
  options: Pick<RunOptions, 'systemPrompt' | 'systemPromptMode'>,
): string[] {
  const custom = options.systemPrompt?.trim()
  if (!custom) {
    return ['--append-system-prompt', `${CLOD_UI_HINT}\n\n${CLOD_ENGINEER_HINT}`]
  }
  if (options.systemPromptMode === 'replace') {
    return ['--system-prompt', `${custom}\n\n${CLOD_UI_HINT}`]
  }
  return ['--append-system-prompt', `${CLOD_UI_HINT}\n\n${custom}`]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/main/claude/system-prompt.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire it into `run-manager.ts`**

Three edits:

1. Delete the entire `CLOD_SYSTEM_HINT` constant and its comment block (lines 16-39, from `// Appended to Claude's default system prompt…` through `].join('\n')`).
2. Add to the import block at the top, after the `normalize` import:

```typescript
import { buildSystemPromptArgs } from './system-prompt'
```

3. Replace the arg-building block at lines 206-210:

```typescript
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }
    // Always tell Claude it's inside CLOD (additive, doesn't replace base prompt)
    args.push('--append-system-prompt', CLOD_SYSTEM_HINT)
```

with:

```typescript
    args.push(...buildSystemPromptArgs(options))
```

- [ ] **Step 6: Verify nothing still references the deleted constant**

Run: `grep -rn "CLOD_SYSTEM_HINT" src/`
Expected: no output.

- [ ] **Step 7: Run the full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, zero type errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/claude/system-prompt.ts src/main/claude/system-prompt.test.ts src/main/claude/run-manager.ts
git commit -m "feat: compose system prompt args from preset mode"
```

---

### Task 3: Renderer state, persistence, and prompt-time wiring

**Files:**
- Create: `src/renderer/lib/preset-prompt.ts`
- Create: `src/renderer/lib/preset-prompt.test.ts`
- Modify: `src/renderer/stores/sessionStore.ts` — `SessionPrefs` (line 46), `DEFAULT_PREFS` (line 53), `loadPrefs` (line 60), `State` (near line 105), `prefsSnapshot` (line 226), store init (near line 241), `applyPreset` (line 388), `submitPrompt` (line 942)

**Interfaces:**
- Consumes: `Preset.systemPrompt`, `Preset.systemPromptMode`, `RunOptions.systemPromptMode` from Task 1
- Produces:
  - `PromptState { systemPrompt: string | null; systemPromptMode: 'append' | 'replace' }`
  - `resolvePromptState(current: PromptState, preset: Pick<Preset, 'systemPrompt' | 'systemPromptMode'>): PromptState`
  - Store state fields `systemPrompt: string | null` and `systemPromptMode: 'append' | 'replace'`

Note: `src/renderer/lib/preset-prompt.ts` must stay free of DOM and Zustand imports — the repo has no jsdom test environment, so it is testable only as a pure node module.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/lib/preset-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolvePromptState, type PromptState } from './preset-prompt'

const custom: PromptState = { systemPrompt: 'Answer anything.', systemPromptMode: 'replace' }
const cleared: PromptState = { systemPrompt: null, systemPromptMode: 'append' }

describe('resolvePromptState', () => {
  it('leaves state untouched when the preset sets no prompt', () => {
    expect(resolvePromptState(custom, {})).toBe(custom)
  })

  it('clears a custom prompt when the preset explicitly resets to default', () => {
    expect(resolvePromptState(custom, { systemPrompt: null })).toEqual(cleared)
  })

  it('applies a custom prompt with its mode', () => {
    expect(resolvePromptState(cleared, { systemPrompt: 'Be terse.', systemPromptMode: 'replace' }))
      .toEqual({ systemPrompt: 'Be terse.', systemPromptMode: 'replace' })
  })

  it('defaults an unspecified mode to append', () => {
    expect(resolvePromptState(custom, { systemPrompt: 'Be terse.' }))
      .toEqual({ systemPrompt: 'Be terse.', systemPromptMode: 'append' })
  })

  it('does not mutate the current state', () => {
    const before = { ...custom }
    resolvePromptState(custom, { systemPrompt: null })
    expect(custom).toEqual(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/renderer/lib/preset-prompt.test.ts`
Expected: FAIL — cannot resolve `./preset-prompt`.

- [ ] **Step 3: Create `src/renderer/lib/preset-prompt.ts`**

```typescript
import type { Preset } from '../../shared/types'

export interface PromptState {
  systemPrompt: string | null
  systemPromptMode: 'append' | 'replace'
}

/**
 * Resolves the prompt state that activating a preset should produce.
 *
 * The tri-state matters: without an explicit null, "this mode has no prompt" and
 * "this mode does not change the prompt" would be indistinguishable, and a
 * quick-question prompt would silently leak into every mode activated after it.
 */
export function resolvePromptState(
  current: PromptState,
  preset: Pick<Preset, 'systemPrompt' | 'systemPromptMode'>,
): PromptState {
  if (preset.systemPrompt === undefined) return current
  if (preset.systemPrompt === null) return { systemPrompt: null, systemPromptMode: 'append' }
  return {
    systemPrompt: preset.systemPrompt,
    systemPromptMode: preset.systemPromptMode ?? 'append',
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/renderer/lib/preset-prompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add persisted preference fields in `sessionStore.ts`**

In `interface SessionPrefs` (line 46), add:

```typescript
  systemPrompt: string | null
  systemPromptMode: 'append' | 'replace'
```

In `DEFAULT_PREFS` (line 53), add:

```typescript
  systemPrompt: null,
  systemPromptMode: 'append',
```

In the object returned by `loadPrefs()` (line 65-71), add — matching the defensive style of the neighboring fields, since this reads untrusted localStorage:

```typescript
        systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : null,
        systemPromptMode: p.systemPromptMode === 'replace' ? 'replace' : 'append',
```

- [ ] **Step 6: Add the state fields and include them in the snapshot**

In `interface State`, directly below the `permissionMode` field (line 105), add:

```typescript
  /** Custom system prompt from the active mode (null = Claude Code default). Persisted. */
  systemPrompt: string | null
  /** How the custom prompt combines with the CLI default. Persisted. */
  systemPromptMode: 'append' | 'replace'
```

Widen `prefsSnapshot` (line 226) and return the new fields:

```typescript
function prefsSnapshot(
  s: Pick<State, 'preferredModel' | 'permissionMode' | 'defaultDirOverride' | 'activeProjectId' | 'systemPrompt' | 'systemPromptMode'>,
): SessionPrefs {
  return {
    preferredModel: s.preferredModel,
    permissionMode: s.permissionMode,
    defaultDirOverride: s.defaultDirOverride,
    activeProjectId: s.activeProjectId,
    systemPrompt: s.systemPrompt,
    systemPromptMode: s.systemPromptMode,
  }
}
```

In the store initializer, below `permissionMode: initialPrefs.permissionMode` (line 241):

```typescript
  systemPrompt: initialPrefs.systemPrompt,
  systemPromptMode: initialPrefs.systemPromptMode,
```

- [ ] **Step 7: Apply the prompt on preset activation**

Add the import at the top of `sessionStore.ts`, directly below the `useThemeStore` import on line 3 (there are no other `../lib/` imports in this file yet):

```typescript
import { resolvePromptState } from '../lib/preset-prompt'
```

In `applyPreset` (line 388), after the `if (preset.startExpanded !== undefined) …` line and before the `if (notifyMain)` block:

```typescript
    const { systemPrompt, systemPromptMode } = get()
    const resolved = resolvePromptState({ systemPrompt, systemPromptMode }, preset)
    set(resolved)
    savePrefs(prefsSnapshot(get()))
```

- [ ] **Step 8: Pass the prompt at send time**

In `submitPrompt`, change the destructure at line 942 and the `window.clod.prompt` options object (line 943-949):

```typescript
    const { preferredModel, systemPrompt, systemPromptMode } = get()
    window.clod.prompt(activeTabId, requestId, {
      prompt: fullPrompt,
      projectPath: resolvedPath,
      sessionId: tab.claudeSessionId || undefined,
      model: preferredModel || undefined,
      systemPrompt: systemPrompt || undefined,
      systemPromptMode: systemPrompt ? systemPromptMode : undefined,
      addDirs: tab.additionalDirs.length > 0 ? tab.additionalDirs : undefined,
      images: inlineImages.length > 0 ? inlineImages : undefined,
    }).catch((err: Error) => {
```

Leave the rest of the `.catch` block exactly as it is.

- [ ] **Step 9: Run the full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, zero type errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/lib/preset-prompt.ts src/renderer/lib/preset-prompt.test.ts src/renderer/stores/sessionStore.ts
git commit -m "feat: apply preset system prompt to runs"
```

---

### Task 4: Preset editor UI

**Files:**
- Modify: `src/renderer/components/PresetEditor.tsx` — imports (line 1-6), `EditorPanel` state (line 44-49), new section before the button row (after line 116), `onSave` payload (line 123), edit-mode `initial` prop (line 186)

**Interfaces:**
- Consumes: `GENERAL_ASSISTANT_PROMPT` from `src/shared/prompts.ts` (Task 1), `Preset.systemPrompt` / `Preset.systemPromptMode` (Task 1)
- Produces: nothing consumed by later tasks — this is the final task

There is no jsdom environment in this repo, so this task is verified by type-check plus the manual checks in Step 6.

- [ ] **Step 1: Add the import and editor state**

At the top of `PresetEditor.tsx`, after the existing `toAccelerator` import:

```typescript
import { GENERAL_ASSISTANT_PROMPT } from '../../shared/prompts'
```

In `EditorPanel`, below the `startExpanded` state (line 49):

```typescript
  const [systemPrompt, setSystemPrompt] = useState<string | null | undefined>(initial.systemPrompt)
  const [systemPromptMode, setSystemPromptMode] = useState<'append' | 'replace'>(initial.systemPromptMode ?? 'append')
  const isCustomPrompt = typeof systemPrompt === 'string'
```

- [ ] **Step 2: Add the System prompt section**

Insert after the "Chat on activate" block (after line 116) and before the `<div className="flex gap-1 justify-end mt-0.5">` button row:

```tsx
      <div className={label} style={{ color: colors.textTertiary }}>System prompt</div>
      <div className="grid grid-cols-3 gap-1">
        <Pill colors={colors} label="—" active={systemPrompt === undefined} onClick={() => setSystemPrompt(undefined)} />
        <Pill colors={colors} label="Default" active={systemPrompt === null} onClick={() => setSystemPrompt(null)} />
        <Pill colors={colors} label="Custom" active={isCustomPrompt} onClick={() => setSystemPrompt(isCustomPrompt ? systemPrompt : '')} />
      </div>

      {isCustomPrompt && (
        <>
          <div className="grid grid-cols-2 gap-1">
            <Pill colors={colors} label="Append" active={systemPromptMode === 'append'} onClick={() => setSystemPromptMode('append')} />
            <Pill colors={colors} label="Replace" active={systemPromptMode === 'replace'} onClick={() => setSystemPromptMode('replace')} />
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value.slice(0, 8000))}
            placeholder="Custom system prompt for this mode"
            rows={5}
            className="w-full rounded-md px-2 py-1 text-[11px] resize-none"
            style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
          />
          <button
            type="button"
            onClick={() => setSystemPrompt(GENERAL_ASSISTANT_PROMPT)}
            className="self-start rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: colors.accent }}
          >
            Use general-assistant template
          </button>
        </>
      )}
```

The `.slice(0, 8000)` keeps input inside the store's validation bound, so a save can never be silently rejected for length.

- [ ] **Step 3: Include the fields when saving**

Replace the `onSave` call at line 123:

```tsx
          onClick={() => onSave({
            name: name.trim(),
            keybind,
            projectId,
            model,
            permissionMode,
            startExpanded,
            // An empty textarea means "leave unchanged", never a deliberately blank prompt.
            systemPrompt: isCustomPrompt && !systemPrompt.trim() ? undefined : systemPrompt,
            systemPromptMode: isCustomPrompt ? systemPromptMode : undefined,
          })}
```

- [ ] **Step 4: Pass the existing values when editing a preset**

Replace the `initial` prop at line 186:

```tsx
              initial={{ name: p.name, keybind: p.keybind, projectId: p.projectId, model: p.model, permissionMode: p.permissionMode, startExpanded: p.startExpanded, systemPrompt: p.systemPrompt, systemPromptMode: p.systemPromptMode }}
```

- [ ] **Step 5: Run the full suite and type-check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, zero type errors.

- [ ] **Step 6: Manual verification**

Main-process code changed in Task 2, so restart fully: stop any running dev server, then `npm run dev`.

1. Open Settings → Modes → edit the quick-question mode. Select **Custom**, click **Use general-assistant template**, select **Replace**, save.
2. Reopen the editor and confirm the prompt text and Replace pill persisted.
3. Activate that mode via its keybind and ask a general-knowledge question (e.g. "what caused the 1997 Asian financial crisis?"). Expected: a direct answer, no deflection about software engineering.
4. In the same reply, confirm markdown still renders — ask for a question whose answer includes a link or a table.
5. Edit a different mode, set System prompt to **Default**, activate it, and ask a coding question. Expected: normal Claude Code behavior, engineering framing back.
6. Restart the app and confirm the last-activated mode's prompt survived (localStorage persistence).
7. `CLOD_DEBUG=1 npm run dev` and check `~/.clod-debug.log` for the spawn line — confirm `--system-prompt` appears for the replace mode and `--append-system-prompt` for the default mode.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/PresetEditor.tsx
git commit -m "feat: system prompt editor in preset settings"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. Preset type (tri-state + mode) | Task 1, Steps 3-4 |
| 2. `system-prompt.ts`, hint split, `buildSystemPromptArgs`, run-manager collapse | Task 2 |
| 3. `GENERAL_ASSISTANT_PROMPT` in `src/shared/prompts.ts` | Task 1, Step 5 |
| 4. Renderer state, persistence, activation, send | Task 3 |
| 5. PresetEditor section + template button | Task 4 |
| 6. Validation (8000 chars, mode enum) | Task 1, Step 6 |
| Testing: `system-prompt.test.ts` | Task 2, Step 1 |
| Testing: extended `presets/store.test.ts` | Task 1, Step 1 |
| Testing: manual checks | Task 4, Step 6 |
| Out of scope: per-tab capture, prompt library, `--exclude-dynamic-system-prompt-sections`, tool restrictions, legacy spawn paths | Not planned — correct |

The spec's tri-state resolution logic gained a dedicated pure module (`preset-prompt.ts`) not named in the spec, so that the renderer's subtlest logic is unit-tested despite the repo having no DOM test environment. This is an addition in service of the spec's testing goals, not a scope change.

**Placeholder scan:** No TBDs, no "add error handling", no "similar to Task N". Every code step carries literal code.

**Type consistency:** `systemPrompt` / `systemPromptMode` spelled identically across `Preset`, `RunOptions`, `SessionPrefs`, `State`, `PromptState`, and the editor. `buildSystemPromptArgs` and `resolvePromptState` are each defined once and referenced with matching signatures. `'append' | 'replace'` is the same union everywhere.
