export function hashParts(...parts) {
  let hash = 2166136261;
  const text = parts.map(part => String(part)).join('|');
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export class SeededRandom {
  constructor(...seedParts) {
    this.seed = hashParts(...seedParts);
    this.state = this.seed;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(minimum, maximum) {
    return minimum + this.next() * (maximum - minimum);
  }

  integer(minimum, maximumExclusive) {
    return Math.floor(this.range(minimum, maximumExclusive));
  }

  fork(label) {
    return new SeededRandom(this.seed, label);
  }
}

export function regionSeed(worldSeed, regionId, regionSeedOffset) {
  return hashParts(worldSeed, regionId, regionSeedOffset);
}
