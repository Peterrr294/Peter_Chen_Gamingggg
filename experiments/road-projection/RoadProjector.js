function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function sampleControlPolyline(controlPoints, surfaceQuery, spacing) {
  const points = controlPoints.map(point => surfaceQuery.normalizedToWorld(point));
  const segments = [];
  let totalLength = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    segments.push({ start, end, length, startDistance: totalLength });
    totalLength += length;
  }
  const result = [];
  const safeSpacing = Math.max(0.05, spacing);
  const sampleDistances = [];
  for (let distance = 0; distance < totalLength; distance += safeSpacing) sampleDistances.push(distance);
  sampleDistances.push(totalLength);
  let segmentIndex = 0;
  for (const distance of sampleDistances) {
    while (segmentIndex < segments.length - 1 && distance > segments[segmentIndex].startDistance + segments[segmentIndex].length) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const localDistance = distance - segment.startDistance;
    const amount = segment.length > 0 ? Math.min(1, localDistance / segment.length) : 0;
    result.push({ x: lerp(segment.start.x, segment.end.x, amount), z: lerp(segment.start.z, segment.end.z, amount), distance });
  }
  return result;
}

function reasonForQuery(query, surfaceQuery, options) {
  if (!query.inBounds) return 'out-of-bounds';
  if (query.height < surfaceQuery.terrain.config.waterLevel + options.waterClearance) return 'water';
  if (query.slope > options.maximumSlope) return 'slope';
  return null;
}

function queryPoint(point, surfaceQuery, options, reasonOverride = null) {
  const query = surfaceQuery.querySurface(point.x, point.z);
  const reason = reasonOverride ?? reasonForQuery(query, surfaceQuery, options);
  return {
    position: { x: point.x, y: query.inBounds ? query.height + options.heightOffset : options.heightOffset, z: point.z },
    normal: query.normal ? { x: query.normal.x, y: query.normal.y, z: query.normal.z } : { x: 0, y: 1, z: 0 },
    slopeDegrees: query.slope,
    distance: point.distance ?? 0,
    valid: reason === null,
    reason,
  };
}

function lateralCandidate(point, tangent, surfaceQuery, options) {
  const length = Math.hypot(tangent.x, tangent.z);
  if (length < 0.0001 || options.lateralSearchDistance <= 0) return null;
  const perpendicular = { x: -tangent.z / length, z: tangent.x / length };
  const candidates = [];
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    const offset = options.lateralSearchDistance * (step / steps);
    for (const side of [-1, 1]) {
      const candidate = { x: point.x + perpendicular.x * offset * side, z: point.z + perpendicular.z * offset * side };
      const query = surfaceQuery.querySurface(candidate.x, candidate.z);
      if (reasonForQuery(query, surfaceQuery, options) === null) candidates.push({ ...candidate, slope: query.slope, offset, side });
    }
  }
  candidates.sort((a, b) => a.slope - b.slope || a.offset - b.offset || a.side - b.side);
  return candidates[0] ?? null;
}

function projectPoints(points, surfaceQuery, options) {
  return points.map((point, index) => {
    const initial = queryPoint(point, surfaceQuery, options);
    if (initial.reason !== 'slope' || !options.enableSlopeAvoidance) return { x: point.x, z: point.z, distance: point.distance };
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const candidate = lateralCandidate(point, { x: next.x - previous.x, z: next.z - previous.z }, surfaceQuery, options);
    return candidate ? { x: candidate.x, z: candidate.z, distance: point.distance } : { x: point.x, z: point.z, distance: point.distance, avoidanceFailed: true };
  });
}

function smoothPoints(points, iterations) {
  let current = points.map(point => ({ ...point }));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = current.map(point => ({ ...point }));
    for (let index = 1; index < current.length - 1; index += 1) {
      next[index].x = current[index].x * 0.5 + (current[index - 1].x + current[index + 1].x) * 0.25;
      next[index].z = current[index].z * 0.5 + (current[index - 1].z + current[index + 1].z) * 0.25;
    }
    current = next;
  }
  return current;
}

function recalculateDistances(points) {
  let distance = 0;
  return points.map((point, index) => {
    if (index > 0) distance += Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z);
    return { ...point, distance };
  });
}

function invalidRanges(samples) {
  const ranges = [];
  let start = null;
  for (let index = 0; index < samples.length; index += 1) {
    if (!samples[index].valid && start === null) start = index;
    const closes = start !== null && (samples[index].valid || index === samples.length - 1);
    if (!closes) continue;
    const end = samples[index].valid ? index - 1 : index;
    const reasons = [...new Set(samples.slice(start, end + 1).map(sample => sample.reason))];
    ranges.push({ startIndex: start, endIndex: end, startDistance: samples[start].distance, endDistance: samples[end].distance, reasons });
    start = null;
  }
  return ranges;
}

export class RoadProjector {
  constructor(surfaceQuery, options) {
    this.surfaceQuery = surfaceQuery;
    this.options = options;
    this.debugPaths = [];
  }

  project(roadDocument) {
    const source = JSON.parse(JSON.stringify(roadDocument));
    this.debugPaths = [];
    const paths = source.roads.map(road => {
      const raw = sampleControlPolyline(road.controlPoints, this.surfaceQuery, this.options.sampleSpacing);
      const avoided = projectPoints(raw, this.surfaceQuery, this.options);
      const smoothed = smoothPoints(avoided, Math.max(0, Math.round(this.options.smoothingIterations)));
      const reprojected = projectPoints(recalculateDistances(smoothed), this.surfaceQuery, this.options);
      const finalPoints = recalculateDistances(reprojected);
      const samples = finalPoints.map(point => queryPoint(
        point,
        this.surfaceQuery,
        this.options,
        point.avoidanceFailed ? 'slope-avoidance-failed' : null,
      ));
      this.debugPaths.push({ id: road.id, raw, samples });
      return { id: road.id, width: road.width, samples, invalidRanges: invalidRanges(samples) };
    });
    return { paths };
  }
}
