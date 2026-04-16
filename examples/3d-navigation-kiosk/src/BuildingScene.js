import * as THREE from 'three';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FLOOR_HEIGHT, FLOOR_THICKNESS, ACCORDION_GAP, KioskState, DEMO_GRAPH } from './constants.js';

const WALL_H   = FLOOR_HEIGHT - 0.1;
const UNIT_Y   = FLOOR_HEIGHT + FLOOR_THICKNESS; // stacked floor spacing

// POI definitions per floor (colour-coded by category)
const FLOOR_POIS = [
  [
    { id: 'entrance',   label: 'Main Entrance', x:  0, z:  7, color: 0x00ff88 },
    { id: 'info',       label: 'Info Desk',     x: -3, z:  3, color: 0x0088ff },
    { id: 'shop-a',     label: 'Store A',       x: -7, z: -2, color: 0xff8800 },
    { id: 'shop-b',     label: 'Store B',       x:  7, z: -2, color: 0xff8800 },
    { id: 'elev-0',     label: 'Elevator',      x:  0, z: -6, color: 0xffff44 },
  ],
  [
    { id: 'food-court', label: 'Food Court',    x:  0, z:  3, color: 0xff4488 },
    { id: 'shop-c',     label: 'Store C',       x: -7, z: -2, color: 0xff8800 },
    { id: 'shop-d',     label: 'Store D',       x:  7, z: -2, color: 0xff8800 },
    { id: 'elev-1',     label: 'Elevator',      x:  0, z: -6, color: 0xffff44 },
  ],
  [
    { id: 'cinema',     label: 'Cinema',        x: -5, z: -1, color: 0xaa00ff },
    { id: 'gym',        label: 'Gym',           x:  5, z: -1, color: 0x00ccff },
    { id: 'lounge',     label: 'Sky Lounge',    x:  0, z:  4, color: 0xff6622 },
    { id: 'elev-2',     label: 'Elevator',      x:  0, z: -6, color: 0xffff44 },
  ],
  [
    { id: 'office-a',   label: 'Office A',      x: -6, z: -2, color: 0x4488ff },
    { id: 'office-b',   label: 'Office B',      x:  6, z: -2, color: 0x4488ff },
    { id: 'rooftop',    label: 'Rooftop Garden',x:  0, z:  3, color: 0x66ff44 },
    { id: 'elev-3',     label: 'Elevator',      x:  0, z: -6, color: 0xffff44 },
  ],
];

export class BuildingScene {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene  = scene;
    this._root   = new THREE.Group();
    this._root.name = 'building';
    scene.add(this._root);

    this._floors = [];   // { group, slab, slabMat, walls, targetY, _tweening }
    this._loader = this._createLoader();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Build the procedural demo building. */
  build({ floorCount = 4, width = 20, depth = 15 } = {}) {
    this._width  = width;
    this._depth  = depth;
    this._count  = floorCount;

    for (let i = 0; i < floorCount; i++) {
      const floorObj = this._buildFloor(i, width, depth);
      this._floors.push(floorObj);
      this._root.add(floorObj.group);
    }

    this._addExteriorShell(width, depth, floorCount);
    this._addGround();
  }

  /**
   * Load a real GLTF building model.
   * Mesh naming convention: "Floor_N_*" (N = 0-indexed floor number).
   */
  async loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this._loader.load(
        url,
        gltf => {
          const byFloor = {};

          gltf.scene.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow  = true;
            child.receiveShadow = true;
            if (child.material) child.material.envMapIntensity = 1.5;

            const m = child.name.match(/^Floor_(\d+)/i);
            if (m) {
              const idx = parseInt(m[1]);
              (byFloor[idx] ??= new THREE.Group()).add(child);
            }
          });

          // Replace procedural floors with GLTF data
          Object.entries(byFloor).forEach(([idxStr, grp]) => {
            const idx = parseInt(idxStr);
            if (this._floors[idx]) {
              this._root.remove(this._floors[idx].group);
              this._floors[idx].group = grp;
              grp.position.y = idx * UNIT_Y;
              this._root.add(grp);
            }
          });

          resolve(gltf);
        },
        xhr => { /* loading progress */ },
        reject,
      );
    });
  }

  /**
   * Spread floors into Accordion mode so the active floor is hero-sized and
   * others fan out above/below it. Floors animate smoothly via update().
   * @param {Array} pathNodes - array of path nodes from NavigationEngine
   */
  focusFloors(pathNodes) {
    const activeIdx = pathNodes[0]?.floor ?? 0;
    const usedFloors = new Set(pathNodes.map(n => n.floor));

    this._floors.forEach((fl, i) => {
      const diff = i - activeIdx;
      const sign = diff < 0 ? -1 : 1;

      if (i === activeIdx) {
        fl.targetY    = activeIdx * UNIT_Y;
        fl.slabMat.opacity = 1.0;
      } else {
        // Non-active floors spread further from center
        fl.targetY    = activeIdx * UNIT_Y + sign * (Math.abs(diff) * (UNIT_Y + ACCORDION_GAP));
        fl.slabMat.opacity = usedFloors.has(i) ? 0.55 : 0.25;
      }

      fl._tweening = true;
    });
  }

  /** Smooth per-frame animation for accordion. */
  update(delta) {
    for (const fl of this._floors) {
      if (!fl._tweening) continue;

      const diff = fl.targetY - fl.group.position.y;
      if (Math.abs(diff) < 0.001) {
        fl.group.position.y = fl.targetY;
        fl._tweening = false;
      } else {
        fl.group.position.y += diff * Math.min(delta * 6, 1);
      }
    }
  }

  /** Reset accordion — called on IDLE state. */
  resetLayout() {
    this._floors.forEach((fl, i) => {
      fl.targetY = i * UNIT_Y;
      fl.slabMat.opacity = 1.0;
      fl._tweening = true;
    });
  }

  onStateChange(prev, next) {
    if (next === KioskState.IDLE) this.resetLayout();
  }

  /** Return the graph data (production: fetched from BIM/CMS). */
  getWaypointGraph() {
    return DEMO_GRAPH;
  }

  // ── Private: procedural floor construction ─────────────────────────────────

  _buildFloor(idx, w, d) {
    const group = new THREE.Group();
    group.name = `floor-${idx}`;
    group.position.y = idx * UNIT_Y;

    // Slab
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x182438, roughness: 0.7, metalness: 0.25,
      transparent: true, opacity: 1,
    });
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, FLOOR_THICKNESS, d),
      slabMat,
    );
    slab.receiveShadow = true;
    slab.position.y = -FLOOR_THICKNESS / 2;
    slab.userData.floorIndex = idx;
    slab.name = `floor-slab-${idx}`;
    group.add(slab);

    // Interior walls
    this._addWalls(group, w, d);

    // POI markers
    const poiDefs = FLOOR_POIS[idx % FLOOR_POIS.length] ?? [];
    poiDefs.forEach(def => group.add(this._makePOI(def, idx)));

    // Edge glow strip (colour-coded per floor)
    const stripColor = [0x00aaff, 0x00ff99, 0xaa44ff, 0xff6600][idx % 4];
    group.add(this._makeEdgeStrip(w, d, stripColor));

    return {
      group, slab, slabMat,
      targetY: idx * UNIT_Y,
      _tweening: false,
    };
  }

  _addWalls(group, w, d) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x243344, roughness: 0.85, metalness: 0.1,
      transparent: true, opacity: 1,
    });
    // Two internal partitions (simplified room layout)
    const dividers = [
      { geo: [w * 0.9, WALL_H, 0.1], pos: [0, WALL_H / 2, -d * 0.15] }, // horizontal divider
      { geo: [0.1, WALL_H, d * 0.7], pos: [w * 0.12, WALL_H / 2, 0]  }, // vertical corridor
    ];
    dividers.forEach(({ geo, pos }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...geo), mat);
      m.castShadow = true;
      m.position.set(...pos);
      group.add(m);
    });

    // Perimeter walls (open-top box, no ceiling so floors are visible from above)
    const perimDefs = [
      { g: [w, WALL_H, 0.12], p: [0, WALL_H / 2,  d / 2] },
      { g: [w, WALL_H, 0.12], p: [0, WALL_H / 2, -d / 2] },
      { g: [0.12, WALL_H, d], p: [-w / 2, WALL_H / 2, 0]  },
      { g: [0.12, WALL_H, d], p: [ w / 2, WALL_H / 2, 0]  },
    ];
    perimDefs.forEach(({ g, p }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...g), mat);
      m.castShadow = true;
      m.position.set(...p);
      group.add(m);
    });
  }

  _makePOI({ id, label, x, z, color }, floorIdx) {
    const g = new THREE.Group();
    g.name = `poi-${id}`;
    g.userData = { poiId: id, label, floor: floorIdx };

    // Hexagonal floor decal
    const shape = new THREE.Shape();
    const R = 0.45;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      i === 0 ? shape.moveTo(Math.cos(a) * R, Math.sin(a) * R)
              : shape.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    shape.closePath();

    const decal = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.6,
        roughness: 0.2, metalness: 0.9,
      }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.06, z);
    g.add(decal);

    // Vertical beacon beam
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.8, 8),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.65,
      }),
    );
    beam.position.set(x, 0.9, z);
    g.add(beam);

    return g;
  }

  _makeEdgeStrip(w, d, color) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.06, d),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.5,
      }),
    );
    strip.position.set(-w / 2 - 0.04, 0, 0);
    return strip;
  }

  _addExteriorShell(w, d, floors) {
    const h = floors * UNIT_Y;
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, h, d + 0.6),
      new THREE.MeshStandardMaterial({
        color: 0x1a3a5f, roughness: 0.2, metalness: 0.8,
        transparent: true, opacity: 0.08,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    shell.position.y = h / 2;
    this._root.add(shell);
  }

  _addGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: 0x080f1f, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this._root.add(ground);

    const grid = new THREE.GridHelper(200, 60, 0x002288, 0x000d33);
    grid.position.y = 0.01;
    this._root.add(grid);
  }

  _createLoader() {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  }
}
