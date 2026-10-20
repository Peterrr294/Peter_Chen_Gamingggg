import { checksum } from '../cellular-noise/noise.js';

// Shared NetworkGraph builder for every strategy (pure data, no Three.js).
//
// NetworkGraph
//   nodes[]      { id, x, y, z, kind: junction|endpoint|bend|port|portal, degree, componentId, onBoundary, side }
//   edges[]      { id, from, to, kind: road|canal|bridgeCandidate|tunnel, roadClass: primary|secondary|lane|canal|bridge,
//                  width, length, axisDeg, straightness, points[{x,y,z}], inTransition, source, rule?, tunnel? }
//                  tunnel edges keep their underground y; `tunnel` holds portals, grade, cover profile, decision.
//   edgePorts[]  { id, nodeId, edgeId, side, position, direction{x,z}, directionDeg, type: road|canal,
//                  roadClass, elevation, redirect{ anchor{x,z,distanceFromEdge}, neighborPortId, mode } }
//   components[] { id, kind: road|canal, nodeCount, edgeCount, length }
// World metres; y is terrain height for roads and bridges, water surface for canals.
// Angles in degrees from +x toward +z (axes 0–180°, directions 0–360°).

const key = (x, z) => `${Math.round(x * 100)}:${Math.round(z * 100)}`;
const axisDeg = (dx, dz) => ((Math.atan2(dz, dx) * 180 / Math.PI) % 180 + 180) % 180;

export class GraphBuilder {
  constructor(grid) {
    this.grid = grid;
    this.half = grid.size / 2;
    this.nodes = new Map();
    this.edges = new Map();
    this.removed = { shortComponents: 0, duplicateEdges: 0 };
  }

  boundarySide(x, z) {
    const { originX, originZ } = this.grid;
    const eps = 1e-6;
    if (Math.abs(x - (originX - this.half)) < eps) return 'minX';
    if (Math.abs(x - (originX + this.half)) < eps) return 'maxX';
    if (Math.abs(z - (originZ - this.half)) < eps) return 'minZ';
    if (Math.abs(z - (originZ + this.half)) < eps) return 'maxZ';
    return null;
  }

  node(x, z) {
    const id = key(x, z);
    if (!this.nodes.has(id)) this.nodes.set(id, { id, x, z, edges: new Set() });
    return id;
  }

  // points: [{x,z}, …] including both ends. Duplicate edges (same ends, kind, class) are skipped.
  edge(points, props) {
    if (points.length < 2) return null;
    const from = this.node(points[0].x, points[0].z);
    const to = this.node(points.at(-1).x, points.at(-1).z);
    if (from === to) return null;
    const id = `${[from, to].sort().join('~')}|${props.kind}|${props.roadClass}|${points.length}`;
    if (this.edges.has(id)) { this.removed.duplicateEdges += 1; return null; }
    this.edges.set(id, { id, from, to, points, ...props });
    this.nodes.get(from).edges.add(id);
    this.nodes.get(to).edges.add(id);
    return id;
  }

  // Splits an edge at `point`, which lies on segment segIndex (points[segIndex] → points[segIndex + 1]).
  // Returns the node id at the split point; existing end nodes are returned unchanged.
  splitEdgeAt(id, segIndex, point) {
    const edge = this.edges.get(id);
    // Mountain roads are graded straight between vertices: a split point takes the
    // interpolated road elevation, not the terrain height under it.
    if (edge.rule === 'mountain' && this.heightAt) {
      const a = edge.points[segIndex]; const b = edge.points[segIndex + 1];
      const ya = a.y ?? this.heightAt(a.x, a.z); const yb = b.y ?? this.heightAt(b.x, b.z);
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      point = { ...point, y: ya + (yb - ya) * Math.hypot(point.x - a.x, point.z - a.z) / length };
    }
    const nodeId = key(point.x, point.z);
    if (nodeId === edge.from || nodeId === edge.to) return nodeId;
    const first = [...edge.points.slice(0, segIndex + 1), point].filter((p, i, list) => i === 0 || key(p.x, p.z) !== key(list[i - 1].x, list[i - 1].z));
    const second = [point, ...edge.points.slice(segIndex + 1)].filter((p, i, list) => i === 0 || key(p.x, p.z) !== key(list[i - 1].x, list[i - 1].z));
    const { id: _id, from: _from, to: _to, points: _points, ...props } = edge;
    this.removeEdge(id);
    this.edge(first, props);
    this.edge(second, props);
    return this.node(point.x, point.z);
  }

  removeEdge(id) {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.nodes.get(edge.from)?.edges.delete(id);
    this.nodes.get(edge.to)?.edges.delete(id);
    this.edges.delete(id);
  }

  components(kindFilter) {
    const seen = new Set();
    const result = [];
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      const edges = [...node.edges].filter(edgeId => kindFilter(this.edges.get(edgeId).kind));
      if (!edges.length) continue;
      const component = { nodes: [], edges: new Set(), length: 0 };
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const current = this.nodes.get(stack.pop());
        component.nodes.push(current.id);
        for (const edgeId of current.edges) {
          const edge = this.edges.get(edgeId);
          if (!kindFilter(edge.kind) || component.edges.has(edgeId)) continue;
          component.edges.add(edgeId);
          const other = edge.from === current.id ? edge.to : edge.from;
          if (!seen.has(other)) { seen.add(other); stack.push(other); }
        }
      }
      for (const edgeId of component.edges) component.length += polylineLength(this.edges.get(edgeId).points);
      result.push(component);
    }
    return result;
  }

  pruneShortComponents(minLength) {
    for (const component of this.components(kind => kind !== 'canal')) {
      if (component.length >= minLength) continue;
      this.removed.shortComponents += 1;
      component.edges.forEach(edgeId => this.removeEdge(edgeId));
    }
    for (const [id, node] of this.nodes) if (!node.edges.size) this.nodes.delete(id);
  }

  // sampler: { height(x,z), waterSurface(x,z) }, context: { transitionWidth, meta }
  finalize(sampler, context) {
    const nodeList = [];
    const index = new Map();
    const roadComponents = this.components(kind => kind !== 'canal');
    const canalComponents = this.components(kind => kind === 'canal');
    const componentOf = new Map();
    [...roadComponents.map(c => ['road', c]), ...canalComponents.map(c => ['canal', c])].forEach(([kind, component], id) => {
      component.nodes.forEach(nodeId => { if (!componentOf.has(nodeId) || kind === 'road') componentOf.set(nodeId, id); });
      component.kind = kind;
    });
    for (const node of this.nodes.values()) {
      const edges = [...node.edges].map(id => this.edges.get(id));
      const canalOnly = edges.every(edge => edge.kind === 'canal');
      const side = this.boundarySide(node.x, node.z);
      const degree = node.edges.size;
      const entry = {
        id: nodeList.length, key: node.id, x: node.x, z: node.z,
        y: canalOnly ? sampler.waterSurface(node.x, node.z) : sampler.height(node.x, node.z),
        degree,
        kind: side ? 'port' : edges.some(edge => edge.kind === 'tunnel') ? 'portal' : degree >= 3 ? 'junction' : degree === 1 ? 'endpoint' : 'bend',
        onBoundary: Boolean(side),
        side,
        componentId: componentOf.get(node.id) ?? null,
      };
      index.set(node.id, entry.id);
      nodeList.push(entry);
    }
    const edgeList = [...this.edges.values()].map((edge, id) => {
      const surface = edge.kind === 'canal' ? sampler.waterSurface : sampler.height;
      const points = edge.points.map(point => ({ x: point.x, y: edge.kind === 'tunnel' || (edge.rule === 'mountain' && point.y !== undefined) ? point.y : surface(point.x, point.z), z: point.z }));
      const length = polylineLength(points);
      const chord = Math.hypot(points.at(-1).x - points[0].x, points.at(-1).z - points[0].z);
      return {
        id, from: index.get(edge.from), to: index.get(edge.to), kind: edge.kind, roadClass: edge.roadClass, width: edge.width,
        length, axisDeg: axisDeg(points.at(-1).x - points[0].x, points.at(-1).z - points[0].z), straightness: length ? chord / length : 1,
        points, inTransition: points.some(point => this.distanceToBoundary(point) < context.transitionWidth), source: edge.source,
        ...(edge.rule ? { rule: edge.rule } : {}),
        ...(edge.tunnel ? { tunnel: edge.tunnel } : {}),
      };
    });
    const edgePorts = this.ports(nodeList, edgeList, context.transitionWidth);
    const components = [...roadComponents, ...canalComponents].map((component, id) => ({
      id, kind: component.kind, nodeCount: component.nodes.length, edgeCount: component.edges.size, length: component.length,
    }));
    const graph = { ...context.meta, units: { length: 'm', elevation: 'm', angle: 'deg from +x toward +z' }, nodes: nodeList, edges: edgeList, edgePorts, components, removed: this.removed };
    graph.stats = networkStats(graph);
    graph.signature = checksum(new TextEncoder().encode(JSON.stringify({ n: nodeList, e: edgeList.map(({ points, ...rest }) => ({ ...rest, p: points.length })) })));
    return graph;
  }

  distanceToBoundary(point) {
    const { originX, originZ } = this.grid;
    return Math.min(point.x - (originX - this.half), originX + this.half - point.x, point.z - (originZ - this.half), originZ + this.half - point.z);
  }

  // One port per (boundary node, incident edge). The redirect anchor is where the
  // edge crosses the inner line of the transition zone (reserved for neighbour remapping).
  ports(nodes, edges, transitionWidth) {
    const ports = [];
    const normals = { minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1] };
    for (const node of nodes.filter(item => item.onBoundary)) {
      for (const edge of edges.filter(item => item.from === node.id || item.to === node.id)) {
        const points = edge.from === node.id ? edge.points : [...edge.points].reverse();
        const inward = points[1];
        const dx = points[0].x - inward.x;
        const dz = points[0].z - inward.z;
        const length = Math.hypot(dx, dz) || 1;
        let anchor = null;
        for (let i = 1; i < points.length && !anchor; i += 1) {
          const a = points[i - 1];
          const b = points[i];
          const da = this.distanceToBoundary(a);
          const db = this.distanceToBoundary(b);
          if (da < transitionWidth && db >= transitionWidth) {
            const t = (transitionWidth - da) / (db - da);
            anchor = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, distanceFromEdge: transitionWidth };
          }
        }
        ports.push({
          id: ports.length, nodeId: node.id, edgeId: edge.id, side: node.side,
          position: node.side.endsWith('X') ? node.z : node.x,
          direction: { x: dx / length, z: dz / length },
          directionDeg: ((Math.atan2(dz, dx) * 180 / Math.PI) + 360) % 360,
          outwardDot: (dx * normals[node.side][0] + dz * normals[node.side][1]) / length,
          type: edge.kind === 'canal' ? 'canal' : 'road',
          roadClass: edge.roadClass,
          elevation: node.y,
          redirect: { anchor, anchorStatus: anchor ? 'onEdge' : 'edgeEndsInsideTransition', neighborPortId: null, mode: 'reserved' },
        });
      }
    }
    return ports;
  }
}

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return length;
}

function networkStats(graph) {
  const roadEdges = graph.edges.filter(edge => edge.kind !== 'canal');
  const roadNodeIds = new Set(roadEdges.flatMap(edge => [edge.from, edge.to]));
  const roadDegree = new Map();
  roadEdges.forEach(edge => { roadDegree.set(edge.from, (roadDegree.get(edge.from) ?? 0) + 1); roadDegree.set(edge.to, (roadDegree.get(edge.to) ?? 0) + 1); });
  const roadNodes = graph.nodes.filter(node => roadNodeIds.has(node.id));
  const deadEnds = roadNodes.filter(node => roadDegree.get(node.id) === 1 && !node.onBoundary).length;
  const degreeHistogram = {};
  roadNodes.forEach(node => { const degree = roadDegree.get(node.id); degreeHistogram[degree] = (degreeHistogram[degree] ?? 0) + 1; });
  const lengthByClass = {};
  graph.edges.forEach(edge => { lengthByClass[edge.roadClass] = (lengthByClass[edge.roadClass] ?? 0) + edge.length; });
  // Length-weighted orientation entropy over 12 bins of 15° (0 = one direction, log2 12 ≈ 3.58 = uniform).
  const bins = new Array(12).fill(0);
  let total = 0;
  for (const edge of roadEdges) {
    for (let i = 1; i < edge.points.length; i += 1) {
      const dx = edge.points[i].x - edge.points[i - 1].x;
      const dz = edge.points[i].z - edge.points[i - 1].z;
      const length = Math.hypot(dx, dz);
      bins[Math.min(11, Math.floor(axisDeg(dx, dz) / 15))] += length;
      total += length;
    }
  }
  const entropy = total ? -bins.filter(Boolean).reduce((sum, value) => sum + (value / total) * Math.log2(value / total), 0) : 0;
  const roadLength = roadEdges.reduce((sum, edge) => sum + edge.length, 0);
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    edgesByKind: Object.fromEntries(['road', 'canal', 'bridgeCandidate', 'tunnel'].map(kind => [kind, graph.edges.filter(edge => edge.kind === kind).length])),
    lengthByClass,
    roadLength,
    roadComponents: graph.components.filter(component => component.kind === 'road').length,
    canalComponents: graph.components.filter(component => component.kind === 'canal').length,
    junctions: roadNodes.filter(node => roadDegree.get(node.id) >= 3).length,
    deadEnds,
    deadEndRatio: roadNodes.length ? deadEnds / roadNodes.length : 0,
    meanDegree: roadNodes.length ? [...roadDegree.values()].reduce((a, b) => a + b, 0) / roadNodes.length : 0,
    degreeHistogram,
    orientationEntropy: entropy,
    straightness: roadLength ? roadEdges.reduce((sum, edge) => sum + edge.straightness * edge.length, 0) / roadLength : 1,
    ports: graph.edgePorts.length,
    portsBySide: Object.fromEntries(['minX', 'maxX', 'minZ', 'maxZ'].map(side => [side, graph.edgePorts.filter(port => port.side === side).length])),
    bridges: graph.edges.filter(edge => edge.kind === 'bridgeCandidate').length,
    tunnels: graph.edges.filter(edge => edge.kind === 'tunnel').length,
    tunnelLength: graph.edges.filter(edge => edge.kind === 'tunnel').reduce((sum, edge) => sum + edge.length, 0),
    mountainConnectors: graph.edges.filter(edge => edge.rule === 'mountain').length,
  };
}
