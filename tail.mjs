// PodMint's hash-tail helper: finds a nonce (decimal digits) such that keccak256 of the UTF-8 string "<prefix><nonce>"
// starts with <bits> zero bits, on every CPU core. Plain Node.js (18 or later), nothing to install.
//
//   node tail.mjs "<prefix>" <bits> [threads]
//
// A solo lock's prefix is "<attempt>:<lock>:<answer>:", a relay baton's "<round>:<index>:<answer>:<previous nonce>:<your
// wallet, lower case>:". The answer goes in lower case, as you submit it. Prints {"nonce", "hash", "seconds"}.
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

// ---- keccak-256 (the original Keccak padding, as Ethereum uses; not NIST SHA3-256), on 32-bit halves of each lane
const RC = [], ROT = new Array(25).fill(0), PI = new Array(25).fill(0);
{
  let r = 1;
  const bit = () => { const b = r & 1; r = (r << 1) ^ (r & 0x80 ? 0x171 : 0); return b; };
  for (let i = 0; i < 24; i++) {
    let lo = 0, hi = 0;
    for (let j = 0; j < 7; j++) if (bit()) { const k = (1 << j) - 1; if (k < 32) lo |= 1 << k; else hi |= 1 << (k - 32); }
    RC.push(lo >>> 0, hi >>> 0);
  }
  let x = 1, y = 0;
  for (let t = 0; t < 24; t++) {
    ROT[x + 5 * y] = ((t + 1) * (t + 2) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  for (let x2 = 0; x2 < 5; x2++) for (let y2 = 0; y2 < 5; y2++) PI[x2 + 5 * y2] = y2 + 5 * ((2 * x2 + 3 * y2) % 5);
}
const S = new Uint32Array(50), B = new Uint32Array(50), C = new Uint32Array(10);
function permute() {
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      C[2 * x] = S[2 * x] ^ S[2 * x + 10] ^ S[2 * x + 20] ^ S[2 * x + 30] ^ S[2 * x + 40];
      C[2 * x + 1] = S[2 * x + 1] ^ S[2 * x + 11] ^ S[2 * x + 21] ^ S[2 * x + 31] ^ S[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const p = (x + 4) % 5, n = (x + 1) % 5;
      const dl = C[2 * p] ^ ((C[2 * n] << 1) | (C[2 * n + 1] >>> 31)), dh = C[2 * p + 1] ^ ((C[2 * n + 1] << 1) | (C[2 * n] >>> 31));
      for (let y = 0; y < 25; y += 5) { S[2 * (x + y)] ^= dl; S[2 * (x + y) + 1] ^= dh; }
    }
    for (let i = 0; i < 25; i++) {
      const lo = S[2 * i], hi = S[2 * i + 1], r = ROT[i], j = 2 * PI[i];
      if (r === 0) { B[j] = lo; B[j + 1] = hi; }
      else if (r < 32) { B[j] = (lo << r) | (hi >>> (32 - r)); B[j + 1] = (hi << r) | (lo >>> (32 - r)); }
      else if (r === 32) { B[j] = hi; B[j + 1] = lo; }
      else { const m = r - 32; B[j] = (hi << m) | (lo >>> (32 - m)); B[j + 1] = (lo << m) | (hi >>> (32 - m)); }
    }
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) {
      const a = 2 * (x + y), b = 2 * ((x + 1) % 5 + y), c = 2 * ((x + 2) % 5 + y);
      S[a] = B[a] ^ (~B[b] & B[c]); S[a + 1] = B[a + 1] ^ (~B[b + 1] & B[c + 1]);
    }
    S[0] ^= RC[2 * round]; S[1] ^= RC[2 * round + 1];
  }
}
const RATE = 136;
/** keccak256 of bytes; returns the state, whose first 8 words are the digest (little-endian 32-bit words). */
export function keccak(bytes) {
  S.fill(0);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 4; i++) S[i] ^= padded[off + 4 * i] | (padded[off + 4 * i + 1] << 8) | (padded[off + 4 * i + 2] << 16) | (padded[off + 4 * i + 3] << 24);
    permute();
  }
  return S;
}
export const hex = s => '0x' + Array.from({length: 32}, (_, i) => ((s[i >> 2] >>> (8 * (i & 3))) & 255).toString(16).padStart(2, '0')).join('');
/** Leading zero bits of the digest. */
function zeros(s) {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const w = s[i];
    for (let k = 0; k < 4; k++) { const b = (w >>> (8 * k)) & 255; if (b) return n + Math.clz32(b) - 24; n += 8; }
  }
  return n;
}

const enc = new TextEncoder();
function search(prefix, bits, start, step, report) {
  const head = enc.encode(prefix);
  for (let n = start, tried = 0; ; n += step) {
    const tail = enc.encode(String(n)), buf = new Uint8Array(head.length + tail.length);
    buf.set(head); buf.set(tail, head.length);
    const s = keccak(buf);
    if (zeros(s) >= bits) return {nonce: String(n), hash: hex(s)};
    if (++tried % 200_000 === 0) report(200_000);
  }
}

if (!isMainThread) {
  const {prefix, bits, start, step} = workerData;
  parentPort.postMessage({found: search(prefix, bits, start, step, k => parentPort.postMessage({tried: k}))});
} else if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [prefix, bitsArg, threadsArg] = process.argv.slice(2);
  const bits = Number(bitsArg), threads = Math.max(1, Number(threadsArg) || availableParallelism());
  if (typeof prefix !== 'string' || !prefix.endsWith(':') || !Number.isInteger(bits) || bits < 1 || bits > 64) {
    console.error('usage: node tail.mjs "<prefix ending in :>" <bits> [threads]');
    process.exit(2);
  }
  const t0 = Date.now();
  let tried = 0;
  const workers = Array.from({length: threads}, (_, i) => new Worker(new URL(import.meta.url), {workerData: {prefix, bits, start: i, step: threads}}));
  const tick = setInterval(() => process.stderr.write(`\r${(tried / 1e6).toFixed(1)}M tried, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${threads} threads; expected ~${(2 ** bits / 1e6).toFixed(1)}M`), 2000);
  let done = false;
  for (const w of workers) w.on('message', m => {
    if (m.tried) { tried += m.tried; return; }
    if (done) return;   // two threads may finish at once: the first one counts
    done = true;
    clearInterval(tick);
    process.stderr.write('\n');
    console.log(JSON.stringify({...m.found, seconds: Math.round((Date.now() - t0) / 100) / 10}));
    for (const x of workers) x.terminate();
  });
}
