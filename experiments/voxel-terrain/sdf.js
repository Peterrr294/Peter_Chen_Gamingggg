// SDF 统一约定：负值在内部，0 在表面，正值在外部。
export const shapeSamplers = {
  sphere(point, shape) {
    const dx = point.x - shape.position.x;
    const dy = point.y - shape.position.y;
    const dz = point.z - shape.position.z;
    return Math.hypot(dx, dy, dz) - shape.radius;
  },
  box(point, shape) {
    const qx = Math.abs(point.x - shape.position.x) - shape.size.x;
    const qy = Math.abs(point.y - shape.position.y) - shape.size.y;
    const qz = Math.abs(point.z - shape.position.z) - shape.size.z;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
      + Math.min(Math.max(qx, qy, qz), 0);
  },
};

export const sdfOperations = {
  union: (a, b) => Math.min(a, b),
  intersect: (a, b) => Math.max(a, b),
  subtract: (a, b) => Math.max(a, -b),
  smoothUnion(a, b, smoothing = 0) {
    if (smoothing <= 0) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / smoothing));
    return b * (1 - h) + a * h - smoothing * h * (1 - h);
  },
};

export function createShape(type, parameters) {
  if (!shapeSamplers[type]) throw new Error(`Unknown SDF shape: ${type}`);
  return { type, ...parameters };
}

export function sampleShape(shape, point) {
  return shapeSamplers[shape.type](point, shape);
}

export function applyOperation(currentDensity, nextDensity, type, smoothing = 0) {
  const operation = sdfOperations[type];
  if (!operation) throw new Error(`Unknown SDF operation: ${type}`);
  return operation(currentDensity, nextDensity, smoothing);
}

// 从初始形状开始，严格按照数组顺序执行；stepLimit 用于逐步查看。
export function evaluateSequence(point, shapes, initialShapeId, operations, stepLimit = operations.length) {
  let density = sampleShape(shapes[initialShapeId], point);
  const count = Math.min(stepLimit, operations.length);
  for (let index = 0; index < count; index += 1) {
    const step = operations[index];
    density = applyOperation(density, sampleShape(shapes[step.shapeId], point), step.type, step.smoothing);
  }
  return density;
}

// 保留上一阶段接口，已有调用者仍可工作。
export function sampleCombination(point, shapeA, shapeB, operation, smoothing = 0) {
  if (operation === 'sphere') return sampleShape(shapeA, point);
  if (operation === 'box') return sampleShape(shapeB, point);
  return applyOperation(sampleShape(shapeA, point), sampleShape(shapeB, point), operation, smoothing);
}
