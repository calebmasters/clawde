#!/usr/bin/env node
/**
 * Spike: verify how to ANSWER an AskUserQuestion tool call in headless (-p)
 * mode, against the locally installed claude CLI, via the PreToolUse HTTP
 * hook channel and/or the stdio control-protocol channel.
 *
 * VERIFIED FACTS (empirically confirmed on this machine):
 * - Plain `-p` sessions (with or without --input-format stream-json) expose
 *   29 tools and do NOT include AskUserQuestion — it is excluded from
 *   headless mode by default. A bare control-protocol `initialize` handshake
 *   on its own does not change this (still 29 tools).
 * - Adding `--permission-prompt-tool stdio` (together with
 *   `--input-format stream-json`) puts AskUserQuestion into the tool list
 *   (32 tools). This is the flag required to make the tool callable at all
 *   in headless mode — without it there is nothing for a PreToolUse hook to
 *   ever intercept.
 * - The control protocol runs over the same stdio stream used for
 *   stream-json input/output: when the CLI needs a tool-use permission
 *   decision it writes a `{"type":"control_request",...}` line (subtype
 *   `can_use_tool`) to its stdout, and expects a
 *   `{"type":"control_response",...}` line back on its stdin.
 * - This script answers AskUserQuestion via the control protocol
 *   (behavior: "allow", updatedInput with an `answers` map keyed by
 *   question text), and separately keeps the original PreToolUse HTTP hook
 *   wired up via --settings, to observe whether the hook ALSO fires
 *   alongside (or instead of) the control protocol.
 * - CONFIRMED RESULT: with a PreToolUse hook matcher already covering
 *   AskUserQuestion, the CLI resolves the permission through that HTTP hook
 *   and never emits a `can_use_tool` control_request for it — the control
 *   protocol path was not exercised. `--permission-prompt-tool stdio`'s
 *   only observed effect here was unlocking AskUserQuestion in the tool
 *   list; the HTTP hook (allow + updatedInput) is what actually answered
 *   the question. See .superpowers/sdd/task-1-report.md for the full
 *   evidence (verbatim tool_input schema, hook response, final transcript).
 *
 * Usage:
 *   node scripts/spike-ask-question.mjs                # HTTP hook variant: allow-updated
 *   node scripts/spike-ask-question.mjs deny-reason    # HTTP hook variant: deny-reason
 *
 * (The HTTP hook variant only affects what the PreToolUse hook responds with
 * if/when it fires. The control-protocol response is always allow+updatedInput,
 * per the decision this spike is meant to make.)
 *
 * PASS = the final output contains "ANSWER=red" (the spike always answers
 * the first option, and the prompt makes the first option "red"). Reports
 * which channel(s) actually answered: http-hook, control-protocol, or both.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const variant = process.argv[2] || 'allow-updated'

let httpHookFired = false
let controlProtocolAnsweredAskUserQuestion = false

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    httpHookFired = true
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
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio',
    '--settings', settingsPath,
    '--max-turns', '4',
  ], { stdio: ['pipe', 'pipe', 'inherit'] })

  // Send the prompt as one NDJSON line on stdin. Keep stdin open afterward —
  // the control protocol needs it available for can_use_tool
  // control_requests/responses until the child exits or we see the final
  // result event.
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n')

  let out = ''
  let stdoutBuffer = ''
  let sawResult = false
  let stdinEnded = false

  const endStdinOnce = () => {
    if (stdinEnded) return
    stdinEnded = true
    try { child.stdin.end() } catch { /* already closed */ }
  }

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    out += text
    process.stdout.write(chunk)

    stdoutBuffer += text
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }

      if (parsed.type === 'control_request') {
        console.log('\n=== CONTROL REQUEST (verbatim raw line — save this) ===')
        console.log(trimmed)
        console.log('=== CONTROL REQUEST (pretty) ===')
        console.log(JSON.stringify(parsed, null, 2))

        const req = parsed.request ?? {}
        const requestId = parsed.request_id
        let decision

        if (req.subtype === 'can_use_tool') {
          const toolName = req.tool_name ?? req.name ?? req.toolName
          const input = req.input ?? req.tool_input ?? req.arguments ?? {}

          if (toolName === 'AskUserQuestion') {
            const questions = input?.questions ?? []
            const answers = {}
            for (const q of questions) answers[q.question] = q.options?.[0]?.label ?? 'red'
            const updatedInput = { ...input, answers }
            decision = { behavior: 'allow', updatedInput }
            controlProtocolAnsweredAskUserQuestion = true
          } else {
            decision = { behavior: 'deny', message: 'not permitted in spike' }
          }
        } else {
          // Unknown control_request subtype (e.g. an initialize handshake
          // sent by the CLI itself) — ack generically so the channel doesn't
          // stall waiting for a response we never send.
          decision = {}
        }

        const controlResponse = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: decision,
          },
        }
        console.log('=== CONTROL RESPONSE SENT (verbatim — save this) ===')
        console.log(JSON.stringify(controlResponse))
        child.stdin.write(JSON.stringify(controlResponse) + '\n')
      }

      if (parsed.type === 'result') {
        sawResult = true
        endStdinOnce()
      }
    }
  })

  child.on('exit', (code) => {
    server.close()
    endStdinOnce()
    const pass = /ANSWER=red/i.test(out)
    const channel = httpHookFired && controlProtocolAnsweredAskUserQuestion
      ? 'both'
      : controlProtocolAnsweredAskUserQuestion
        ? 'control-protocol'
        : httpHookFired
          ? 'http-hook'
          : 'neither'
    console.log(`\n=== SPIKE ${pass ? 'PASS' : 'FAIL'} (variant=${variant}, exit=${code}, channel=${channel}, sawResult=${sawResult}) ===`)
    process.exit(pass ? 0 : 1)
  })
})
