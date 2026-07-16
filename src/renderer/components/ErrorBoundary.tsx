import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions so a single component fault can't white-screen
 * the whole overlay. Shows a minimal fallback with a reload button.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the devtools console; main-process logs capture the rest.
    console.error('[clod] render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    // Clear the error first in case reload is intercepted; then hard-reload.
    this.setState({ error: null })
    try { window.location.reload() } catch {}
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          margin: '0 auto',
          maxWidth: 420,
          textAlign: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          color: 'var(--clod-text-primary, #e5e5e5)',
          background: 'var(--clod-popover-bg, rgba(30,30,30,0.92))',
          border: '1px solid var(--clod-popover-border, rgba(255,255,255,0.12))',
          borderRadius: 14,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 12, opacity: 0.7, wordBreak: 'break-word' }}>
          {this.state.error.message || 'The interface hit an unexpected error.'}
        </div>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 4,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            cursor: 'pointer',
            color: '#fff',
            background: 'var(--clod-accent, #6366f1)',
            border: 'none',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
