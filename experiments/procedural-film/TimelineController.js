import { DURATION, STAGES, STAGE_START, stageAt, stageEnd } from './stageManifest.js';

// WEB-01 Timeline: the whole film is a pure function of t (presentation time), so play, pause, scrub, replay and speed never touch the model.
// The rate scales real elapsed time, not frames, and t is clamped at the end, so every speed reaches the same final state.
export class TimelineController {
  constructor(onChange) { this.t = 0; this.playing = false; this.rate = 1; this.onChange = onChange; this.holdFor = 0; this.stepped = false; }

  emit() { this.onChange(this); }
  seek(t) { this.t = Math.min(DURATION, Math.max(0, t)); this.emit(); }
  play() { if (this.t >= DURATION) this.t = 0; this.playing = true; this.emit(); }
  pause() { this.playing = false; this.emit(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  restart() { this.t = this.stepped ? stageEnd(0) : 0; this.holdFor = 0; this.emit(); }
  get stage() { return stageAt(Math.min(this.t, DURATION - 0.001)); }

  // Playing: enter that stage from its start. Paused or static: show the finished state of that stage.
  goToStage(k) {
    const stage = Math.min(STAGES.length - 1, Math.max(0, k));
    this.t = this.playing && !this.stepped ? STAGE_START[stage] : stageEnd(stage);
    this.holdFor = 0;
    this.emit();
  }

  // stepped = static viewing (reduced motion): each stage is shown finished for a few seconds, without animation.
  tick(dt) {
    if (!this.playing || this.blocked) return; // blocked: the next scene's data is still loading, the film waits instead of showing nothing
    if (this.stepped) {
      this.holdFor += dt * this.rate;
      if (this.holdFor < 4) return;
      this.holdFor = 0;
      if (this.stage >= STAGES.length - 1) { this.pause(); return; }
      this.t = stageEnd(this.stage + 1);
      this.emit();
      return;
    }
    this.t += dt * this.rate;
    if (this.t >= DURATION) { this.t = DURATION; this.playing = false; }
    this.emit();
  }
}
