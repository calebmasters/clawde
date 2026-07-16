// Ambient declarations for non-code asset imports handled by the bundler.
// Kept in a dedicated file with no top-level imports so the wildcard module
// declarations register globally (a file with imports becomes a module and the
// ambient wildcard may not be picked up).

declare module '*.mp3' {
  const src: string
  export default src
}
