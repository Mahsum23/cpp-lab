import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './lib/app.svelte';

// Kick off IndexedDB + the manifest check before the first paint lands.
void app.init();

// The install prompt only fires on Android/desktop Chrome; iOS installs via the
// Share sheet, which is why Settings explains it in words as well.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (globalThis as { __installPrompt?: Event }).__installPrompt = e;
  app.installable = true;
});

export default mount(App, { target: document.getElementById('app')! });
