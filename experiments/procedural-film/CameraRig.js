import * as THREE from 'three';
import { PART_ONE_END, STAGE_START } from './stageManifest.js';

// WEB-01 Camera presets on one orthographic camera. A pose is { target, az, el, h }; the film camera is a pure function of t,
// so scrubbing and replay give the same view. Only a few deliberate moves: plan for the analysis, push-in for the parcels, pull-out at the end.
const BASE_HEIGHT = 1000;
const DISTANCE = 40000;
const deg = THREE.MathUtils.degToRad;
const ease = x => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
const direction = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
const shortest = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
const mixPose = (a, b, k) => ({ target: a.target.clone().lerp(b.target, k), az: a.az + (shortest(a.az, b.az) - a.az) * k, el: a.el + (b.el - a.el) * k, h: a.h + (b.h - a.h) * k });

export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'film'; // film | free
    this.tween = null;
    this.aspect = 1;
    this.inset = 0; // share of the view height covered by the control bar
    this.box = null;
    this.focus = null;
  }

  configure(box, focus) { this.box = box; this.focus = new THREE.Vector3(focus.x, focus.y, focus.z); }

  // inset = share of the height under the control bar (and bottom sheet); insetRight = share of the width under the Inspector.
  setViewport(aspect, inset, insetRight = 0) {
    this.aspect = aspect * (1 - insetRight);
    this.inset = inset;
    const c = this.camera;
    c.left = -BASE_HEIGHT * aspect / 2; c.right = BASE_HEIGHT * aspect / 2;
    c.top = BASE_HEIGHT / 2; c.bottom = -BASE_HEIGHT / 2;
    // Shift the picture into the area above the control bar (screen space, so it holds at any zoom).
    c.setViewOffset(1000, 1000, 500 * insetRight, 500 * inset, 1000, 1000);
    c.updateProjectionMatrix();
  }

  // Orthographic view height that fits the model box at this angle, in the area above the control bar.
  fit(az, el, margin, box = this.box) {
    const b = box;
    const centre = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const d = direction(az, el);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
    const up = new THREE.Vector3().crossVectors(d, right);
    let rx = 0; let uy = 0;
    for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
      const v = new THREE.Vector3(x, y, z).sub(centre);
      rx = Math.max(rx, Math.abs(v.dot(right))); uy = Math.max(uy, Math.abs(v.dot(up)));
    }
    return { target: centre, az, el, h: Math.max(2 * uy / (1 - this.inset), (2 * rx) / this.aspect) * margin };
  }

  local(az, el, span) {
    // span = metres visible across the narrower side of the free view
    const h = Math.max(span, span / this.aspect) / (1 - this.inset);
    return { target: this.focus.clone(), az, el, h };
  }

  // Presets of Part II frame the world or the focused city instead of the single chunk.
  preset(name) {
    if (this.scenePreset) return this.scenePreset(name);
    if (name === 'terrain') return this.fit(deg(28), deg(30), 1.16);
    if (name === 'plan') return this.fit(deg(38), deg(70), 1.04);
    if (name === 'close') return this.local(deg(44), deg(34), 420);
    // Axonometric: one fixed scale and height range, so that chunks of different cities can be compared.
    return this.fit(deg(45), deg(32), 1.06, { ...this.box, minY: -40, maxY: 220 });
  }

  // Part II: fixed direction; the view eases out as the recorded world grows.
  worldPose(t) {
    const direction45 = [deg(45), deg(36)];
    const { cases } = this.worldKeys;
    const open = cases?.find(item => t >= item.t && t < item.t + item.span) ?? (cases && t >= cases[0].t ? cases.at(-1) : null);
    if (open) return this.fit(deg(32), deg(44), 1.18, open.box);
    const keys = this.worldKeys.keys;
    if (t <= keys[0].t) return this.fit(...direction45, 1.1, keys[0].box);
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i].t) return mixPose(this.fit(...direction45, 1.1, keys[i - 1].box), this.fit(...direction45, 1.1, keys[i].box), ease((t - keys[i - 1].t) / (keys[i].t - keys[i - 1].t)));
    }
    return this.fit(...direction45, 1.1, keys.at(-1).box);
  }

  filmPose(t) {
    if (t >= PART_ONE_END) return this.worldKeys ? this.worldPose(t) : this.current();
    const [terrain, analysis, roads, blocks, parcels, buildings] = STAGE_START;
    const keys = [
      [terrain, this.fit(deg(28), deg(30), 1.3)],
      [analysis - 1, this.fit(deg(36), deg(34), 1.14)],
      [analysis + 1.5, this.fit(deg(38), deg(66), 1.06)],
      [roads, this.fit(deg(38), deg(66), 1.06)],
      [roads + 2.5, this.fit(deg(38), deg(54), 1.06)],
      [blocks + 2, this.fit(deg(38), deg(54), 1.06)],
      [blocks + 6.8, this.local(deg(38), deg(58), 640)],
      [parcels + 4, this.local(deg(38), deg(62), 340)],
      [buildings, this.local(deg(38), deg(62), 340)],
      [buildings + 4, this.local(deg(44), deg(36), 380)],
      [buildings + 8, this.local(deg(48), deg(34), 620)],
      [buildings + 12.8, this.fit(deg(52), deg(32), 1.06)],
    ];
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) return mixPose(keys[i - 1][1], keys[i][1], ease((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])));
    }
    return keys.at(-1)[1];
  }

  apply(pose) {
    const c = this.camera;
    c.zoom = BASE_HEIGHT / pose.h;
    c.position.copy(pose.target).addScaledVector(direction(pose.az, pose.el), DISTANCE);
    c.up.set(0, 1, 0);
    c.lookAt(pose.target);
    c.updateProjectionMatrix();
    this.controls.target.copy(pose.target);
  }

  current() {
    const c = this.camera;
    const offset = c.position.clone().sub(this.controls.target).normalize();
    return { target: this.controls.target.clone(), az: Math.atan2(offset.x, offset.z), el: Math.asin(Math.min(1, offset.y)), h: BASE_HEIGHT / c.zoom };
  }

  // Switch view through a short move (never a cut), unless motion is off.
  moveTo(mode, poseOf, instant) {
    this.mode = mode;
    this.tween = instant ? null : { from: this.current(), start: performance.now(), duration: 700, poseOf };
    if (instant) this.apply(poseOf());
  }

  release() { this.mode = 'free'; this.tween = null; }

  // Returns true while the view is changing.
  update(t, now) {
    this.controls.enabled = !this.tween;
    if (this.tween) {
      const k = (now - this.tween.start) / this.tween.duration;
      this.apply(mixPose(this.tween.from, this.tween.poseOf(), ease(k)));
      if (k >= 1) this.tween = null;
      return true;
    }
    if (this.mode === 'film') { this.apply(this.filmPose(t)); return true; }
    return false;
  }
}
