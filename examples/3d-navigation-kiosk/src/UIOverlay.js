import { KioskState } from './constants.js';

const STATUS_LABELS = {
  [KioskState.IDLE]:     'Touch screen to begin',
  [KioskState.LOCATING]: 'Finding your location…',
  [KioskState.BROWSING]: 'Tap a destination to navigate',
  [KioskState.ROUTING]:  'Route found — follow the path',
  [KioskState.FOCUSED]:  'Destination details',
};

/**
 * DOM overlay: search bar, floor selector, info panel, attract screen.
 *
 * Emits events via on(event, cb):
 *   startRoute(originId, destId)
 *   selectFloor(floorIndex)
 *   destSelected(destNode)
 */
export class UIOverlay {
  constructor(app) {
    this._app  = app;
    this._cbs  = {};
    this._dest = null;  // currently selected destination

    this._injectCSS(); // inject any runtime CSS not in kiosk.css
    this._buildDOM();
    this._bind();
  }

  // ── Public ────────────────────────────────────────────────────────────────

  on(event, cb) { (this._cbs[event] ??= []).push(cb); return this; }

  onStateChange(prev, next) {
    document.getElementById('kiosk-status').textContent = STATUS_LABELS[next] ?? '';

    const attract = document.getElementById('attract-screen');
    attract?.classList.toggle('hidden', next !== KioskState.IDLE);

    if (next === KioskState.IDLE) this._clearSearch();
  }

  /** Show/update the info panel for a tapped POI */
  showPOIInfo(obj) {
    const { poiId, label, floor } = obj.userData;
    this._dest = { id: poiId, label, floor };
    document.getElementById('info-name').textContent  = label;
    document.getElementById('info-floor').textContent = `Floor ${floor}`;
    document.getElementById('info-panel').classList.remove('hidden');
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'kiosk-overlay';
    root.innerHTML = `
      <header class="kiosk-header">
        <div class="kiosk-logo">NAV<span>3D</span></div>
        <div class="kiosk-status" id="kiosk-status">Touch screen to begin</div>
        <div class="kiosk-mode"  id="kiosk-mode">positioning: sim</div>
      </header>

      <section class="search-wrap">
        <label class="sr-only" for="dest-input">Search destination</label>
        <div class="search-field">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="dest-input" type="search" autocomplete="off"
                 placeholder="Where do you want to go?" />
          <button id="search-clear" aria-label="Clear search">✕</button>
        </div>
        <ul id="search-results" class="search-results hidden" role="listbox"></ul>
      </section>

      <nav class="floor-nav" id="floor-nav" aria-label="Floor selector">
        <button class="fl-btn active" data-floor="0">G</button>
        <button class="fl-btn"        data-floor="1">1</button>
        <button class="fl-btn"        data-floor="2">2</button>
        <button class="fl-btn"        data-floor="3">3</button>
      </nav>

      <aside class="info-panel hidden" id="info-panel">
        <p class="info-name"  id="info-name"></p>
        <p class="info-floor" id="info-floor"></p>
        <button class="route-btn" id="route-btn">Get Directions ▶</button>
        <button class="close-btn" id="info-close" aria-label="Close">✕</button>
      </aside>

      <div class="attract-screen" id="attract-screen">
        <div class="attract-ring"></div>
        <p class="attract-title">Touch to Explore</p>
        <p class="attract-sub">3D Indoor Navigation</p>
      </div>

      <!-- User position indicator (small dot) -->
      <div class="position-dot" id="position-dot" aria-hidden="true"></div>
    `;
    document.body.appendChild(root);
  }

  _bind() {
    // Search input
    const input   = document.getElementById('dest-input');
    const results = document.getElementById('search-results');

    input.addEventListener('input',  () => this._onInput(input.value));
    input.addEventListener('focus',  () => { if (input.value.length >= 2) results.classList.remove('hidden'); });
    input.addEventListener('blur',   () => setTimeout(() => results.classList.add('hidden'), 150));

    document.getElementById('search-clear').addEventListener('click', () => this._clearSearch());

    // Floor nav
    document.getElementById('floor-nav').addEventListener('click', e => {
      const btn = e.target.closest('.fl-btn');
      if (!btn) return;
      document.querySelectorAll('.fl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._emit('selectFloor', parseInt(btn.dataset.floor));
    });

    // Info panel
    document.getElementById('route-btn').addEventListener('click', () => {
      if (!this._dest) return;
      const origin = this._resolveOrigin();
      this._emit('startRoute', origin, this._dest.id);
    });
    document.getElementById('info-close').addEventListener('click', () => {
      document.getElementById('info-panel').classList.add('hidden');
    });

    // Attract screen
    document.getElementById('attract-screen').addEventListener('pointerdown', () => {
      this._app.setState(KioskState.BROWSING);
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────

  _onInput(query) {
    const results = document.getElementById('search-results');
    if (query.length < 2) { results.classList.add('hidden'); return; }

    const dests  = this._app.navigation.getDestinations();
    const q      = query.toLowerCase();
    const matches = dests.filter(d => d.label.toLowerCase().includes(q)).slice(0, 7);

    results.innerHTML = matches.length
      ? matches.map(d => `
          <li class="result-item" role="option" data-id="${d.id}" data-floor="${d.floor}">
            <span class="res-label">${d.label}</span>
            <span class="res-floor">Floor ${d.floor}</span>
          </li>`).join('')
      : '<li class="no-result">No results</li>';

    results.classList.remove('hidden');

    results.querySelectorAll('.result-item').forEach(li => {
      li.addEventListener('mousedown', () => {
        const dest = { id: li.dataset.id, floor: parseInt(li.dataset.floor), label: li.querySelector('.res-label').textContent };
        this._selectDest(dest);
      });
    });
  }

  _selectDest(dest) {
    this._dest = dest;
    document.getElementById('dest-input').value    = dest.label;
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('info-name').textContent  = dest.label;
    document.getElementById('info-floor').textContent = `Floor ${dest.floor}`;
    document.getElementById('info-panel').classList.remove('hidden');
    this._emit('destSelected', dest);
  }

  _clearSearch() {
    document.getElementById('dest-input').value = '';
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('info-panel').classList.add('hidden');
    this._dest = null;
  }

  _resolveOrigin() {
    const pos = this._app.positioning?.currentPosition;
    if (!pos) return 'entrance';
    return this._app.navigation.nearestNode(
      { x: pos.x, y: 0, z: pos.z }
    )?.id ?? 'entrance';
  }

  _injectCSS() { /* styles live in kiosk.css; nothing to inject at runtime */ }

  _emit(event, data) { this._cbs[event]?.forEach(cb => cb(data)); }
}
