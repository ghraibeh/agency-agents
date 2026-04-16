import * as THREE from 'three';
import { DEMO_GRAPH } from './constants.js';

/**
 * A* pathfinding over the building waypoint graph.
 * Graph is loaded from CMS/BIM data in production; DEMO_GRAPH used here.
 */
export class NavigationEngine {
  constructor() {
    this._nodes = {};
    this._adj = {};   // adjacency list: id → [{id, cost}]
  }

  loadGraph(graphData = DEMO_GRAPH) {
    this._nodes = graphData.nodes;
    this._adj = {};

    Object.keys(this._nodes).forEach(id => (this._adj[id] = []));

    graphData.edges.forEach(([a, b, cost]) => {
      this._adj[a]?.push({ id: b, cost });
      this._adj[b]?.push({ id: a, cost }); // bidirectional
    });
  }

  /**
   * Returns an ordered array of node objects (with THREE.Vector3 positions)
   * or null if no path exists.
   */
  findPath(startId, endId) {
    if (!this._nodes[startId] || !this._nodes[endId]) return null;

    const h = (a, b) => {
      const pa = this._nodes[a].pos;
      const pb = this._nodes[b].pos;
      return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    };

    const open = new Set([startId]);
    const cameFrom = {};
    const g = { [startId]: 0 };
    const f = { [startId]: h(startId, endId) };

    while (open.size > 0) {
      // Pick node with lowest f-score
      const current = [...open].reduce((a, b) =>
        (f[a] ?? Infinity) < (f[b] ?? Infinity) ? a : b,
      );

      if (current === endId) return this._buildPath(cameFrom, current);

      open.delete(current);

      for (const { id: nb, cost } of this._adj[current] ?? []) {
        const tentG = (g[current] ?? Infinity) + cost;
        if (tentG < (g[nb] ?? Infinity)) {
          cameFrom[nb] = current;
          g[nb] = tentG;
          f[nb] = tentG + h(nb, endId);
          open.add(nb);
        }
      }
    }

    return null; // unreachable
  }

  _buildPath(cameFrom, end) {
    const path = [];
    let cur = end;
    while (cur !== undefined) {
      const n = this._nodes[cur];
      path.unshift({
        ...n,
        position: new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]),
      });
      cur = cameFrom[cur];
    }
    return path;
  }

  /** All destinations for search UI. */
  getDestinations() {
    return Object.values(this._nodes).map(({ id, label, floor }) => ({ id, label, floor }));
  }

  /** Nearest graph node to a world-space position. */
  nearestNode(worldPos) {
    let best = null;
    let bestDist = Infinity;
    for (const node of Object.values(this._nodes)) {
      const d = Math.hypot(
        worldPos.x - node.pos[0],
        worldPos.y - node.pos[1],
        worldPos.z - node.pos[2],
      );
      if (d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }
}
