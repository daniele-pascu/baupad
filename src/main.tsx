import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initDeviceId } from './lib/ids';
// früh laden: merkt sich den Installationsdialog des Browsers (beforeinstallprompt)
import './lib/install';
import './styles.css';

async function start() {
  try {
    await initDeviceId();
  } catch (e) {
    console.error(e);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
