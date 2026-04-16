import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { KioskState }       from './constants.js';
import { BuildingScene }    from './BuildingScene.js';
import { NavigationEngine } from './NavigationEngine.js';
import { PathVisualizer }   from './PathVisualizer.js';
import { PositioningSystem }from './PositioningSystem.js';
import { GestureController }from './GestureController.js';
import { UIOverlay }        from './UIOverlay.js';

export class KioskApp {
  constructor(canvas) {
    this._canvas   = canvas;
    this._state    = KioskState.IDLE;
    this._clock    = new THREE.Clock();
    this._camAnim  = null;   // active camera tween { startPos, endPos, startTgt, endTgt, elapsed, dur }
    this._posMarker = null;  // Three.js mesh tracking user position
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init() {
    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLighting();
    this._initParticles();

    // Sub-systems
    this.building    = new BuildingScene(this._scene);
    this.navigation  = new NavigationEngine();
    this.pathViz     = new PathVisualizer(this._scene);
    this.positioning = new PositioningSystem();
    this.gesture     = new GestureController(this._canvas, this._camera, this._scene);
    this.ui          = new UIOverlay(this);

    // Build procedural demo building and load graph
    this.building.build({ floorCount: 4 });
    this.navigation.loadGraph(this.building.getWaypointGraph());

    this._createPositionMarker();
    this._wireEvents();

    await this.positioning.init('auto');

    window.addEventListener('resize', () => this._onResize());
  }

  start() {
    this._renderer.setAnimationLoop(t => this._render(t));
  }

  setState(newState) {
    const prev   = this._state;
    this._state  = newState;
    this.ui.onStateChange(prev, newState);
    this.building.onStateChange(prev, newState);

    if (newState === KioskState.IDLE) {
      this.pathViz.clear();
      this._resetCamera();
    }
  }

  // ── Renderer / Scene / Camera setup ───────────────────────────────────────

  _initRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:    this._canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setSize(innerWidth, innerHeight);
    this._renderer.outputColorSpace      = THREE.SRGBColorSpace;
    this._renderer.toneMapping           = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure   = 1.15;
    this._renderer.shadowMap.enabled     = true;
    this._renderer.shadowMap.type        = THREE.PCFSoftShadowMap;
  }

  _initScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x040b18);
    this._scene.fog         = new THREE.FogExp2(0x040b18, 0.012);
  }

  _initCamera() {
    this._camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 600);
    this._camera.position.set(0, 28, 44);

    this._controls = new OrbitControls(this._camera, this._canvas);
    this._controls.enableDamping    = true;
    this._controls.dampingFactor    = 0.07;
    this._controls.minDistance      = 8;
    this._controls.maxDistance      = 90;
    this._controls.maxPolarAngle    = Math.PI * 0.47;
    this._controls.target.set(0, 7, 0);
  }

  _initLighting() {
    this._scene.add(new THREE.AmbientLight(0x3a5070, 2.0));

    const sun = new THREE.DirectionalLight(0x9ae8ff, 2.8);
    sun.position.set(18, 45, 14);
    sun.castShadow = true;
    Object.assign(sun.shadow, {
      mapSize: new THREE.Vector2(2048, 2048),
    });
    Object.assign(sun.shadow.camera, { near: 1, far: 200, left: -55, right: 55, top: 55, bottom: -55 });
    this._scene.add(sun);

    // Cool rim light from behind
    const rim = new THREE.DirectionalLight(0x3322ff, 0.9);
    rim.position.set(-18, 8, -22);
    this._scene.add(rim);

    // Kiosk "tower" point lights — atmosphere
    [[-10, 20, 0], [10, 20, 0]].forEach(([x, y, z]) => {
      const pt = new THREE.PointLight(0x0055ff, 1.2, 35);
      pt.position.set(x, y, z);
      this._scene.add(pt);
    });
  }

  /** Subtle star-field particles in background. */
  _initParticles() {
    const count = 1800;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 400;
      pos[i * 3 + 1] = Math.random() * 200 - 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 400;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0x4466aa, size: 0.25, sizeAttenuation: true }),
    );
    pts.renderOrder = -1;
    this._scene.add(pts);
  }

  // ── User position marker ───────────────────────────────────────────────────

  _createPositionMarker() {
    const group = new THREE.Group();
    group.name  = 'user-position';

    // Pulsing ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.65, 32),
      new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Centre dot
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2 }),
    );
    dot.position.y = 0.22;
    group.add(dot);

    this._scene.add(group);
    this._posMarker = group;
    this._posRing   = ring;
  }

  _updatePositionMarker({ x, z, floor }) {
    if (!this._posMarker) return;
    const floorY = floor * (4 + 0.3);
    this._posMarker.position.set(x, floorY + 0.08, z);
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  _wireEvents() {
    // Positioning updates
    this.positioning.on('positionUpdate', p => {
      this._updatePositionMarker(p);
      if (this._state === KioskState.LOCATING) this.setState(KioskState.BROWSING);
      document.getElementById('kiosk-mode').textContent = `positioning: ${this.positioning.mode}`;
    });

    // Gesture: tap POI
    this.gesture.on('selectPOI', obj => {
      if (this._state === KioskState.IDLE) this.setState(KioskState.BROWSING);
      this.ui.showPOIInfo(obj);
    });

    // Gesture: tap floor slab
    this.gesture.on('floorSelect', idx => {
      this._focusFloor(idx);
    });

    // Gesture: two-finger vertical spread → accordion toggle
    this.gesture.on('accordionSpread', delta => {
      if (Math.abs(delta) > 8) this._toggleAccordion();
    });

    // UI: route requested
    this.ui.on('startRoute', (originId, destId) => {
      this._startRoute(originId, destId);
    });

    // UI: floor selector
    this.ui.on('selectFloor', idx => this._focusFloor(idx));

    // Proximity → animate attract screen pulse
    this.gesture.on('proximity', norm => {
      const ring = document.querySelector('.attract-ring');
      if (ring) ring.style.setProperty('--prox', norm.toFixed(3));
    });
  }

  // ── Navigation logic ───────────────────────────────────────────────────────

  async _startRoute(originId, destId) {
    const path = this.navigation.findPath(originId, destId);
    if (!path) {
      console.warn(`[KioskApp] No path from "${originId}" to "${destId}"`);
      return;
    }

    this.setState(KioskState.ROUTING);

    // Fan floors into accordion so cross-floor path is visible
    this.building.focusFloors(path);

    // Draw animated path
    this.pathViz.draw(path);

    // Fly camera to look at path start
    this._flyToNode(path[0]);
  }

  _focusFloor(idx) {
    this.setState(KioskState.BROWSING);
    this._flyToFloor(idx);
  }

  _toggleAccordion() {
    if (this._state === KioskState.ROUTING) return; // path is already managing layout
    this.building.focusFloors(
      [{ floor: 0 }, { floor: 1 }, { floor: 2 }, { floor: 3 }],
    );
  }

  // ── Camera tweening ───────────────────────────────────────────────────────

  _flyToNode(node) {
    const dest = node.position.clone().add(new THREE.Vector3(0, 6, 16));
    this._startCamAnim(dest, node.position.clone());
  }

  _flyToFloor(floorIdx) {
    const floorY = floorIdx * (4 + 0.3) + 2;
    const dest   = new THREE.Vector3(0, floorY + 14, 32);
    const tgt    = new THREE.Vector3(0, floorY, 0);
    this._startCamAnim(dest, tgt);
  }

  _resetCamera() {
    this._startCamAnim(
      new THREE.Vector3(0, 28, 44),
      new THREE.Vector3(0, 7, 0),
    );
  }

  _startCamAnim(endPos, endTgt, dur = 1.6) {
    this._camAnim = {
      startPos: this._camera.position.clone(),
      startTgt: this._controls.target.clone(),
      endPos, endTgt,
      elapsed: 0, dur,
    };
  }

  _tickCamAnim(delta) {
    if (!this._camAnim) return;
    const a = this._camAnim;
    a.elapsed += delta;
    const t    = Math.min(a.elapsed / a.dur, 1);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

    this._camera.position.lerpVectors(a.startPos, a.endPos, ease);
    this._controls.target.lerpVectors(a.startTgt, a.endTgt, ease);

    if (t >= 1) this._camAnim = null;
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _render(timeMs) {
    const delta = Math.min(this._clock.getDelta(), 0.05); // cap at 50 ms
    const time  = timeMs * 0.001;

    this._controls.update();
    this._tickCamAnim(delta);
    this.building.update(delta);
    this.pathViz.update(time);
    this._animatePositionRing(time);

    this._renderer.render(this._scene, this._camera);
  }

  _animatePositionRing(time) {
    if (!this._posRing) return;
    const s = 0.85 + Math.sin(time * 3) * 0.15;
    this._posRing.scale.set(s, s, s);
    this._posRing.material.opacity = 0.5 + Math.sin(time * 3 + 1) * 0.3;
  }

  _onResize() {
    const w = innerWidth, h = innerHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }
}
