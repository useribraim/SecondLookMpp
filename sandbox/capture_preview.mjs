// Run inside Boat. Only the cropped, size-checked JPEGs leave the sandbox.
import { spawn, spawnSync } from 'node:child_process';

const MAX_BYTES = 25_000;
const fps = 15;
const captureId = process.argv.find((arg) => /^car-preview-[a-f0-9]{24}$/.test(arg));
if (captureId) process.title = captureId;
const input = process.argv.includes('--test-pattern')
  ? ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=1920x800:rate=15']
  : ['-f', 'x11grab', '-framerate', String(fps), '-draw_mouse', '0',
      '-video_size', '1920x800', '-i', ':0.0+0,180'];
const capture = spawn('ffmpeg', [
  '-nostdin', '-loglevel', 'error', ...input, '-an',
  '-filter_threads', '1', '-vf', 'scale=960:-2', '-threads', '1',
  '-c:v', 'mjpeg', '-q:v', '12', '-f', 'image2pipe', 'pipe:1',
], { stdio: ['ignore', 'pipe', 'inherit'] });

process.on('SIGTERM', () => capture.kill());
process.stdout.on('error', () => capture.kill());
capture.on('error', (error) => console.error(error.message));

let pending = Buffer.alloc(0);
let nextFrameAt = 0;
capture.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  let end;
  while ((end = pending.indexOf(Buffer.from([0xff, 0xd9]))) !== -1) {
    let jpeg = pending.subarray(0, end + 2);
    pending = pending.subarray(end + 2);
    const at = Date.now();
    if (at < nextFrameAt || process.stdout.writableNeedDrain) continue;
    if (jpeg.length > MAX_BYTES) {
      const smaller = spawnSync('convert', ['jpeg:-', '-strip', '-quality', '35', 'jpeg:-'], {
        input: jpeg, maxBuffer: 100_000, timeout: 45,
      });
      jpeg = smaller.status === 0 ? smaller.stdout : Buffer.alloc(0);
    }
    if (!jpeg.length || jpeg.length > MAX_BYTES || Date.now() - at >= 1000 / fps) continue;
    // Accept normal timing jitter, but never send a burst of queued frames.
    nextFrameAt = at + 30;
    process.stdout.write(at + ' ' + jpeg.toString('base64') + '\n');
  }
  if (pending.length > 512_000) capture.kill();
});
