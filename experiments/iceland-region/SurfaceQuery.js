import * as THREE from 'three';

function interpolate(a, b, amount) {
  return a + (b - a) * amount;
}

export class SurfaceQuery {
  constructor(terrain, options) {
    this.terrain = terrain;
    this.options = options;
  }

  sampleHeight(x, z) {
    const data = this.terrain.surfaceData;
    if (!data) return null;
    const normalizedX = x / data.width + 0.5;
    const normalizedZ = z / data.depth + 0.5;
    if (normalizedX < 0 || normalizedX > 1 || normalizedZ < 0 || normalizedZ > 1) return null;
    const gridX = normalizedX * data.segments;
    const gridZ = normalizedZ * data.segments;
    const x0 = Math.min(data.segments, Math.floor(gridX));
    const z0 = Math.min(data.segments, Math.floor(gridZ));
    const x1 = Math.min(data.segments, x0 + 1);
    const z1 = Math.min(data.segments, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const h00 = data.heights[z0 * data.columns + x0];
    const h10 = data.heights[z0 * data.columns + x1];
    const h01 = data.heights[z1 * data.columns + x0];
    const h11 = data.heights[z1 * data.columns + x1];
    return interpolate(interpolate(h00, h10, tx), interpolate(h01, h11, tx), tz);
  }

  querySurface(x, z) {
    const data = this.terrain.surfaceData;
    const height = this.sampleHeight(x, z);
    if (!data || height === null) {
      return { x, z, height: null, normal: null, slope: null, inBounds: false, underwater: false, safeAboveWater: false, passable: false };
    }
    const stepX = data.width / data.segments;
    const stepZ = data.depth / data.segments;
    const left = this.sampleHeight(Math.max(-data.width / 2, x - stepX), z) ?? height;
    const right = this.sampleHeight(Math.min(data.width / 2, x + stepX), z) ?? height;
    const back = this.sampleHeight(x, Math.max(-data.depth / 2, z - stepZ)) ?? height;
    const front = this.sampleHeight(x, Math.min(data.depth / 2, z + stepZ)) ?? height;
    const normal = new THREE.Vector3(-(right - left) / (stepX * 2), 1, -(front - back) / (stepZ * 2)).normalize();
    const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)));
    const underwater = height <= this.terrain.config.waterLevel;
    const safeAboveWater = height >= this.terrain.config.waterLevel + this.options.waterSafetyDistance;
    const passable = safeAboveWater && slope <= this.options.maxRoadSlope;
    return { x, z, height, normal, slope, inBounds: true, underwater, safeAboveWater, passable };
  }

  normalizedToWorld(point) {
    const data = this.terrain.surfaceData;
    return {
      x: (point.x - 0.5) * data.width,
      z: (point.z - 0.5) * data.depth,
    };
  }

  samplePath(controlPoints, spacing = this.options.sampleSpacing) {
    if (!Array.isArray(controlPoints) || controlPoints.length < 2) return [];
    const samples = [];
    for (let segmentIndex = 0; segmentIndex < controlPoints.length - 1; segmentIndex += 1) {
      const start = this.normalizedToWorld(controlPoints[segmentIndex]);
      const end = this.normalizedToWorld(controlPoints[segmentIndex + 1]);
      const distance = Math.hypot(end.x - start.x, end.z - start.z);
      const steps = Math.max(1, Math.ceil(distance / Math.max(0.05, spacing)));
      for (let step = segmentIndex === 0 ? 0 : 1; step <= steps; step += 1) {
        const t = step / steps;
        const x = interpolate(start.x, end.x, t);
        const z = interpolate(start.z, end.z, t);
        samples.push({ ...this.querySurface(x, z), segmentIndex, t });
      }
    }
    return samples;
  }
}
