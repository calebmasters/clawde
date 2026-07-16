# Clod

A floating command bar for [Claude Code](https://docs.claude.com/en/docs/claude-code) on macOS. Summon it from anywhere with a keystroke, type what you want, and Claude Code runs in the background — streaming replies, tool approvals, image attachments, and session history in a compact overlay that stays out of your way.

## Features

- **Summon from anywhere** — double-tap **Option** (or **⌘⇧K**) to show or hide the overlay over any app. The shortcut is configurable.
- **Runs the real `claude` CLI** — your prompts are executed by Claude Code in the background, and responses stream in live.
- **Model switching** — choose between Opus 4.8, Sonnet 5, and Haiku 4.5 per session.
- **Permission modes** — *Ask* shows a card to approve each tool call, or *Auto* runs tools without prompting.
- **Attachments** — attach files, paste images, or capture a screenshot with region select. Images are embedded inline, so Claude sees them directly.
- **Rich rendering** — Markdown and math, syntax-highlighted code with per-block copy, and one-click copy of the entire conversation.
- **Session history** — recent sessions are saved and auto-pruned after a few days; reopen or delete them from the history picker.
- **Tailorable UI** — wide or narrow layout, center or right screen anchor, an optional animated input glow, and a configurable default working folder.
- **Launch at login** and a menu-bar tray icon.

## Requirements

- **macOS**
- **Node.js 18+**
- **[Claude Code CLI](https://docs.claude.com/en/docs/claude-code) 2.1+**, installed and logged in (`claude` available on your `PATH`)
- **Xcode Command Line Tools** — `xcode-select --install`
- **Accessibility permission** — required for the double-tap Option hotkey. macOS prompts on first launch; grant it under **System Settings → Privacy & Security → Accessibility**.

## Install (one-click)

```bash
git clone https://github.com/misha-park/clod.git
cd clod
```

Open the `clod` folder in Finder and double-click **`install-app.command`**. It installs dependencies, builds the app, and copies **Clod.app** to `/Applications`.

> On first launch, macOS may block the unsigned app. Open **System Settings → Privacy & Security** and choose **Open Anyway** — you only need to do this once.

Then launch **Clod** from your Applications folder or Spotlight.

## Run from source (development)

```bash
git clone https://github.com/misha-park/clod.git
cd clod
npm install
npm run dev        # or: open ./dev.command
```

Renderer changes hot-reload; main-process changes restart the app automatically.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Live-reload development build |
| `npm run build` | Production build |
| `npm run dist` | Build and package the macOS app |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm test` | Run the unit tests |
| `npm run doctor` | Check your environment |

## Usage

1. Press **double-tap Option** (or **⌘⇧K**) to open the overlay.
2. Pick a working folder — it defaults to a scratch folder in your Documents.
3. Type a prompt and hit **Enter**. Claude Code runs and streams its reply.
4. Approve tool calls when prompted (in *Ask* mode), attach files or screenshots, switch models, or browse past sessions from the top bar.

## Tech stack

Electron · electron-vite · React · TypeScript · zustand