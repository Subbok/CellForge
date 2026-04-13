import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render-phase errors anywhere below it so a single throw doesn't
 * blank the whole app. Shows a readable fallback with the error, a stack
 * trace (collapsible), and a "reload" button.
 *
 * Must be a class component — React has no hook equivalent for
 * componentDidCatch yet.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // log it loud — devtools will surface this even though we're catching
    console.error('[ErrorBoundary] caught render error:', error);
    console.error('[ErrorBoundary] component stack:', info.componentStack);
    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="modal-panel max-w-2xl w-full p-8">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-2 rounded-lg bg-error/10 text-error shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-text">Something broke</h1>
              <p className="text-sm text-text-muted mt-1">
                CellForge hit an unexpected error while rendering. Your notebook
                isn't lost — it's still saved on disk. Try reloading the page;
                if the same error comes back, copy the details below into a
                GitHub issue.
              </p>
            </div>
          </div>

          <div className="bg-bg-elevated border border-border rounded-lg p-3 mb-4 font-mono text-xs">
            <div className="text-error font-semibold mb-1">{error.name}: {error.message}</div>
            {error.stack && (
              <details className="mt-2">
                <summary className="cursor-pointer text-text-muted hover:text-text-secondary select-none">
                  Stack trace
                </summary>
                <pre className="mt-2 text-text-muted whitespace-pre-wrap break-all">
                  {error.stack}
                </pre>
              </details>
            )}
            {info?.componentStack && (
              <details className="mt-2">
                <summary className="cursor-pointer text-text-muted hover:text-text-secondary select-none">
                  Component tree
                </summary>
                <pre className="mt-2 text-text-muted whitespace-pre-wrap break-all">
                  {info.componentStack}
                </pre>
              </details>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={this.reload} className="btn btn-md btn-primary">
              <RotateCcw size={14} /> Reload page
            </button>
            <button onClick={this.reset} className="btn btn-md btn-ghost">
              Try to recover
            </button>
          </div>
        </div>
      </div>
    );
  }
}
