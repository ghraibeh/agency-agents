import * as THREE from 'three';

/**
 * Touch + mouse input manager.
 *
 * Emits named events via on(event, cb):
 *   selectPOI(object)       – tap/click on a POI marker
 *   floorSelect(floorIndex) – tap on a floor slab
 *   accordionSpread(delta)  – two-finger vertical pinch
 *   longPress(object)       – 600 ms hold on a POI
 *   proximity(normalized)   – 0–1 hover distance from screen centre
 *   swipe({ angle, speed }) – fast directional drag
 */
export class GestureController {
  constructor(canvas, camera, scene) {
    this._canvas    = canvas;
    this._camera    = camera;
    this._scene     = scene;
    this._ray       = new THREE.Raycaster();
    this._ptr       = new THREE.Vector2();
    this._touches   = new Map();
    this._lpTimer   = null;
    this._pinchDist = null;
    this._cbs       = {};

    this._bindAll();
  }

  on(event, cb) { (this._cbs[event] ??= []).push(cb); return this; }

  // ── Private: event binding ─────────────────────────────────────────────────

  _bindAll() {
    const c = this._canvas;
    c.addEventListener('touchstart',   e => this._touchStart(e),  { passive: false });
    c.addEventListener('touchmove',    e => this._touchMove(e),   { passive: false });
    c.addEventListener('touchend',     e => this._touchEnd(e),    { passive: false });
    c.addEventListener('click',        e => this._click(e));
    c.addEventListener('mousemove',    e => this._mouseMove(e));
    c.addEventListener('contextmenu',  e => { e.preventDefault(); this._rightClick(e); });
  }

  // ── Touch ──────────────────────────────────────────────────────────────────

  _touchStart(e) {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => {
      this._touches.set(t.identifier, { x: t.clientX, y: t.clientY, t: Date.now() });
    });

    if (e.touches.length === 1) {
      this._lpTimer = setTimeout(() => {
        const t = e.touches[0];
        const hit = this._cast(t.clientX, t.clientY);
        if (hit) this._emit('longPress', hit);
      }, 600);
    }
  }

  _touchMove(e) {
    e.preventDefault();
    clearTimeout(this._lpTimer);

    if (e.touches.length === 2) {
      const [t0, t1] = e.touches;
      const dx   = t0.clientX - t1.clientX;
      const dy   = t0.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      const prev = this._pinchDist ?? dist;
      this._pinchDist = dist;

      // Vertical two-finger spread → accordion gesture
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dist - prev) > 3) {
        this._emit('accordionSpread', dist - prev);
      }
    }
  }

  _touchEnd(e) {
    e.preventDefault();
    clearTimeout(this._lpTimer);

    Array.from(e.changedTouches).forEach(t => {
      const start = this._touches.get(t.identifier);
      if (!start) return;
      this._touches.delete(t.identifier);

      const dx   = t.clientX - start.x;
      const dy   = t.clientY - start.y;
      const dt   = Date.now() - start.t;
      const dist = Math.hypot(dx, dy);

      // Tap
      if (dist < 12 && dt < 320) {
        const hit = this._cast(t.clientX, t.clientY);
        if (hit) this._dispatchHit(hit);
      }

      // Swipe
      if (dist > 55 && dt < 480) {
        this._emit('swipe', {
          angle: Math.atan2(dy, dx) * 180 / Math.PI,
          speed: dist / dt,
        });
      }
    });

    if (e.touches.length < 2) this._pinchDist = null;
  }

  // ── Mouse fallback ────────────────────────────────────────────────────────

  _click(e) {
    const hit = this._cast(e.clientX, e.clientY);
    if (hit) this._dispatchHit(hit);
  }

  _rightClick(e) {
    const hit = this._cast(e.clientX, e.clientY, true);
    if (hit?.userData?.floorIndex !== undefined) {
      this._emit('floorSelect', hit.userData.floorIndex);
    }
  }

  _mouseMove(e) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    const d  = Math.hypot(e.clientX - cx, e.clientY - cy);
    const r  = Math.min(window.innerWidth * 0.4, window.innerHeight * 0.4);
    this._emit('proximity', Math.max(0, 1 - d / r));
  }

  // ── Raycasting ────────────────────────────────────────────────────────────

  _cast(clientX, clientY, slabOnly = false) {
    const rect = this._canvas.getBoundingClientRect();
    this._ptr.set(
      ((clientX - rect.left)  / rect.width)  * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ptr, this._camera);

    const targets = [];
    this._scene.traverse(obj => {
      if (!obj.isMesh) return;
      if (slabOnly) {
        if (obj.name.startsWith('floor-slab')) targets.push(obj);
      } else {
        targets.push(obj);
      }
    });

    const hits = this._ray.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    // Walk up to the meaningful parent (POI group or floor slab)
    let obj = hits[0].object;
    while (obj && obj !== this._scene) {
      if (obj.userData.poiId || obj.userData.floorIndex !== undefined) return obj;
      obj = obj.parent;
    }
    return hits[0].object;
  }

  _dispatchHit(obj) {
    if (obj.userData?.poiId) {
      this._emit('selectPOI', obj);
    } else if (obj.userData?.floorIndex !== undefined) {
      this._emit('floorSelect', obj.userData.floorIndex);
    }
  }

  _emit(event, data) {
    this._cbs[event]?.forEach(cb => cb(data));
  }
}
