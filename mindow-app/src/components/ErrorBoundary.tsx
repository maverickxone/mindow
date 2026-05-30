import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the tree and shows a recoverable
 * fallback instead of unmounting to a blank window. Kept dependency-free
 * (no i18n/store) so it still renders if those subsystems are the failure.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-primary text-text-primary p-6 text-center">
        <div className="text-sm font-semibold">应用出现错误 / Something went wrong</div>
        <pre className="max-w-md max-h-40 overflow-auto text-[11px] text-text-secondary bg-tertiary rounded p-3 whitespace-pre-wrap break-words">
          {this.state.error?.message ?? "Unknown error"}
        </pre>
        <button
          onClick={this.handleReset}
          className="px-4 py-1.5 rounded text-xs font-medium bg-accent-info/15 text-accent-info border border-accent-info/40 hover:bg-accent-info/25 transition-colors"
        >
          重试 / Retry
        </button>
      </div>
    );
  }
}
