// WEB-01e: records Part II of the film for the Recorded Film view. Each frame is the real Live 3D render at a fixed t, rendered one by one in Chrome,
// so video time = film t − 52 s. Encoding is H.264 in the page (WebCodecs + mp4-muxer from a pinned CDN URL, only here, never at runtime). FFmpeg is not needed.
// Quality check: the finished file is decoded in the page and compared with live renders at the same t.
// Usage: node scripts/record-film-part2.mjs   Output: experiments/procedural-film/world/part2-film.mp4
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5196; const W = 1280; const H = 720; const FPS = 30; const START = 52; const END = 122; const BITRATE = 1_400_000;
const out = path.join(root, 'experiments/procedural-film/world/part2-film.mp4');
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', windowsHide: true });
await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('Local')) resolve(); }); setTimeout(() => reject(new Error('vite timeout')), 60000); });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/experiments/procedural-film/index.html?view=explore&autoplay=0&capture=1&level=live&t=60`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__film?.ready === true && window.__film.worldReady === true, null, { timeout: 300000 });
  await page.evaluate(() => window.__film.seek(110));
  await page.waitForFunction(() => window.__film.casesReady === true, null, { timeout: 300000 });
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js' });
  const started = Date.now();
  const size = await page.evaluate(async ({ W, H, FPS, START, END, BITRATE }) => {
    const gl = document.getElementById('filmCanvas');
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
    let failure = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
    encoder.configure({ codec: 'avc1.64001F', width: W, height: H, bitrate: BITRATE, framerate: FPS, avc: { format: 'avc' } });
    const frames = Math.round((END - START) * FPS);
    for (let i = 0; i < frames; i += 1) {
      const t = START + i / FPS;
      window.__film.seek(t);
      window.__film.render();
      ctx.drawImage(gl, 0, 0, W, H);
      // City names are drawn into the film, as a video cannot hold the live labels.
      ctx.font = '13px Arial'; ctx.textAlign = 'center';
      for (const label of window.__film.labelPositions()) {
        const w = ctx.measureText(label.name).width + 12;
        ctx.fillStyle = 'rgba(247, 245, 240, 0.92)'; ctx.fillRect(label.x - w / 2, label.y - 20, w, 19);
        ctx.fillStyle = '#24252a'; ctx.fillText(label.name, label.x, label.y - 6);
      }
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 8) await new Promise(r => { setTimeout(r, 2); });
      if (failure) throw failure;
    }
    await encoder.flush();
    muxer.finalize();
    window.__recorded = new Uint8Array(muxer.target.buffer);
    return window.__recorded.length;
  }, { W, H, FPS, START, END, BITRATE });
  const text = await page.evaluate(() => { let s = ''; const d = window.__recorded; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return btoa(s); });
  console.log(`recorded ${(size / 1e6).toFixed(1)} MB in ${Math.round((Date.now() - started) / 1000)} s`);

  // Quality check: decoded video against the live render at the same t.
  const qc = await page.evaluate(async ({ W, H, START }) => {
    const blob = new Blob([window.__recorded], { type: 'video/mp4' });
    const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('video does not decode')); });
    const a = document.createElement('canvas'); a.width = W / 2; a.height = H / 2; const ax = a.getContext('2d', { willReadFrequently: true });
    const b = document.createElement('canvas'); b.width = W / 2; b.height = H / 2; const bx = b.getContext('2d', { willReadFrequently: true });
    const results = [];
    for (const t of [59.9, 80, 103.9, 109.9]) {
      video.currentTime = t - START;
      await new Promise(r => { video.onseeked = r; });
      // A seek can finish before the decoder has presented the frame: wait for the frame itself, or the check reads an empty picture.
      await Promise.race([new Promise(r => { video.requestVideoFrameCallback(r); }), new Promise(r => { setTimeout(r, 1000); })]);
      await new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); });
      window.__film.seek(t); window.__film.render();
      ax.drawImage(video, 0, 0, W / 2, H / 2); bx.drawImage(document.getElementById('filmCanvas'), 0, 0, W / 2, H / 2);
      const A = ax.getImageData(0, 0, W / 2, H / 2).data; const B = bx.getImageData(0, 0, W / 2, H / 2).data;
      let sum = 0; for (let i = 0; i < A.length; i += 4) sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      results.push({ t, meanColourDifference: +(sum / (A.length / 4) / 3).toFixed(2) });
    }
    return { duration: +video.duration.toFixed(2), width: video.videoWidth, height: video.videoHeight, frames: results };
  }, { W, H, START });
  console.log(JSON.stringify(qc));
  if (Math.abs(qc.duration - (END - START)) > 0.2 || qc.frames.some(f => f.meanColourDifference > 8)) throw new Error('quality check failed: nothing written');
  await writeFile(out, Buffer.from(text, 'base64')); // written last, and only after the check. Vite reloads the open page when a referenced asset changes
  await writeFile(path.join(root, 'experiments/procedural-film/evidence/part2-film-qc.json'), `${JSON.stringify({ at: new Date().toISOString(), source: 'Live 3D render, one frame per t, world seed 6201 and the controlled experiment', bytes: size, bitrate: BITRATE, ...qc }, null, 1)}\n`);
  console.log('quality check passed');
} finally { await browser.close(); server.kill(); }
process.exit(0);
