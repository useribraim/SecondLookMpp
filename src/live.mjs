// One view-only capture per search, shared by all authorized viewers.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 25_000;
const CAPTURE_SCRIPT = new URL('../sandbox/capture_preview.mjs', import.meta.url);
const CAPTURE_CODE = readFileSync(CAPTURE_SCRIPT).toString('base64');

export function liveCaptureAvailable(env = process.env) {
  return Boolean(env.BOAT_SANDBOX_ID || env.FACEBOOK_COLLECTOR_DIR) && env.LIVE_VIEW !== '0';
}

export function startLiveCapture(env = process.env, { testPattern = false } = {}) {
  const viewers = new Set();
  const boat = env.BOAT_BIN ?? `${homedir()}/.ascii/bin/boat`;
  const remote = !env.FACEBOOK_COLLECTOR_DIR;
  let latest;
  let child;
  let finished = false;

  function stopCapture() {
    if (!child) return;
    const { running, captureId } = child;
    child = undefined;
    running.kill();
    if (remote) {
      // Closing the CLI subscription alone leaves the remote command running.
      const cleanup = spawn(boat, ['exec', env.BOAT_SANDBOX_ID, '--no-update', '--timeout', '6',
        `for attempt in 1 2 3 4 5 6 7 8 9 10; do pkill -TERM -f '^${captureId}$' && exit 0; sleep 0.2; done`],
      { stdio: 'ignore' });
      cleanup.on('error', () => {});
    }
  }

  function startCapture() {
    if (child || finished) return;
    const args = testPattern ? ['--test-pattern'] : [];
    const captureId = 'car-preview-' + randomBytes(12).toString('hex');
    const remoteCommand = `printf '%s' '${CAPTURE_CODE}' | base64 -d | node --input-type=module - ${captureId} ${args.join(' ')}`;
    const running = remote
      ? spawn(boat,
          ['exec', env.BOAT_SANDBOX_ID, '--no-update', '--stream', '--json', '--timeout', '600', remoteCommand],
          { stdio: ['ignore', 'pipe', 'ignore'] })
      : spawn(process.execPath, [fileURLToPath(CAPTURE_SCRIPT), ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    child = { running, captureId };
    let partial = '';
    function accept(line) {
      const match = /^(\d{13}) ([A-Za-z0-9+/=]{1,33336})$/.exec(line);
      if (!match) return;
      const at = Number(match[1]);
      if (Date.now() - at > 350) return;
      const jpeg = Buffer.from(match[2], 'base64');
      if (jpeg.length > MAX_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
          jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) return;
      // Stream records are a 4-byte length, 8-byte timestamp, and the JPEG.
      const packet = Buffer.allocUnsafe(12 + jpeg.length);
      packet.writeUInt32BE(jpeg.length);
      packet.writeDoubleBE(at, 4);
      jpeg.copy(packet, 12);
      latest = { jpeg, at, packet };
      for (const wake of viewers) wake();
    }
    const lines = createInterface({ input: running.stdout });
    lines.on('line', (line) => {
      if (child?.running !== running) return;
      if (!remote) return accept(line);
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type !== 'stdout' || typeof message.data !== 'string') return;
      const frames = (partial + message.data).split('\n');
      partial = frames.pop();
      if (partial.length > 34_000) partial = '';
      for (const frame of frames) accept(frame);
    });
    running.once('error', () => {});
    running.once('close', () => {
      if (child?.running !== running) return;
      stopCapture();
      for (const wake of viewers) wake();
    });
  }

  return {
    latest: () => latest,
    finished: () => finished,
    stream() {
      let controller;
      let waiting;
      let last;
      function unsubscribe() {
        viewers.delete(wake);
        if (!viewers.size) stopCapture();
        waiting?.();
        waiting = undefined;
      }
      function wake() {
        if (!child || finished) {
          controller.close();
          unsubscribe();
        } else {
          waiting?.();
          waiting = undefined;
        }
      }
      return new ReadableStream({
        start(streamController) {
          controller = streamController;
          viewers.add(wake);
          startCapture();
        },
        async pull() {
          if (latest === last || !latest || Date.now() - latest.at > 350) {
            await new Promise((resolve) => { waiting = resolve; });
          }
          if (!viewers.has(wake) || latest === last || !latest) return;
          last = latest;
          controller.enqueue(latest.packet);
        },
        cancel: unsubscribe,
      }, { highWaterMark: 0 });
    },
    finish() {
      finished = true;
      stopCapture();
      for (const wake of viewers) wake();
    },
  };
}
