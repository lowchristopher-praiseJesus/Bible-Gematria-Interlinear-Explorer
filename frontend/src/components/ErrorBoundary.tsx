import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm">
          <div className="font-semibold text-[var(--color-text-primary)]">Something went wrong</div>
          <div className="mt-1 text-[var(--color-text-secondary)]">{this.state.error.message}</div>
        </div>
      )
    }
    return this.props.children
  }
}
