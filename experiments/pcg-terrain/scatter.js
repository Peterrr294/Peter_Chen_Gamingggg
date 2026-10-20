export function seedToUint(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seed) {
  let state = seedToUint(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateScatter(parameters, querySurface) {
  const random = createRandom(parameters.seed);
  const requested = Math.max(0, Math.floor(parameters.count));
  const maximumAttempts = Math.max(0, Math.floor(parameters.maximumAttempts));
  const minimumScale = Math.min(parameters.minimumScale, parameters.maximumScale);
  const maximumScale = Math.max(parameters.minimumScale, parameters.maximumScale);
  const candidates = [];
  const accepted = [];
  let attempts = 0;

  while (accepted.length < requested && attempts < maximumAttempts) {
    attempts += 1;
    const x = (random() * 2 - 1) * parameters.candidateHalfExtent;
    const z = (random() * 2 - 1) * parameters.candidateHalfExtent;
    const surface = querySurface(x, z);
    const candidate = { x, z, accepted: Boolean(surface), y: surface?.y ?? 0 };
    candidates.push(candidate);

    if (!surface) continue;
    accepted.push({
      x,
      y: surface.y,
      z,
      scale: minimumScale + random() * (maximumScale - minimumScale),
      yaw: parameters.randomYaw ? random() * Math.PI * 2 : 0,
    });
  }

  const rejected = candidates.filter(candidate => !candidate.accepted);
  return {
    candidates,
    accepted,
    rejected,
    stats: {
      requested,
      attempts,
      accepted: accepted.length,
      rejected: rejected.length,
      acceptanceRate: attempts ? accepted.length / attempts : 0,
      seed: String(parameters.seed),
    },
  };
}

export const scatterPresets = {
  Sparse: { count: 24, maximumAttempts: 60, minimumScale: 0.8, maximumScale: 1.2, randomYaw: true },
  Medium: { count: 140, maximumAttempts: 320, minimumScale: 0.65, maximumScale: 1.35, randomYaw: true },
  Dense: { count: 900, maximumAttempts: 1900, minimumScale: 0.5, maximumScale: 1.5, randomYaw: true },
};
