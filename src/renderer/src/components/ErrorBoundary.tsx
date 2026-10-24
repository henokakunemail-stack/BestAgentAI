import React from 'react'

interface State { error: Error | null }

/** A render throw used to blank the whole window; show the error and a reload instead. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div data-testid="error-boundary" className="h-full w-full flex flex-col items-center justify-center gap-3 p-8 text-center bg-zinc-950 text-zinc-200">
        <div className="text-sm font-semibold">Something went wrong in the UI.</div>
        <pre className="max-w-xl max-h-40 overflow-auto text-xs text-red-400 whitespace-pre-wrap select-text">{this.state.error.message}</pre>
        <div className="text-xs text-zinc-500">Your sessions are saved on disk. Reload to continue.</div>
        <button onClick={() => location.reload()} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-xs">
          Reload
        </button>
      </div>
    )
  }
}
