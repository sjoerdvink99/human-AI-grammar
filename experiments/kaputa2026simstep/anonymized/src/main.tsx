import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode: its double-invoked effects would duplicate model calls that human selections trigger.
createRoot(document.getElementById('root')!).render(<App />);
