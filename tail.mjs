// PodMint hash-tail miner: finds a nonce (decimal digits) such that keccak256 of "<prefix><nonce>"
// starts with <bits> zero bits, utilizing all available CPU cores.
// Requires Node.js 18+. Zero external npm dependencies.
//
// Usage:
//   node tail.mjs "<prefix>" <bits> [threads]
//
// Solo prefix:   "<attempt>:<lock>:<answer>:"
// Relay prefix:  "<round>:<index>:<answer>:<previous_nonce>:<wallet_address>:"
// Output format: {"nonce": "...", "hash": "0x...", "seconds": ...}

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

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

function countLeadingZeroBits(buf, maxBits) {
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0) {
      count += 8;
      if (count >= maxBits) return count;
    } else {
      let b = byte;
      if ((b & 0xf0) === 0) { count += 4; b <<= 4; }
      if ((b & 0xc0) === 0) { count += 2; b <<= 2; }
      if ((b & 0x80) === 0) { count += 1; }
      return count;
    }
  }
  return count;
}

if (!isMainThread) {
  const { prefixBytes, targetBits, startNonce, stride, sharedFound } = workerData;
  const pLen = prefixBytes.length;
  const inBuf = new Uint8Array(pLen + 32);
  inBuf.set(prefixBytes);

  const foundArr = new Int32Array(sharedFound);
  let nonce = BigInt(startNonce);
  const step = BigInt(stride);

  const textEnc = new TextEncoder();
  const rateBytes = 136; // Keccak-256 rate: 1088 bits = 136 bytes

  while (Atomics.load(foundArr, 0) === 0) {
    for (let batch = 0; batch < 10000; batch++) {
      const nStr = nonce.toString();
      const nBytes = textEnc.encode(nStr);
      const totalLen = pLen + nBytes.length;

      // Pack into input buffer
      inBuf.set(nBytes, pLen);

      // Keccak pad
      S.fill(0);
      let offset = 0;
      while (totalLen - offset >= rateBytes) {
        for (let i = 0; i < rateBytes / 4; i++) {
          const idx = offset + i * 4;
          S[i] ^= inBuf[idx] | (inBuf[idx + 1] << 8) | (inBuf[idx + 2] << 16) | (inBuf[idx + 3] << 24);
        }
        permute();
        offset += rateBytes;
      }

      // Final block with 0x01 ... 0x80 pad
      const rem = totalLen - offset;
      const finalBuf = new Uint8Array(rateBytes);
      finalBuf.set(inBuf.subarray(offset, totalLen));
      finalBuf[rem] ^= 0x01;
      finalBuf[rateBytes - 1] ^= 0x80;

      for (let i = 0; i < rateBytes / 4; i++) {
        const idx = i * 4;
        S[i] ^= finalBuf[idx] | (finalBuf[idx + 1] << 8) | (finalBuf[idx + 2] << 16) | (finalBuf[idx + 3] << 24);
      }
      permute();

      // Check leading zero bits from S[0..7]
      const outBuf = new Uint8Array(32);
      for (let i = 0; i < 8; i++) {
        const w = S[i];
        outBuf[i * 4] = w & 0xff;
        outBuf[i * 4 + 1] = (w >>> 8) & 0xff;
        outBuf[i * 4 + 2] = (w >>> 16) & 0xff;
        outBuf[i * 4 + 3] = (w >>> 24) & 0xff;
      }

      const lz = countLeadingZeroBits(outBuf, targetBits);
      if (lz >= targetBits) {
        if (Atomics.compareExchange(foundArr, 0, 0, 1) === 0) {
          const hex = '0x' + Array.from(outBuf).map(b => b.toString(16).padStart(2, '0')).join('');
          parentPort.postMessage({ nonce: nStr, hash: hex });
        }
        return;
      }
      nonce += step;
    }
  }
} else {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node tail.mjs "<prefix>" <target_bits> [threads]');
    process.exit(1);
  }

  const prefix = args[0];
  const targetBits = parseInt(args[1], 10);
  const numThreads = args[2] ? parseInt(args[2], 10) : availableParallelism();

  const prefixBytes = new TextEncoder().encode(prefix);
  const sharedFound = new SharedArrayBuffer(4);
  const startTime = Date.now();

  const workers = [];
  for (let i = 0; i < numThreads; i++) {
    const w = new Worker(new URL(import.meta.url), {
      workerData: {
        prefixBytes,
        targetBits,
        startNonce: i * 100000000 + Math.floor(Math.random() * 1000000),
        stride: 1,
        sharedFound
      }
    });

    w.on('message', (msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(JSON.stringify({
        nonce: msg.nonce,
        hash: msg.hash,
        seconds: parseFloat(elapsed),
        threads: numThreads
      }));
      for (const other of workers) {
        other.terminate();
      }
      process.exit(0);
    });

    workers.push(w);
  }
}
