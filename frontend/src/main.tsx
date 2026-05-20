import './lib/i18n';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ModalProvider } from './components/ModalDialog.tsx'

// NOTE: <StrictMode> intentionally omitted. React 19's StrictMode double-
// invokes passive effects in dev to check idempotency, which breaks
// @monaco-editor/react v4.7.0 — its internal ref-based hook calls
// `editor.setModel(...)` on the disposed editor during the simulated
// re-mount, throwing "InstantiationService has been disposed" as soon as
// the user drags a cell (any reorder re-runs the passive effect). Production
// builds never double-invoke, so this only matters in dev. Revisit if/when
// the wrapper is patched upstream or we vendor a custom one.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ModalProvider>
      <App />
    </ModalProvider>
  </ErrorBoundary>,
)
