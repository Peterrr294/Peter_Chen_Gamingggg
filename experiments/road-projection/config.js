export const DEFAULT_PROJECTION_OPTIONS = Object.freeze({
  sampleSpacing: 0.55,
  heightOffset: 0.14,
  maximumSlope: 28,
  waterClearance: 0.3,
  lateralSearchDistance: 1.6,
  smoothingIterations: 1,
  enableSlopeAvoidance: true,
  showDebug: true,
});

export function createProjectionOptions() {
  return { ...DEFAULT_PROJECTION_OPTIONS };
}
