import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Jarvis UI Error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '32px',
            color: '#00e5ff',
            background: '#060e14',
            height: '100vh',
            fontFamily: 'monospace',
          }}
        >
          <h2>JARVIS 2.0 — Récupération d’erreur</h2>
          <pre style={{ color: '#ff8a70', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            style={{
              marginTop: '16px',
              padding: '10px 18px',
              background: '#00e5ff',
              color: '#02101e',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Réinitialiser et relancer Jarvis 2.0
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}
