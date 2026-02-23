'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
}

/** Error boundary para capturar errores de render y mostrar fallback en lugar de pantalla en blanco. */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, retryKey: 0 };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, retryKey: 0 };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center p-6 bg-gray-50 rounded-xl border border-gray-200">
          <p className="text-gray-700 font-medium">Algo salió mal.</p>
          <p className="text-sm text-gray-500 mt-1">Recargá la página o volvé más tarde.</p>
          <button
            type="button"
            onClick={() => this.setState((s) => ({ hasError: false, retryKey: s.retryKey + 1 }))}
            className="mt-4 px-4 py-2 text-green-600 font-medium border border-green-600 rounded-lg hover:bg-green-50"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
