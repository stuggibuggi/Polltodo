import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="min-h-[40vh] flex flex-col items-center justify-center p-8 text-[var(--color-foreground)]">
            <p className="font-medium">Etwas ist schiefgelaufen.</p>
            {this.state.error && (
              <pre className="mt-2 max-w-full overflow-auto rounded bg-[var(--color-muted-bg)] p-4 text-xs text-[var(--color-required)]">
                {this.state.error.message}
              </pre>
            )}
          </div>
        )
      )
    }
    return this.props.children
  }
}
