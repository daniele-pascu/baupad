import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initDeviceId } from './lib/ids';
// früh laden: merkt sich den Installationsdialog des Browsers (beforeinstallprompt)
import './lib/install';
import './styles.css';
import './design.css';

// Vorschau des neuen Designs: „?design=neu“ schaltet ein, „?design=alt“ aus (auf dem Gerät gemerkt)
try {
  const d = new URLSearchParams(location.search).get('design');
  if (d) localStorage.setItem('baupad:design', d);
  if (localStorage.getItem('baupad:design') === 'neu') document.documentElement.dataset.design = 'neu';
} catch {
  /* ohne Speicher: altes Design */
}

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
