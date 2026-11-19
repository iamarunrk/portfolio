import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { useStore } from './store';

// Test hook (dev builds only): lets automated checks pause the WebGL scene.
if (import.meta.env.DEV) (window as unknown as { __store?: unknown }).__store = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
