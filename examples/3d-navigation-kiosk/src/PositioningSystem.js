import { DEMO_BEACONS } from './constants.js';

/**
 * Indoor Positioning System
 *
 * Supports four positioning modes, selected by availability:
 *   1. vps  – Visual Positioning System via camera + cloud (highest accuracy ~0.3 m)
 *   2. ble  – BLE beacon trilateration (1–3 m accuracy)
 *   3. wifi – WiFi fingerprinting via backend API (3–8 m accuracy)
 *   4. sim  – Simulation for demo / offline use
 *
 * Integration points for each mode are documented inline.
 */
export class PositioningSystem {
  constructor() {
    this._mode    = 'sim';
    this._pos     = { x: 0, z: 0, floor: 0, confidence: 0 };
    this._cbs     = {};    // event → [callbacks]
    this._timer   = null;
    this._stream  = null;  // MediaStream (VPS)
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(preferredMode = 'auto') {
    const mode = preferredMode === 'auto'
      ? await this._detectBestMode()
      : preferredMode;

    this._mode = mode;

    switch (mode) {
      case 'vps':  await this._initVPS();  break;
      case 'ble':  await this._initBLE();  break;
      case 'wifi': this._initWiFi();       break;
      default:     this._startSim();       break;
    }
  }

  get currentPosition() { return { ...this._pos }; }
  get mode()            { return this._mode;        }

  on(event, cb) {
    (this._cbs[event] ??= []).push(cb);
    return this; // chainable
  }

  destroy() {
    clearTimeout(this._timer);
    clearInterval(this._timer);
    this._stream?.getTracks().forEach(t => t.stop());
  }

  // ── BLE Beacon Trilateration ──────────────────────────────────────────────
  //
  // Requires: Web Bluetooth (Chrome 79+, HTTPS, user gesture).
  // In production scan all beacons in range, compute RSSI → distance,
  // then solve the trilateration system for (x, z) on the correct floor.
  //
  // RSSI → distance (log-distance path loss model):
  //   d = 10 ^ ((TxPower - RSSI) / (10 * n))
  //   where TxPower ≈ RSSI at 1 m, n ≈ 2–4 indoors.
  //
  // Floor selection: each beacon belongs to one floor. The floor whose
  // aggregate signal is strongest is selected.

  async _initBLE() {
    if (!navigator.bluetooth) { this._fallbackToSim('BLE'); return; }

    try {
      await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service'],
      });
      // production: use navigator.bluetooth.requestLEScan() (Chrome 79+)
      // to continuously read RSSI from all beacons and trilaterate.
      this._startSim(); // placeholder while real scanning not set up
    } catch {
      this._fallbackToSim('BLE');
    }
  }

  // ── WiFi Fingerprinting ───────────────────────────────────────────────────
  //
  // JS cannot read WiFi RSSI directly in browsers; this requires a native
  // wrapper (Electron, Capacitor, React Native) or a local agent that exposes
  // a REST endpoint.
  //
  // Expected backend contract:
  //   GET /api/positioning/wifi
  //   Response: { x, z, floor, confidence }   (0–1)
  //
  // Backend implementation options:
  //   • Python indoorGML / scikit-learn fingerprint classifier
  //   • Microsoft Azure Indoor Maps
  //   • Cisco DNA Spaces, Aruba ClearPass

  _initWiFi() {
    const poll = async () => {
      try {
        const r = await fetch('/api/positioning/wifi');
        if (r.ok) {
          const { x, z, floor, confidence } = await r.json();
          this._push(x, z, floor, confidence);
        }
      } catch { /* silently degrade */ }
      this._timer = setTimeout(poll, 2000);
    };
    poll();
  }

  // ── VPS – Visual Positioning System ──────────────────────────────────────
  //
  // VPS matches a camera frame against a pre-scanned 3D map of the building
  // to return a 6-DoF pose (position + rotation) with centimetre accuracy.
  //
  // Recommended SDK: Immersal (immersal.com) — REST API, WASM client.
  //   POST https://api.immersal.com/localize
  //   Body: { token, mapIds, image_base64 }
  //   Response: { success, r[9] (3×3 rotation), t[3] (translation) }
  //
  // Coordinate mapping:
  //   VPS world origin → building origin via a calibration matrix
  //   recorded once during site survey (set self._vpsCalibMatrix).

  async _initVPS() {
    if (!navigator.mediaDevices?.getUserMedia) { this._fallbackToSim('VPS'); return; }

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      });
      this._startVPSLoop();
    } catch {
      this._fallbackToSim('VPS');
    }
  }

  _startVPSLoop() {
    const video  = document.createElement('video');
    video.srcObject = this._stream;
    video.play();

    const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
    const ctx    = canvas.getContext('2d');

    const tick = async () => {
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.72));

      try {
        const form = new FormData();
        form.append('image', blob);
        form.append('mapId', window.VPS_MAP_ID ?? 'building-demo');

        // Replace with actual VPS endpoint + token
        const resp = await fetch(window.VPS_ENDPOINT ?? '/api/positioning/vps', {
          method: 'POST',
          headers: window.VPS_TOKEN ? { Authorization: `Bearer ${window.VPS_TOKEN}` } : {},
          body: form,
        });

        if (resp.ok) {
          const { success, r: rot, t: trans } = await resp.json();
          if (success) {
            // Apply calibration transform (identity in demo)
            const x    = trans[0];
            const z    = trans[2];
            const flr  = Math.max(0, Math.round(trans[1] / (4 + 0.3)));
            this._push(x, z, flr, 0.92);
          }
        }
      } catch { /* VPS call failed, keep last known position */ }

      this._timer = setTimeout(tick, 1500); // ~0.7 fps (compute-heavy)
    };

    tick();
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  _startSim() {
    this._mode = 'sim';

    // Simulated visitor walking through the demo building
    const route = [
      { x:  0,   z:  7,  floor: 0 },
      { x: -2,   z:  4,  floor: 0 },
      { x:  0,   z: -6,  floor: 0 },
      { x:  0,   z: -6,  floor: 1 }, // elevator
      { x:  0,   z:  3,  floor: 1 },
      { x: -6,   z: -2,  floor: 1 },
      { x:  0,   z: -6,  floor: 1 },
      { x:  0,   z: -6,  floor: 2 }, // elevator
      { x:  5,   z: -1,  floor: 2 },
    ];

    let i = 0;
    const step = () => {
      const { x, z, floor } = route[i % route.length];
      this._push(x, z, floor, 1.0);
      i++;
      this._timer = setTimeout(step, 3500);
    };
    step();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _detectBestMode() {
    if (typeof navigator.bluetooth !== 'undefined') return 'ble';
    return 'sim';
  }

  _fallbackToSim(label) {
    console.warn(`[PositioningSystem] ${label} unavailable — using simulation`);
    this._startSim();
  }

  _push(x, z, floor, confidence) {
    this._pos = { x, z, floor, confidence };
    this._emit('positionUpdate', this._pos);
  }

  _emit(event, data) {
    this._cbs[event]?.forEach(cb => cb(data));
  }
}
