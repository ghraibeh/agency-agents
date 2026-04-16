import * as THREE from 'three';

// ── Shaders ────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Animated flowing-particle effect along the tube.
// uv.x  → 0..1 along tube length
// uv.y  → 0..1 around cross-section circumference
const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uReveal;   // 0..1 controls draw-on animation
  uniform vec3  uColorA;   // gradient start
  uniform vec3  uColorB;   // gradient end

  varying vec2 vUv;

  void main() {
    float along = vUv.x;   // position along tube

    // Discard fragments beyond the animated reveal front
    if (along > uReveal) discard;

    // --- flowing particle trains ---
    float speed  = 1.4;
    float trains = 5.0;
    float flow   = fract(along * trains - uTime * speed);
    float head   = smoothstep(0.0, 0.12, flow) * smoothstep(0.32, 0.14, flow);

    // Cross-section edge fade so tube has soft rim rather than hard silhouette
    float ring  = abs(vUv.y * 2.0 - 1.0); // 0 at ring-seam, 1 at centre
    float rim   = 1.0 - ring * ring;

    // Base path color gradient
    vec3 col = mix(uColorA, uColorB, along);

    // Bright particle overlay (cyan-white sparks)
    col += head * vec3(0.35, 0.75, 1.0) * 2.2;

    // Reveal-front brightens slightly
    float frontGlow = smoothstep(0.0, 0.04, uReveal - along);
    col += frontGlow * vec3(0.5, 0.9, 1.0) * 0.6;

    float alpha = (0.55 + head * 0.45) * (0.3 + rim * 0.7);

    gl_FragColor = vec4(col, alpha);
  }
`;

// ── PathVisualizer ──────────────────────────────────────────────────────────

export class PathVisualizer {
  constructor(scene) {
    this._scene  = scene;
    this._group  = new THREE.Group();
    this._group.name = 'path-visualizer';
    this._group.renderOrder = 1;
    scene.add(this._group);

    this._mat     = null;
    this._reveal  = 0;
    this._running = false;
  }

  /**
   * Build and animate the path from an array of nodes (each has .position Vector3).
   */
  draw(nodes) {
    this.clear();
    if (!nodes || nodes.length < 2) return;

    const points = nodes.map(n => n.position.clone());

    // Smooth interpolation through waypoints
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

    const tubeSeg = 120;
    const radSeg  = 7;
    const geo = new THREE.TubeGeometry(curve, tubeSeg, 0.14, radSeg, false);

    this._mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime:   { value: 0 },
        uReveal: { value: 0 },
        uColorA: { value: new THREE.Color(0x00ff99) },
        uColorB: { value: new THREE.Color(0x0077ff) },
      },
      transparent: true,
      depthWrite:  false,
      side: THREE.DoubleSide,
    });

    const tube = new THREE.Mesh(geo, this._mat);
    tube.renderOrder = 1;
    this._group.add(tube);

    // Waypoint markers (origin green, destination red, transit blue)
    nodes.forEach((node, i) => {
      const isFirst = i === 0;
      const isLast  = i === nodes.length - 1;
      this._group.add(this._makeMarker(node.position, isFirst, isLast));
    });

    // Kick off draw-on animation
    this._reveal  = 0;
    this._running = true;
  }

  _makeMarker(pos, isFirst, isLast) {
    const color  = isFirst ? 0x00ff88 : isLast ? 0xff3355 : 0x4499ff;
    const radius = isFirst || isLast ? 0.38 : 0.22;

    const group = new THREE.Group();
    group.position.copy(pos).add(new THREE.Vector3(0, 0.35, 0));

    // Core sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 20),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.8,
        roughness: 0.1,
        metalness: 0.7,
      }),
    );
    group.add(sphere);

    // Outer glow disc
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.6, radius * 2.4, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    group.add(disc);

    return group;
  }

  update(timeSec) {
    if (!this._mat) return;

    this._mat.uniforms.uTime.value = timeSec;

    if (this._running) {
      this._reveal = Math.min(this._reveal + 0.006, 1.0);
      this._mat.uniforms.uReveal.value = this._reveal;
      if (this._reveal >= 1) this._running = false;
    }
  }

  clear() {
    this._running = false;
    for (let i = this._group.children.length - 1; i >= 0; i--) {
      const child = this._group.children[i];
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => m?.dispose());
      this._group.remove(child);
    }
    this._mat = null;
  }
}
