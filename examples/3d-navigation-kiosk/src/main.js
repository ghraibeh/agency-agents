import { KioskApp } from './KioskApp.js';

const canvas = document.getElementById('kiosk-canvas');
const app    = new KioskApp(canvas);

await app.init();
app.start();

// Expose app on window for debugging (remove in production)
if (location.hostname === 'localhost') {
  window.__kioskApp = app;
}
