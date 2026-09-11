'use client';
import React, { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <h2 style={{ marginBottom: 12 }}>Щось пішло не так</h2>
          <p style={{ marginBottom: 20, fontSize: 14 }}>Спробуйте оновити сторінку</p>
          <button className="btn btn-primary" onClick={() => this.setState({ hasError: false, error: null })}>
            Спробувати знову
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
