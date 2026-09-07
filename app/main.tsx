import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import NutritionApp from '../components/nutrition/NutritionApp';
import './globals.css';
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="connection-state">
        <h1>No se ha podido mostrar esta pantalla</h1>
        <p>
          Recarga para volver a tu espacio. Los registros guardados se
          conservan.
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          Volver a cargar
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NutritionApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
