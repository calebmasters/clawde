import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, HealthReport, EnrichedError, Attachment, SessionMeta, CatalogPlugin, SessionLoadMessage, Project, ProjectDefaults, Preset, PresetInput, InstalledSkill } from '../shared/types'

export interface ClodAPI {
  // ─── Request-response (renderer → main) ───
  start(): Promise<{ version: string; auth: { email?: string; subscriptionType?: string; authMethod?: string }; mcpServers: string[]; projectPath: string; homePath: string; defaultDir: string }>
  createTab(): Promise<{ tabId: string }>
  prompt(tabId: string, requestId: string, options: RunOptions): Promise<void>
  cancel(requestId: string): Promise<boolean>
  stopTab(tabId: string): Promise<boolean>
  retry(tabId: string, requestId: string, options: RunOptions): Promise<void>
  status(): Promise<HealthReport>
  tabHealth(): Promise<HealthReport>
  closeTab(tabId: string): Promise<void>
  selectDirectory(): Promise<string | null>
  openExternal(url: string): Promise<boolean>
  openInTerminal(sessionId: string | null, projectPath?: string): Promise<boolean>
  attachFiles(): Promise<Attachment[] | null>
  takeScreenshot(): Promise<Attachment | null>
  pasteImage(dataUrl: string): Promise<Attachment | null>
  transcribeAudio(audioBase64: string): Promise<{ error: string | null; transcript: string | null }>
  getDiagnostics(): Promise<any>
  respondPermission(tabId: string, questionId: string, optionId: string): Promise<boolean>
  respondQuestion(tabId: string, questionId: string, answers: Record<string, string | string[]>): Promise<boolean>
  initSession(tabId: string): void
  resetTabSession(tabId: string): void
  listSessions(projectPath?: string): Promise<SessionMeta[]>
  loadSession(sessionId: string, projectPath?: string): Promise<SessionLoadMessage[]>
  deleteSession(sessionId: string, projectPath?: string): Promise<boolean>
  listProjects(): Promise<Project[]>
  createProject(name: string, path: string): Promise<Project | null>
  updateProject(id: string, patch: { name?: string; path?: string; defaults?: ProjectDefaults; lastUsedAt?: number }): Promise<Project | null>
  deleteProject(id: string): Promise<boolean>
  listPresets(): Promise<{ presets: Preset[]; fileExisted: boolean; keybindErrors: Record<string, string>; activePresetId: string | null }>
  createPreset(input: PresetInput): Promise<Preset | null>
  updatePreset(id: string, patch: Partial<PresetInput>): Promise<Preset | null>
  deletePreset(id: string): Promise<boolean>
  setActivePreset(presetId: string | null): void
  onPresetActivated(callback: (presetId: string) => void): () => void
  fetchMarketplace(forceRefresh?: boolean): Promise<{ plugins: CatalogPlugin[]; error: string | null }>
  listInstalledPlugins(): Promise<string[]>
  installPlugin(repo: string, pluginName: string, marketplace: string, sourcePath?: string, isSkillMd?: boolean): Promise<{ ok: boolean; error?: string }>
  uninstallPlugin(pluginName: string): Promise<{ ok: boolean; error?: string }>
  listSkills(): Promise<InstalledSkill[]>
  setPermissionMode(mode: string): void
  setHotkey(mode: 'double-option' | 'double-command' | 'accelerator', accelerator: string): void
  setTerminal(id: string): void
  listTerminals(): Promise<Array<{ id: string; name: string }>>
  copyToClipboard(text: string): void
  setOpenAtLogin(enabled: boolean): void
  checkAccessibility(): Promise<boolean>
  openAccessibilitySettings(): Promise<boolean>
  getTheme(): Promise<{ isDark: boolean }>
  onThemeChange(callback: (isDark: boolean) => void): () => void

  // ─── Window management ───
  resizeHeight(height: number): void
  setWindowWidth(width: number): void
  animateHeight(from: number, to: number, durationMs: number): Promise<void>
  hideWindow(): void
  isVisible(): Promise<boolean>
  /** OS-level click-through for transparent window regions */
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void
  /** Manual window drag for frameless windows */
  startWindowDrag(deltaX: number, deltaY: number): void
  /** Reset overlay to its default position */
  resetWindowPosition(): void
  /** Set the overlay's horizontal anchor: 'center' or 'right' */
  setWindowPosition(pos: 'center' | 'right'): void

  // ─── Event listeners (main → renderer) ───
  onEvent(callback: (tabId: string, event: NormalizedEvent) => void): () => void
  onTabStatusChange(callback: (tabId: string, newStatus: string, oldStatus: string) => void): () => void
  onError(callback: (tabId: string, error: EnrichedError) => void): () => void
  onSkillStatus(callback: (status: { name: string; state: string; error?: string; reason?: string }) => void): () => void
  onWindowShown(callback: () => void): () => void
}

const api: ClodAPI = {
  // ─── Request-response ───
  start: () => ipcRenderer.invoke(IPC.START),
  createTab: () => ipcRenderer.invoke(IPC.CREATE_TAB),
  prompt: (tabId, requestId, options) => ipcRenderer.invoke(IPC.PROMPT, { tabId, requestId, options }),
  cancel: (requestId) => ipcRenderer.invoke(IPC.CANCEL, requestId),
  stopTab: (tabId) => ipcRenderer.invoke(IPC.STOP_TAB, tabId),
  retry: (tabId, requestId, options) => ipcRenderer.invoke(IPC.RETRY, { tabId, requestId, options }),
  status: () => ipcRenderer.invoke(IPC.STATUS),
  tabHealth: () => ipcRenderer.invoke(IPC.TAB_HEALTH),
  closeTab: (tabId) => ipcRenderer.invoke(IPC.CLOSE_TAB, tabId),
  selectDirectory: () => ipcRenderer.invoke(IPC.SELECT_DIRECTORY),
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  openInTerminal: (sessionId, projectPath) => ipcRenderer.invoke(IPC.OPEN_IN_TERMINAL, { sessionId, projectPath }),
  attachFiles: () => ipcRenderer.invoke(IPC.ATTACH_FILES),
  takeScreenshot: () => ipcRenderer.invoke(IPC.TAKE_SCREENSHOT),
  pasteImage: (dataUrl) => ipcRenderer.invoke(IPC.PASTE_IMAGE, dataUrl),
  transcribeAudio: (audioBase64) => ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, audioBase64),
  getDiagnostics: () => ipcRenderer.invoke(IPC.GET_DIAGNOSTICS),
  respondPermission: (tabId, questionId, optionId) =>
    ipcRenderer.invoke(IPC.RESPOND_PERMISSION, { tabId, questionId, optionId }),
  respondQuestion: (tabId, questionId, answers) =>
    ipcRenderer.invoke(IPC.RESPOND_QUESTION, { tabId, questionId, answers }),
  initSession: (tabId) => ipcRenderer.send(IPC.INIT_SESSION, tabId),
  resetTabSession: (tabId) => ipcRenderer.send(IPC.RESET_TAB_SESSION, tabId),
  listSessions: (projectPath?: string) => ipcRenderer.invoke(IPC.LIST_SESSIONS, projectPath),
  loadSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke(IPC.LOAD_SESSION, { sessionId, projectPath }),
  deleteSession: (sessionId: string, projectPath?: string) => ipcRenderer.invoke(IPC.DELETE_SESSION, { sessionId, projectPath }),
  listProjects: () => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  createProject: (name, path) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, { name, path }),
  updateProject: (id, patch) => ipcRenderer.invoke(IPC.PROJECTS_UPDATE, { id, patch }),
  deleteProject: (id) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, { id }),
  listPresets: () => ipcRenderer.invoke(IPC.PRESETS_LIST),
  createPreset: (input) => ipcRenderer.invoke(IPC.PRESETS_CREATE, { input }),
  updatePreset: (id, patch) => ipcRenderer.invoke(IPC.PRESETS_UPDATE, { id, patch }),
  deletePreset: (id) => ipcRenderer.invoke(IPC.PRESETS_DELETE, { id }),
  setActivePreset: (presetId) => ipcRenderer.send(IPC.SET_ACTIVE_PRESET, presetId),
  onPresetActivated: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, presetId: string) => callback(presetId)
    ipcRenderer.on(IPC.PRESET_ACTIVATED, handler)
    return () => ipcRenderer.removeListener(IPC.PRESET_ACTIVATED, handler)
  },
  fetchMarketplace: (forceRefresh) => ipcRenderer.invoke(IPC.MARKETPLACE_FETCH, { forceRefresh }),
  listInstalledPlugins: () => ipcRenderer.invoke(IPC.MARKETPLACE_INSTALLED),
  installPlugin: (repo, pluginName, marketplace, sourcePath, isSkillMd) =>
    ipcRenderer.invoke(IPC.MARKETPLACE_INSTALL, { repo, pluginName, marketplace, sourcePath, isSkillMd }),
  uninstallPlugin: (pluginName) =>
    ipcRenderer.invoke(IPC.MARKETPLACE_UNINSTALL, { pluginName }),
  listSkills: () => ipcRenderer.invoke(IPC.SKILLS_LIST),
  setPermissionMode: (mode) => ipcRenderer.send(IPC.SET_PERMISSION_MODE, mode),
  setHotkey: (mode, accelerator) => ipcRenderer.send(IPC.SET_HOTKEY, mode, accelerator),
  setTerminal: (id) => ipcRenderer.send(IPC.SET_TERMINAL, id),
  listTerminals: () => ipcRenderer.invoke(IPC.LIST_TERMINALS),
  copyToClipboard: (text) => ipcRenderer.send(IPC.COPY_TO_CLIPBOARD, text),
  setOpenAtLogin: (enabled) => ipcRenderer.send(IPC.SET_OPEN_AT_LOGIN, enabled),
  checkAccessibility: () => ipcRenderer.invoke(IPC.CHECK_ACCESSIBILITY),
  openAccessibilitySettings: () => ipcRenderer.invoke(IPC.OPEN_ACCESSIBILITY_SETTINGS),
  getTheme: () => ipcRenderer.invoke(IPC.GET_THEME),
  onThemeChange: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark)
    ipcRenderer.on(IPC.THEME_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.THEME_CHANGED, handler)
  },

  // ─── Window management ───
  resizeHeight: (height) => ipcRenderer.send(IPC.RESIZE_HEIGHT, height),
  animateHeight: (from, to, durationMs) =>
    ipcRenderer.invoke(IPC.ANIMATE_HEIGHT, { from, to, durationMs }),
  hideWindow: () => ipcRenderer.send(IPC.HIDE_WINDOW),
  isVisible: () => ipcRenderer.invoke(IPC.IS_VISIBLE),
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send(IPC.SET_IGNORE_MOUSE_EVENTS, ignore, options || {}),
  startWindowDrag: (deltaX, deltaY) =>
    ipcRenderer.send(IPC.START_WINDOW_DRAG, deltaX, deltaY),
  resetWindowPosition: () => ipcRenderer.send(IPC.RESET_WINDOW_POSITION),
  setWindowPosition: (pos) => ipcRenderer.send(IPC.SET_WINDOW_POSITION, pos),
  setWindowWidth: (width) => ipcRenderer.send(IPC.SET_WINDOW_WIDTH, width),

  // ─── Event listeners ───
  onEvent: (callback) => {
    const channels = [
      IPC.TEXT_CHUNK, IPC.TOOL_CALL, IPC.TOOL_CALL_UPDATE,
      IPC.TOOL_CALL_COMPLETE, IPC.TASK_UPDATE, IPC.TASK_COMPLETE,
      IPC.SESSION_DEAD, IPC.SESSION_INIT, IPC.ERROR, IPC.RATE_LIMIT,
    ]
    // Single unified handler — all normalized events come through one channel
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, event: NormalizedEvent) => callback(tabId, event)
    ipcRenderer.on('clod:normalized-event', handler)
    return () => ipcRenderer.removeListener('clod:normalized-event', handler)
  },

  onTabStatusChange: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, newStatus: string, oldStatus: string) =>
      callback(tabId, newStatus, oldStatus)
    ipcRenderer.on('clod:tab-status-change', handler)
    return () => ipcRenderer.removeListener('clod:tab-status-change', handler)
  },

  onError: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, error: EnrichedError) =>
      callback(tabId, error)
    ipcRenderer.on('clod:enriched-error', handler)
    return () => ipcRenderer.removeListener('clod:enriched-error', handler)
  },

  onSkillStatus: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, status: any) => callback(status)
    ipcRenderer.on(IPC.SKILL_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.SKILL_STATUS, handler)
  },

  onWindowShown: (callback) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.WINDOW_SHOWN, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_SHOWN, handler)
  },
}

contextBridge.exposeInMainWorld('clod', api)
