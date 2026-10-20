import * as THREE from 'three';
import { RoadMeshBuilder } from '../road-mesh/RoadMeshBuilder.js';
import { DEFAULT_ROAD_MESH_OPTIONS } from '../road-mesh/config.js';

// Road Network Debug Layer (render only). Ribbons reuse the road-mesh
// RoadMeshBuilder; the NetworkGraph itself is never modified here.
const TUNNEL_COLOR = 0xb388ff;
const PORTAL_COLOR = 0xffe14d;
const CLASS_COLOR = { primary: 0xf7f3e8, secondary: 0xf2a541, lane: 0xe0c27a, canal: 0x5fd3ff, bridge: 0xff4f9a };
const DENSIFY = 8; // m between ribbon samples so straight edges follow the terrain

export class NetworkView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Road network debug layer';
    scene.add(this.root);
    this.ribbons = new RoadMeshBuilder(this.root, { ...DEFAULT_ROAD_MESH_OPTIONS, surfaceOffset: 1.5, showCenterline: false, showInvalidSegments: false });
    this.markers = new THREE.Group();
    this.root.add(this.markers);
  }

  update(graph, heightAt) {
    // Tunnels are not ribbons: they are drawn as an x-ray centreline below.
    const surfaceEdges = graph.edges.filter(edge => edge.kind !== 'tunnel');
    const paths = surfaceEdges.map(edge => ({ id: `edge-${edge.id}`, width: edge.width, samples: this.samples(edge, heightAt) }));
    const output = this.ribbons.build({ paths });
    output.roads.forEach((road, index) => {
      const edge = surfaceEdges[index];
      road.mesh.material.color.setHex(CLASS_COLOR[edge.roadClass] ?? 0xffffff);
      road.mesh.material.emissive.setHex(CLASS_COLOR[edge.roadClass] ?? 0xffffff);
      road.mesh.material.emissiveIntensity = 0.35;
      road.mesh.renderOrder = edge.kind === 'canal' ? 1 : 2;
    });
    this.markers.children.forEach(child => { child.geometry.dispose(); child.material.dispose(); });
    this.markers.clear();
    // Underground path: dashed, depthTest off so it shows through the terrain (debug x-ray).
    for (const edge of graph.edges.filter(item => item.kind === 'tunnel')) {
      const geometry = new THREE.BufferGeometry().setFromPoints(edge.points.map(point => new THREE.Vector3(point.x, point.y + 1, point.z)));
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: TUNNEL_COLOR, dashSize: 14, gapSize: 8, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 40;
      this.markers.add(line);
    }
    const points = (list, color, size) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap(item => [item.x, item.y + 4, item.z]), 3));
      const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
      mesh.renderOrder = 30;
      this.markers.add(mesh);
    };
    points(graph.nodes.filter(node => !node.onBoundary), 0xffffff, 5);
    points(graph.edgePorts.map(port => graph.nodes[port.nodeId]), 0xff3b3b, 11);
    // Portal markers only — the terrain mesh is not opened (geometry TODO).
    points(graph.edges.filter(edge => edge.kind === 'tunnel').flatMap(edge => edge.tunnel.portals), PORTAL_COLOR, 14);
  }

  samples(edge, heightAt) {
    const result = [];
    let distance = 0;
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(length / DENSIFY));
      for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        // Roads follow the terrain; canals and bridges interpolate their stored elevations.
        const y = edge.kind === 'road' ? heightAt(x, z) : a.y + (b.y - a.y) * t;
        result.push({ position: { x, y, z }, normal: { x: 0, y: 1, z: 0 }, valid: true, distance: distance + length * t });
      }
      distance += length;
    }
    return result;
  }

  setVisible(value) { this.root.visible = value; }
}
