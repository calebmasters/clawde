# Phase 3: Inline Selectable Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude asks a question (AskUserQuestion tool), render selectable option buttons inline in the conversation and return the chosen answer to the CLI; and give the `/` menu a real skills picker backed by the installed-skills directory.

**Architecture:** AskUserQuestion is intercepted by the existing PreToolUse HTTP hook (`permission-server.ts`) via a widened matcher. A validated question payload flows through a new `question-request` event → ControlPlane → `question_request` NormalizedEvent → a `QuestionCard` in the conversation. The answer returns through the hook response as `permissionDecision: allow` + updated tool input carrying an `answers` map (mechanism confirmed against CLI docs; Task 1 is a spike that verifies it empirically against the installed CLI before any UI work — with a deny-with-reason fallback encoding if needed). The skills picker is a main-process scan of `~/.claude/skills/*/SKILL.md` exposed over `SKILLS_LIST`, merged with session skills in the `/` menu, with a dedicated skills mode.

**Tech Stack:** Electron 33, Node http, React 19, Zustand 5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-clod-expansion-design.md` (Phase 3 section). Independent of Phases 1–2. Note: the spec's `question_resolved` event is intentionally dropped — the queue clears on answer and on run completion (`task_complete`/`error`/`session_dead`), so a separate resolve event has no consumer.

## Global Constraints

- TypeScript strict mode + `npm test` green before every commit.
- `IPC.*` constants only; new channels in `src/shared/types.ts`, wired in both `src/preload/index.ts` and `src/main/index.ts`.
- Security invariants untouched: server binds 127.0.0.1, per-launch app secret + per-run tokens, deny-by-default on every failure path, 5-minute auto-timeout, `maskSensitiveFields` before display.
- Questions bypass auto-approve mode: a question is not a permission — the card always shows.
- New event types: raw/normalized in `src/shared/types.ts`, handled in `sessionStore.handleNormalizedEvent`.
- Renderer colors via `useColors()`; Phosphor icons; Framer Motion.
- Commit format `<type>: <description>`, no attribution trailers. Main-process changes need a dev-server restart.

---

### Task 1: Spike — verify the AskUserQuestion answer channel

**Files:**
- Create: `scripts/spike-ask-question.mjs`

**Interfaces:**
- Consumes: the installed `claude` CLI, Node stdlib only.
- Produces: a confirmed answer mechanism. **Decision gate for Task 2:** if variant `allow-updated` passes, `respondToQuestion` uses allow+updatedInput (the code as written in Task 2). If only `deny-reason` passes, Task 2's response building switches to deny-with-reason encoding (noted inline there).

- [ ] **Step 1: Write the spike script**

Create `scripts/spike-ask-question.mjs`:

```js
#!/usr/bin/env node
/**
 * Spike: verify how to ANSWER an AskUserQuestion tool call from a PreToolUse
 * HTTP hook in headless (-p) mode, against the locally installed claude CLI.
 *
 * Usage:
 *   node scripts/spike-ask-question.mjs                # variant: allow-updated
 *   node scripts/spike-ask-question.mjs deny-reason    # fallback variant
 *
 * PASS = the final output contains "ANSWER=red" (the hook always answers the
 * first option, and the prompt makes the first option "red").
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const variant = process.argv[2] || 'allow-updated'

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const hook = JSON.parse(body)
    console.log('\n=== HOOK REQUEST (tool_input schema — save this) ===')
    console.log(JSON.stringify(hook.tool_input, null, 2))

    const questions = hook.tool_input?.questions ?? []
    const answers = {}
    for (const q of questions) answers[q.question] = q.options?.[0]?.label ?? 'red'

    let response
    if (variant === 'allow-updated') {
      const updatedInput = { ...hook.tool_input, answers }
      response = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Answered by spike',
          updatedInput,
        },
        // Defensive mirror — some doc versions name the field at top level.
        updatedToolInput: updatedInput,
      }
    } else {
      response = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `The user answered the question: ${JSON.stringify(answers)}. Continue with this answer.`,
        },
      }
    }
    console.log('=== HOOK RESPONSE SENT ===')
    console.log(JSON.stringify(response, null, 2))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  })
})

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  const dir = mkdtempSync(join(tmpdir(), 'clod-spike-'))
  const settingsPath = join(dir, 'settings.json')
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/`, timeout: 60 }],
      }],
    },
  }, null, 2))

  const prompt = 'Use the AskUserQuestion tool to ask me exactly one question: "Which color do you prefer?" with two options, "red" first and "blue" second. After receiving my answer, reply with exactly: ANSWER=<the label I chose> and nothing else.'
  const child = spawn('claude', [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--settings', settingsPath,
    '--max-turns', '4',
  ], { stdio: ['ignore', 'pipe', 'inherit'] })

  let out = ''
  child.stdout.on('data', (c) => { out += c; process.stdout.write(c) })
  child.on('exit', (code) => {
    server.close()
    const pass = /ANSWER=red/i.test(out)
    console.log(`\n=== SPIKE ${pass ? 'PASS' : 'FAIL'} (variant=${variant}, exit=${code}) ===`)
    process.exit(pass ? 0 : 1)
  })
})
```

- [ ] **Step 2: Run the spike**

Run: `node scripts/spike-ask-question.mjs`
Expected: prints the hook request `tool_input` (confirming the `questions[].question/header/options[].label/description/multiSelect` schema) and ends with `=== SPIKE PASS (variant=allow-updated…) ===`.

If FAIL: run `node scripts/spike-ask-question.mjs deny-reason`. Record which variant passed as a note on this checkbox — Task 2 Step 4 has a conditional branch for it. If BOTH fail, stop and re-read the printed hook request/response pair against current hook docs before proceeding (do not build UI on an unverified channel).

- [ ] **Step 3: Commit**

```bash
git add scripts/spike-ask-question.mjs
git commit -m "test: spike verifying AskUserQuestion answer channel via PreToolUse hook"
```

---

### Task 2: Question types, parsing, and permission-server branch (TDD)

**Files:**
- Modify: `src/shared/types.ts` (question types, `questionQueue` on TabState, normalized event, IPC channel)
- Create: `src/main/hooks/questions.ts`
- Test: `src/main/hooks/questions.test.ts`
- Modify: `src/main/hooks/permission-server.ts`

**Interfaces:**
- Consumes: spike result (Task 1).
- Produces:
  - Shared: `QuestionOption { label: string; description?: string }`, `QuestionItem { question: string; header?: string; options: QuestionOption[]; multiSelect: boolean }`, `QuestionRequest { questionId: string; questions: QuestionItem[] }`; `TabState.questionQueue: QuestionRequest[]`; NormalizedEvent variant `{ type: 'question_request'; questionId: string; questions: QuestionItem[] }`; `IPC.RESPOND_QUESTION`.
  - `parseQuestions(toolInput: Record<string, unknown> | undefined): QuestionItem[] | null` (exported from `src/main/hooks/questions.ts`).
  - `PermissionServer` additions: event `'question-request' (questionId: string, questions: QuestionItem[], toolRequest: HookToolRequest, tabId: string)`; method `respondToQuestion(questionId: string, answers: Record<string, string | string[]>): boolean`.

- [ ] **Step 1: Shared types**

In `src/shared/types.ts`:

After the Presets section (or after Session History if Phase 2 hasn't landed):

```ts
// ─── Inline questions (AskUserQuestion) ───

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  question: string
  /** Short chip label (≤12 chars by convention) */
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionRequest {
  questionId: string
  questions: QuestionItem[]
}
```

In `interface TabState`, after `permissionDenied`:

```ts
  /** Pending AskUserQuestion requests awaiting an inline answer */
  questionQueue: QuestionRequest[]
```

In the `NormalizedEvent` union, after the `permission_request` variant:

```ts
  | { type: 'question_request'; questionId: string; questions: QuestionItem[] }
```

In the `IPC` const, after `RESPOND_PERMISSION`:

```ts
  RESPOND_QUESTION: 'clod:respond-question',
```

In `src/renderer/stores/sessionStore.ts`, add `questionQueue: [],` to the object returned by `makeLocalTab()` (after `permissionDenied: null,`) so typecheck stays green. (Full store handling lands in Task 3.)

- [ ] **Step 2: Write the failing parser tests**

Create `src/main/hooks/questions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseQuestions } from './questions'

const valid = {
  questions: [{
    question: 'Which color do you prefer?',
    header: 'Color',
    options: [
      { label: 'red', description: 'Warm' },
      { label: 'blue' },
    ],
    multiSelect: false,
  }],
}

describe('parseQuestions', () => {
  it('parses a valid single question', () => {
    expect(parseQuestions(valid)).toEqual([{
      question: 'Which color do you prefer?',
      header: 'Color',
      options: [{ label: 'red', description: 'Warm' }, { label: 'blue' }],
      multiSelect: false,
    }])
  })

  it('defaults multiSelect to false and header to undefined', () => {
    const result = parseQuestions({ questions: [{ question: 'Q?', options: [{ label: 'a' }] }] })
    expect(result).toEqual([{ question: 'Q?', header: undefined, options: [{ label: 'a' }], multiSelect: false }])
  })

  it('rejects missing/empty questions array', () => {
    expect(parseQuestions(undefined)).toBeNull()
    expect(parseQuestions({})).toBeNull()
    expect(parseQuestions({ questions: [] })).toBeNull()
    expect(parseQuestions({ questions: 'nope' })).toBeNull()
  })

  it('rejects a question with no valid options or empty text', () => {
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [] }] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: '', options: [{ label: 'a' }] }] })).toBeNull()
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [{ label: '' }] }] })).toBeNull()
  })

  it('drops non-string descriptions but keeps the option', () => {
    const result = parseQuestions({ questions: [{ question: 'Q?', options: [{ label: 'a', description: 42 }] }] })
    expect(result).toEqual([{ question: 'Q?', header: undefined, options: [{ label: 'a' }], multiSelect: false }])
  })

  it('caps at 4 questions and 12 options (defensive)', () => {
    const q = { question: 'Q?', options: [{ label: 'a' }] }
    expect(parseQuestions({ questions: [q, q, q, q, q] })).toBeNull()
    const manyOpts = { question: 'Q?', options: Array.from({ length: 13 }, (_, i) => ({ label: `o${i}` })) }
    expect(parseQuestions({ questions: [manyOpts] })).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests (fail), then implement the parser**

Run: `npm test -- hooks/questions` — FAIL (module missing).

Create `src/main/hooks/questions.ts`:

```ts
/**
 * Validation for AskUserQuestion tool_input (schema per Claude Code docs,
 * confirmed by scripts/spike-ask-question.mjs). Fail-closed: anything
 * malformed returns null and the hook denies.
 */
import type { QuestionItem, QuestionOption } from '../../shared/types'

const MAX_QUESTIONS = 4
const MAX_OPTIONS = 12
const MAX_TEXT = 4000

function parseOption(v: unknown): QuestionOption | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { label?: unknown; description?: unknown }
  if (typeof o.label !== 'string' || o.label.length === 0 || o.label.length > MAX_TEXT) return null
  const description = typeof o.description === 'string' && o.description.length <= MAX_TEXT
    ? o.description
    : undefined
  return description !== undefined ? { label: o.label, description } : { label: o.label }
}

function parseQuestion(v: unknown): QuestionItem | null {
  if (!v || typeof v !== 'object') return null
  const q = v as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown }
  if (typeof q.question !== 'string' || q.question.length === 0 || q.question.length > MAX_TEXT) return null
  if (!Array.isArray(q.options) || q.options.length === 0 || q.options.length > MAX_OPTIONS) return null
  const options: QuestionOption[] = []
  for (const raw of q.options) {
    const opt = parseOption(raw)
    if (!opt) return null
    options.push(opt)
  }
  return {
    question: q.question,
    header: typeof q.header === 'string' ? q.header : undefined,
    options,
    multiSelect: q.multiSelect === true,
  }
}

export function parseQuestions(toolInput: Record<string, unknown> | undefined): QuestionItem[] | null {
  if (!toolInput || !Array.isArray(toolInput.questions)) return null
  if (toolInput.questions.length === 0 || toolInput.questions.length > MAX_QUESTIONS) return null
  const items: QuestionItem[] = []
  for (const raw of toolInput.questions) {
    const q = parseQuestion(raw)
    if (!q) return null
    items.push(q)
  }
  return items
}
```

Run: `npm test -- hooks/questions` — PASS.

- [ ] **Step 4: Permission-server branch**

In `src/main/hooks/permission-server.ts`:

Add imports:

```ts
import { parseQuestions } from './questions'
import type { QuestionItem } from '../../shared/types'
```

Widen the hook matcher (currently `const HOOK_MATCHER = \`^(${PERMISSION_REQUIRED_TOOLS.join('|')}|mcp__.*)$\``):

```ts
const HOOK_MATCHER = `^(${[...PERMISSION_REQUIRED_TOOLS, 'AskUserQuestion'].join('|')}|mcp__.*)$`
```

Extend `PermissionDecision`:

```ts
export interface PermissionDecision {
  decision: 'allow' | 'deny'
  reason?: string
  /** For AskUserQuestion: modified tool_input carrying the user's answers */
  updatedInput?: Record<string, unknown>
}
```

Extend `allowResponse` to carry the updated input (replace the existing function):

```ts
/** Build an allow hook response, optionally carrying updated tool input */
function allowResponse(reason: string, updatedInput?: Record<string, unknown>) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
      ...(updatedInput ? { updatedInput } : {}),
    },
    // Defensive mirror — accepted field name varies across CLI doc versions.
    ...(updatedInput ? { updatedToolInput: updatedInput } : {}),
  }
}
```

> **Spike gate:** if Task 1 passed only with `deny-reason`, skip the `allowResponse` change and instead have `respondToQuestion` resolve `{ decision: 'deny', reason: 'The user answered the question: <JSON answers>. Continue with this answer.' }` — the rest of this plan is unchanged.

Add the response method after `respondToPermission`:

```ts
  /**
   * Answer a pending AskUserQuestion. `answers` maps question text →
   * selected label (or labels for multiSelect). Validated fail-closed.
   */
  respondToQuestion(questionId: string, answers: Record<string, string | string[]>): boolean {
    const pending = this.pendingRequests.get(questionId)
    if (!pending) {
      log(`respondToQuestion: no pending request for ${questionId}`)
      return false
    }
    clearTimeout(pending.timeout)
    this.pendingRequests.delete(questionId)

    if (!isValidAnswers(answers)) {
      log(`respondToQuestion [${questionId}]: invalid answers payload — denying (fail-closed)`)
      pending.resolve({ decision: 'deny', reason: 'Invalid answer payload' })
      return true
    }

    log(`Question answered [${questionId}]: ${Object.keys(answers).length} answer(s)`)
    pending.resolve({
      decision: 'allow',
      reason: 'Answered by user',
      updatedInput: { ...pending.toolRequest.tool_input, answers },
    })
    return true
  }
```

with the validator near the other module helpers:

```ts
const MAX_ANSWER_LENGTH = 4000

function isValidAnswers(v: unknown): v is Record<string, string | string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length === 0 || entries.length > 8) return false
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_ANSWER_LENGTH) return false
    if (typeof value === 'string') {
      if (value.length > MAX_ANSWER_LENGTH) return false
    } else if (Array.isArray(value)) {
      if (value.length === 0 || value.length > 12) return false
      if (!value.every((s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ANSWER_LENGTH)) return false
    } else {
      return false
    }
  }
  return true
}
```

In `_handleRequest`, add the question branch immediately after the "Validate hook event name" block and the debug logging (before the scoped-allow checks — a question is not a permission and never auto-allows):

```ts
    // AskUserQuestion: not a permission — always surface to the user,
    // regardless of permission mode or scoped allows.
    if (toolRequest.tool_name === 'AskUserQuestion') {
      const questions = parseQuestions(toolRequest.tool_input)
      if (!questions) {
        log('AskUserQuestion with malformed tool_input — denying (fail-closed)')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(denyResponse('Malformed question payload')))
        return
      }

      const questionId = `question-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      const decision = await new Promise<PermissionDecision>((resolve) => {
        const timeout = setTimeout(() => {
          log(`Question timeout [${questionId}] — auto-denying`)
          this.pendingRequests.delete(questionId)
          resolve({ decision: 'deny', reason: 'Question timed out after 5 minutes' })
        }, PERMISSION_TIMEOUT_MS)

        this.pendingRequests.set(questionId, {
          toolRequest,
          resolve,
          timeout,
          questionId,
          runToken: urlToken,
        })
        this.emit('question-request', questionId, questions, toolRequest, registration.tabId)
      })

      const response = decision.decision === 'allow'
        ? allowResponse(decision.reason || 'Answered by user', decision.updatedInput)
        : denyResponse(decision.reason || 'Question not answered')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
      return
    }
```

Update the class doc comment's Events list to include:

```
 *  - 'question-request' (questionId, questions, toolRequest, tabId) — AskUserQuestion awaiting inline answer
```

- [ ] **Step 5: Verify and commit**

Run: `npm test` — all pass (including existing permission-server-adjacent suites). `npm run typecheck` — exit 0.

```bash
git add src/shared/types.ts src/main/hooks/questions.ts src/main/hooks/questions.test.ts src/main/hooks/permission-server.ts src/renderer/stores/sessionStore.ts
git commit -m "feat: intercept AskUserQuestion in permission server with validated answer channel"
```

---

### Task 3: ControlPlane wiring, IPC, preload, and store handling

**Files:**
- Modify: `src/main/claude/control-plane.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/sessionStore.ts`

**Interfaces:**
- Consumes: `'question-request'` event + `respondToQuestion` (Task 2).
- Produces:
  - `ControlPlane.respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): boolean`
  - `window.clod.respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): Promise<boolean>`
  - Session store: `respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): void` action; `question_request` handling in `handleNormalizedEvent`; queue cleared on run end.

- [ ] **Step 1: ControlPlane**

In `src/main/claude/control-plane.ts`:

Add `QuestionItem` to the type import from `'../../shared/types'`.

In the constructor, after the existing `'permission-request'` wiring block, add:

```ts
    // AskUserQuestion → inline question card. Unlike permissions, questions
    // are never auto-approved: even in 'auto' mode the user must answer.
    this.permissionServer.on('question-request', (questionId: string, questions: QuestionItem[], _toolRequest: HookToolRequest, tabId: string) => {
      if (!this.tabs.has(tabId)) {
        log(`Question request for closed tab ${tabId.substring(0, 8)}… — auto-denying`)
        this.permissionServer.respondToPermission(questionId, 'deny', 'Tab closed')
        return
      }
      log(`Question request [${questionId}]: ${questions.length} question(s) tab=${tabId.substring(0, 8)}…`)
      const event: NormalizedEvent = { type: 'question_request', questionId, questions }
      this.emit('event', tabId, event)
    })
```

Add the response method next to `respondToPermission` (near line 708):

```ts
  /** Route an inline question answer to the permission server. */
  respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): boolean {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      log(`respondQuestion: unknown tab ${tabId}`)
      return false
    }
    return this.permissionServer.respondToQuestion(questionId, answers)
  }
```

- [ ] **Step 2: Main IPC handler**

In `src/main/index.ts`, after the `RESPOND_PERMISSION` handler:

```ts
ipcMain.handle(IPC.RESPOND_QUESTION, (_event, { tabId, questionId, answers }: { tabId: string; questionId: string; answers: Record<string, string | string[]> }) => {
  log(`IPC RESPOND_QUESTION: tab=${tabId} question=${questionId}`)
  return controlPlane.respondQuestion(tabId, questionId, answers)
})
```

- [ ] **Step 3: Preload**

In `src/preload/index.ts`, in `interface ClodAPI` after `respondPermission`:

```ts
  respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): Promise<boolean>
```

In the `api` object after the `respondPermission` entry:

```ts
  respondQuestion: (tabId, questionId, answers) =>
    ipcRenderer.invoke(IPC.RESPOND_QUESTION, { tabId, questionId, answers }),
```

- [ ] **Step 4: Session store**

In `src/renderer/stores/sessionStore.ts`:

Add to the `State` actions interface, after `respondPermission`:

```ts
  respondQuestion: (tabId: string, questionId: string, answers: Record<string, string | string[]>) => void
```

Implementation after the `respondPermission` action:

```ts
  respondQuestion: (tabId, questionId, answers) => {
    window.clod.respondQuestion(tabId, questionId, answers).catch(() => {})

    // Show the chosen answer(s) in the timeline like a user reply
    const summary = Object.values(answers)
      .map((a) => (Array.isArray(a) ? a.join(', ') : a))
      .join(' · ')

    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const remaining = t.questionQueue.filter((q) => q.questionId !== questionId)
        return {
          ...t,
          questionQueue: remaining,
          currentActivity: remaining.length > 0 ? 'Waiting for your answer...' : 'Working...',
          messages: summary
            ? [...t.messages, { id: nextMsgId(), role: 'user' as const, content: summary, timestamp: Date.now() }]
            : t.messages,
        }
      }),
    }))
  },
```

In `handleNormalizedEvent`, add a case after the `permission_request` case:

```ts
          case 'question_request':
            updated.questionQueue = [
              ...updated.questionQueue,
              { questionId: event.questionId, questions: event.questions },
            ]
            updated.currentActivity = 'Waiting for your answer...'
            break
```

Clear the queue wherever `permissionQueue` is cleared — add `updated.questionQueue = []` alongside `updated.permissionQueue = []` in the `task_complete`, `error`, and `session_dead` cases; add `questionQueue: []` next to `permissionQueue: []` in `clearTab`, in `handleStatusChange`'s idle-transition spread, and in `handleError`'s returned tab object.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

```bash
git add src/main/claude/control-plane.ts src/main/index.ts src/preload/index.ts src/renderer/stores/sessionStore.ts
git commit -m "feat: question request routing from hook server to renderer store"
```

---

### Task 4: QuestionCard UI

**Files:**
- Create: `src/renderer/components/QuestionCard.tsx`
- Modify: `src/renderer/components/ConversationView.tsx`

**Interfaces:**
- Consumes: `QuestionRequest`/`QuestionItem` types, `respondQuestion` store action (Task 3).
- Produces: `<QuestionCard tabId={string} request={QuestionRequest} />`.

- [ ] **Step 1: Create the component**

Create `src/renderer/components/QuestionCard.tsx`:

```tsx
import React, { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChatCircleDots, Check } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import type { QuestionRequest } from '../../shared/types'

interface Props {
  tabId: string
  request: QuestionRequest
}

/**
 * Inline selectable answers for an AskUserQuestion request. Multiple
 * questions answer sequentially; the response is sent once, after the last.
 * Keyboard: ↑/↓ move, Enter selects (or submits multi-select), typing in
 * "Other" answers free-form.
 */
export function QuestionCard({ tabId, request }: Props) {
  const respondQuestion = useSessionStore((s) => s.respondQuestion)
  const colors = useColors()

  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [highlight, setHighlight] = useState(0)
  const [multiPicks, setMultiPicks] = useState<Set<number>>(new Set())
  const [otherText, setOtherText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const question = request.questions[qIndex]
  // options + one virtual "Other…" slot at the end
  const optionCount = question.options.length

  // A pending question demands attention — move keyboard focus to the card.
  useEffect(() => {
    containerRef.current?.focus()
  }, [request.questionId, qIndex])

  if (!question || submitted) return null

  const finishQuestion = (value: string | string[]) => {
    const nextAnswers = { ...answers, [question.question]: value }
    if (qIndex + 1 < request.questions.length) {
      setAnswers(nextAnswers)
      setQIndex(qIndex + 1)
      setHighlight(0)
      setMultiPicks(new Set())
      setOtherText('')
    } else {
      setSubmitted(true)
      respondQuestion(tabId, request.questionId, nextAnswers)
    }
  }

  const selectSingle = (i: number) => finishQuestion(question.options[i].label)

  const toggleMulti = (i: number) => {
    setMultiPicks((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const submitMulti = () => {
    if (multiPicks.size === 0) return
    finishQuestion(question.options.filter((_, i) => multiPicks.has(i)).map((o) => o.label))
  }

  const submitOther = () => {
    if (!otherText.trim()) return
    finishQuestion(otherText.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % optionCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + optionCount) % optionCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (question.multiSelect) {
        if (multiPicks.size > 0) submitMulti()
        else toggleMulti(highlight)
      } else {
        selectSingle(highlight)
      }
    } else if (e.key === ' ' && question.multiSelect) {
      e.preventDefault()
      toggleMulti(highlight)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="mx-4 mt-2 mb-2"
    >
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{
          background: colors.containerBg,
          border: `1px solid ${colors.accentBorderMedium}`,
          borderRadius: 12,
          outline: 'none',
        }}
        className="overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5"
          style={{ background: colors.accentLight, borderBottom: `1px solid ${colors.accentBorder}` }}
        >
          <ChatCircleDots size={12} style={{ color: colors.accent }} />
          <span className="text-[11px] font-semibold" style={{ color: colors.accent }}>
            {question.header || 'Question'}
          </span>
          {request.questions.length > 1 && (
            <span className="text-[10px] ml-auto" style={{ color: colors.textTertiary }}>
              {qIndex + 1} / {request.questions.length}
            </span>
          )}
        </div>

        <div className="px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] mb-2" style={{ color: colors.textPrimary }}>
            {question.question}
          </p>

          <div className="flex flex-col gap-1">
            {question.options.map((opt, i) => {
              const picked = question.multiSelect && multiPicks.has(i)
              const highlighted = highlight === i
              return (
                <button
                  key={`${i}-${opt.label}`}
                  onClick={() => (question.multiSelect ? toggleMulti(i) : selectSingle(i))}
                  onMouseEnter={() => setHighlight(i)}
                  className="w-full text-left rounded-lg px-2.5 py-1.5 transition-colors"
                  style={{
                    background: picked ? colors.accentSoft : highlighted ? colors.surfaceHover : 'transparent',
                    border: `1px solid ${picked || highlighted ? colors.accentBorderMedium : colors.containerBorder}`,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {question.multiSelect && (
                      <span
                        className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0"
                        style={{ border: `1px solid ${picked ? colors.accent : colors.textTertiary}`, background: picked ? colors.accent : 'transparent' }}
                      >
                        {picked && <Check size={9} weight="bold" style={{ color: colors.textOnAccent }} />}
                      </span>
                    )}
                    <span className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                      {opt.label}
                    </span>
                  </span>
                  {opt.description && (
                    <span className="block text-[11px] mt-0.5 leading-[1.4]" style={{ color: colors.textTertiary }}>
                      {opt.description}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Other + multi-select submit row */}
          <div className="flex items-center gap-1.5 mt-2">
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') submitOther()
              }}
              placeholder="Other…"
              className="flex-1 rounded-md px-2 py-1 text-[11px]"
              style={{ background: colors.surfaceSecondary, color: colors.textPrimary, border: `1px solid ${colors.containerBorder}`, outline: 'none' }}
            />
            {question.multiSelect ? (
              <button
                onClick={submitMulti}
                disabled={multiPicks.size === 0}
                className="text-[11px] font-medium px-3 py-1 rounded-full disabled:opacity-40"
                style={{ background: colors.accent, color: colors.textOnAccent }}
              >
                Continue
              </button>
            ) : otherText.trim() ? (
              <button
                onClick={submitOther}
                className="text-[11px] font-medium px-3 py-1 rounded-full"
                style={{ background: colors.accent, color: colors.textOnAccent }}
              >
                Send
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Mount in the conversation**

In `src/renderer/components/ConversationView.tsx`:

Add `import { QuestionCard } from './QuestionCard'` next to the `PermissionCard` import.

Find the `PermissionCard` render site (`{tab.permissionQueue.length > 0 && (` around line 195) and add directly after that block:

```tsx
          {tab.questionQueue.length > 0 && (
            <QuestionCard
              key={tab.questionQueue[0].questionId}
              tabId={tab.id}
              request={tab.questionQueue[0]}
            />
          )}
```

The auto-scroll trigger (around line 98) currently includes `permissionQueueLen`; add the question queue the same way:

```ts
  const questionQueueLen = tab?.questionQueue?.length ?? 0
```

and extend the `scrollTrigger` template string with `:${questionQueueLen}`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual end-to-end (dev-server restart): send the prompt `Use the AskUserQuestion tool to ask me whether I prefer red or blue, then tell me what I picked.` → an inline card appears with two selectable options → clicking one makes Claude's reply reference it; the answer summary shows as a user bubble; arrows+Enter work after the card takes focus; "Other…" free text works; leaving it unanswered for 5 minutes auto-denies and the run continues.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/QuestionCard.tsx src/renderer/components/ConversationView.tsx
git commit -m "feat: inline selectable question card for AskUserQuestion"
```

---

### Task 5: Installed-skills scanner (TDD) + IPC

**Files:**
- Create: `src/main/skills/list.ts`
- Test: `src/main/skills/list.test.ts`
- Modify: `src/shared/types.ts` (IPC channel + shared type)
- Modify: `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: `~/.claude/skills/*/SKILL.md` layout (same layout `skills/installer.ts` writes).
- Produces:
  - Shared type `InstalledSkill { name: string; description: string }`; `IPC.SKILLS_LIST`.
  - `listInstalledSkills(skillsDir?: string): InstalledSkill[]`, `parseSkillFrontmatter(content: string): { name: string | null; description: string | null }` (exported from `src/main/skills/list.ts`).
  - `window.clod.listSkills(): Promise<InstalledSkill[]>` (30-second cache in main).

- [ ] **Step 1: Shared type + IPC name**

In `src/shared/types.ts`, after the question types:

```ts
/** A skill installed under ~/.claude/skills (for the / picker). */
export interface InstalledSkill {
  name: string
  description: string
}
```

In the `IPC` const, after `RESPOND_QUESTION`:

```ts
  SKILLS_LIST: 'clod:skills-list',
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/skills/list.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listInstalledSkills, parseSkillFrontmatter } from './list'

describe('parseSkillFrontmatter', () => {
  it('extracts name and description from YAML frontmatter', () => {
    const md = `---\nname: pdf-tools\ndescription: Work with PDF files\n---\n\n# PDF Tools\n`
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'pdf-tools', description: 'Work with PDF files' })
  })

  it('strips surrounding quotes', () => {
    const md = `---\nname: "quoted"\ndescription: 'single quoted value'\n---\nbody`
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'quoted', description: 'single quoted value' })
  })

  it('returns nulls without frontmatter or without the keys', () => {
    expect(parseSkillFrontmatter('# Just a heading')).toEqual({ name: null, description: null })
    expect(parseSkillFrontmatter('---\nversion: 1\n---\nbody')).toEqual({ name: null, description: null })
  })
})

describe('listInstalledSkills', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clod-skills-'))
  })

  const addSkill = (folder: string, frontmatter: string | null) => {
    mkdirSync(join(dir, folder), { recursive: true })
    if (frontmatter !== null) writeFileSync(join(dir, folder, 'SKILL.md'), frontmatter)
  }

  it('lists skills sorted by name, falling back to the folder name', () => {
    addSkill('zeta', `---\nname: zeta\ndescription: Z skill\n---\n`)
    addSkill('alpha-folder', `---\ndescription: no name key\n---\n`)
    const result = listInstalledSkills(dir)
    expect(result).toEqual([
      { name: 'alpha-folder', description: 'no name key' },
      { name: 'zeta', description: 'Z skill' },
    ])
  })

  it('skips folders without SKILL.md and tolerates a missing directory', () => {
    addSkill('empty-folder', null)
    expect(listInstalledSkills(dir)).toEqual([])
    expect(listInstalledSkills(join(dir, 'does-not-exist'))).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests (fail), then implement**

Run: `npm test -- skills/list` — FAIL (module missing).

Create `src/main/skills/list.ts`:

```ts
/**
 * Installed-skills scanner for the / picker. Reads ~/.claude/skills/<dir>/SKILL.md
 * frontmatter (name/description). Read-only; failures skip entries.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { InstalledSkill } from '../../shared/types'

function stripQuotes(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

export function parseSkillFrontmatter(content: string): { name: string | null; description: string | null } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: null, description: null }
  const fm = m[1]
  const grab = (key: string): string | null => {
    const line = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return line ? stripQuotes(line[1]) : null
  }
  return { name: grab('name'), description: grab('description') }
}

export function defaultSkillsDir(): string {
  return join(homedir(), '.claude', 'skills')
}

export function listInstalledSkills(skillsDir: string = defaultSkillsDir()): InstalledSkill[] {
  if (!existsSync(skillsDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }

  const skills: InstalledSkill[] = []
  for (const folder of entries) {
    const skillMd = join(skillsDir, folder, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    try {
      const fm = parseSkillFrontmatter(readFileSync(skillMd, 'utf-8'))
      skills.push({ name: fm.name || folder, description: fm.description || '' })
    } catch {
      // unreadable SKILL.md — skip this entry
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}
```

Run: `npm test -- skills/list` — PASS.

- [ ] **Step 4: Main handler + preload**

In `src/main/index.ts`, add to imports:

```ts
import { listInstalledSkills } from './skills/list'
```

Add near the marketplace handlers:

```ts
// ─── Installed skills (for the / picker) ───

let skillsListCache: { at: number; items: ReturnType<typeof listInstalledSkills> } | null = null

ipcMain.handle(IPC.SKILLS_LIST, () => {
  if (skillsListCache && Date.now() - skillsListCache.at < 30_000) {
    return skillsListCache.items
  }
  const items = listInstalledSkills()
  skillsListCache = { at: Date.now(), items }
  return items
})
```

Invalidate the cache when the marketplace changes what's installed — in the existing `MARKETPLACE_INSTALL` and `MARKETPLACE_UNINSTALL` handlers, add as the first line of each:

```ts
  skillsListCache = null
```

In `src/preload/index.ts`: add `InstalledSkill` to the type import; in `ClodAPI` after `uninstallPlugin`:

```ts
  listSkills(): Promise<InstalledSkill[]>
```

and in the `api` object:

```ts
  listSkills: () => ipcRenderer.invoke(IPC.SKILLS_LIST),
```

- [ ] **Step 5: Verify and commit**

Run: `npm test` — all pass. `npm run typecheck` — exit 0.

```bash
git add src/shared/types.ts src/main/skills/list.ts src/main/skills/list.test.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: installed-skills scanner and SKILLS_LIST IPC"
```

---

### Task 6: Skills picker in the / menu

**Files:**
- Modify: `src/renderer/components/SlashCommandMenu.tsx` (optional `items` override)
- Modify: `src/renderer/components/InputBar.tsx` (skills mode + real skill data)

**Interfaces:**
- Consumes: `window.clod.listSkills()` (Task 5), existing `SlashCommandMenu` / slash handling in `InputBar`.
- Produces: selecting `/skills` opens a filterable picker of installed skills; picking one inserts `/<skill-name> ` into the input.

- [ ] **Step 1: Let the menu render an arbitrary item list**

In `src/renderer/components/SlashCommandMenu.tsx`:

Extend `Props`:

```ts
interface Props {
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  anchorRect: DOMRect | null
  extraCommands?: SlashCommand[]
  /** When provided, render exactly these (filtered) instead of the built-in command list */
  items?: SlashCommand[]
}
```

Add an exported helper next to `getFilteredCommandsWithExtras`:

```ts
export function filterItems(filter: string, items: SlashCommand[]): SlashCommand[] {
  const q = filter.toLowerCase()
  return items.filter((c) => c.command.toLowerCase().startsWith(q))
}
```

In the component signature accept `items`, and compute:

```ts
  const filtered = items ? filterItems(filter, items) : getFilteredCommandsWithExtras(filter, extraCommands)
```

(the rest of the component is unchanged — it already renders `filtered`).

- [ ] **Step 2: InputBar — fetch real skills, add skills mode**

In `src/renderer/components/InputBar.tsx`:

Add to imports: `filterItems` from `./SlashCommandMenu`, and the shared type:

```ts
import type { InstalledSkill } from '../../shared/types'
```

Add state next to `slashFilter`:

```ts
  const [skillsMode, setSkillsMode] = useState(false)
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
```

Fetch once on mount (alongside the existing focus effects):

```ts
  useEffect(() => {
    window.clod.listSkills().then(setInstalledSkills).catch(() => {})
  }, [])
```

Replace the current `skillCommands` construction (which uses only `tab?.sessionSkills`) with a merged, memoized list:

```ts
  const skillCommands: SlashCommand[] = React.useMemo(() => {
    const byName = new Map<string, SlashCommand>()
    for (const s of installedSkills) {
      byName.set(s.name, {
        command: `/${s.name}`,
        description: s.description || `Run skill: ${s.name}`,
        icon: <span className="text-[11px]">✦</span>,
      })
    }
    for (const skill of tab?.sessionSkills || []) {
      if (!byName.has(skill)) {
        byName.set(skill, {
          command: `/${skill}`,
          description: `Run skill: ${skill}`,
          icon: <span className="text-[11px]">✦</span>,
        })
      }
    }
    return [...byName.values()]
  }, [installedSkills, tab?.sessionSkills])
```

Add a single source of truth for what the menu currently shows (used by keyboard nav, Enter, and rendering):

```ts
  const getMenuItems = useCallback((): SlashCommand[] => {
    if (skillsMode) return filterItems(slashFilter ?? '/', skillCommands)
    return getFilteredCommandsWithExtras(slashFilter ?? '', skillCommands)
  }, [skillsMode, slashFilter, skillCommands])
```

In `executeCommand`, change the `'/skills'` case to open the picker instead of printing a list:

```ts
      case '/skills': {
        // Open the skills picker: the menu switches to installed skills,
        // filter continues from what the user types after '/'
        setSkillsMode(true)
        setInput('/')
        setSlashFilter('/')
        setSlashIndex(0)
        requestAnimationFrame(() => textareaRef.current?.focus())
        break
      }
```

In `handleSlashSelect`, widen the skill detection so any known skill (installed or session) inserts rather than executes, and exit skills mode on selection:

```ts
  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    const isSkillCommand = skillCommands.some((c) => c.command === cmd.command)
    if (isSkillCommand) {
      setInput(`${cmd.command} `)
      setSlashFilter(null)
      setSkillsMode(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    setInput('')
    setSlashFilter(null)
    executeCommand(cmd)
  }, [executeCommand, skillCommands])
```

In `handleSend` and `handleKeyDown`, replace both `getFilteredCommandsWithExtras(slashFilter!, skillCommands)` calls with `getMenuItems()`. In `handleKeyDown`'s `Escape` branch, also exit skills mode:

```ts
      if (e.key === 'Escape') { e.preventDefault(); setSlashFilter(null); setSkillsMode(false); return }
```

In `updateSlashFilter`, exit skills mode when the input no longer looks like a slash query:

```ts
  const updateSlashFilter = useCallback((value: string) => {
    const match = value.match(/^(\/[a-zA-Z-]*)$/)
    if (match) {
      setSlashFilter(match[1])
      setSlashIndex(0)
    } else {
      setSlashFilter(null)
      setSkillsMode(false)
    }
  }, [])
```

Finally, pass the override to the menu — in the JSX:

```tsx
          <SlashCommandMenu
            filter={slashFilter!}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            anchorRect={wrapperRef.current?.getBoundingClientRect() ?? null}
            extraCommands={skillCommands}
            items={skillsMode ? skillCommands : undefined}
          />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm test` — all pass.

Manual: type `/` → menu lists commands plus installed skills with real descriptions; select `/skills` → the menu switches to skills only; typing filters them; Enter/Tab/click inserts `/<skill-name> ` into the input ready for arguments; Escape backs out.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SlashCommandMenu.tsx src/renderer/components/InputBar.tsx
git commit -m "feat: selectable installed-skills picker in the slash menu"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full gates**

Run: `npm run typecheck` — exit 0.
Run: `npm test` — all suites pass.
Run: `npm run build` — completes without errors.

- [ ] **Step 2: Manual checklist (dev-server restart)**

1. AskUserQuestion end-to-end: prompt Claude to ask a single-select question → card appears inline → answer → Claude's reply reflects the choice.
2. Multi-select: prompt for a multiSelect question → checkboxes + Continue → answer array reaches Claude.
3. "Other…" free text answer works.
4. Auto-approve mode ON still shows question cards (questions are not permissions).
5. Questions still work while a permission card is pending in another tab.
6. `/skills` picker: filter, select, run a skill end-to-end.
7. Overlay smoke test: hotkeys, tab switching, and permissions all behave as before.

- [ ] **Step 3: Commit any fixes discovered, then mark the phase done**

If the checklist surfaced fixes, commit them individually as `fix: <description>`.
