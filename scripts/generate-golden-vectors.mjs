#!/usr/bin/env node
/**
 * Generate the golden-vector JSON file used by both the Rust crypto tests
 * and the extension's regression suite.
 *
 * The script runs the EXACT same code path as the browser extension's
 * service worker (hash-wasm Argon2id + identical rendering and fingerprint
 * routines) and emits a JSON file with `{inputs, profile, expected}`
 * triplets. The Rust port is then validated against this file.
 *
 * Re-run whenever the algorithm or its parameters change (an event that
 * is, by design, a breaking change for every existing user — see the
 * design doc).
 *
 * Usage:
 *   node scripts/generate-golden-vectors.mjs > tests/golden-vectors.json
 */

import { argon2id } from "hash-wasm";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const extensionRoot = resolve(repoRoot, "../extension");

// We dynamically import the extension's TypeScript modules via ts-node-like
// trickery: read the wordlist file as text and extract the words. This keeps
// the script free of build steps.
import { readFileSync } from "node:fs";
const wordlistTs = readFileSync(
  resolve(extensionRoot, "src/background/crypto/wordlist.ts"),
  "utf8",
);
const EFF_LARGE_WORDLIST = [];
for (const line of wordlistTs.split("\n")) {
  const m = line.match(/^\s*"([a-z][a-z-]*)",?\s*$/);
  if (m) EFF_LARGE_WORDLIST.push(m[1]);
}
if (EFF_LARGE_WORDLIST.length !== 7776) {
  throw new Error(`expected 7776 words, got ${EFF_LARGE_WORDLIST.length}`);
}

const ARGON2_PARAMS = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};
const FINGERPRINT_PARAMS = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 16,
};
const FINGERPRINT_SALT = new TextEncoder().encode("keyfount:verify");

const POOL_LOWER = "abcdefghijklmnopqrstuvwxyz";
const POOL_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const POOL_DIGITS = "0123456789";
const POOL_SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

function normalise(inputs) {
  return {
    master: inputs.master,
    domain: inputs.domain.trim().toLowerCase(),
    email: inputs.email.trim().toLowerCase(),
  };
}

function buildSalt(domain, email, counter) {
  return new TextEncoder().encode(`${domain}${email}${counter.toString(16)}`);
}

async function deriveBits(master, salt) {
  const hex = await argon2id({
    password: master,
    salt,
    ...ARGON2_PARAMS,
    outputType: "hex",
  });
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function enabledPools(profile) {
  const pools = [];
  if (profile.lower) pools.push(POOL_LOWER);
  if (profile.upper) pools.push(POOL_UPPER);
  if (profile.digits) pools.push(POOL_DIGITS);
  if (profile.symbols) pools.push(POOL_SYMBOLS);
  return { pools, combined: pools.join("") };
}

function consumeEntropy(entropy, pool, length) {
  const poolSize = BigInt(pool.length);
  let value = entropy;
  let out = "";
  for (let i = 0; i < length; i++) {
    const r = Number(value % poolSize);
    value /= poolSize;
    out += pool[r];
  }
  return { consumed: out, remaining: value };
}

function insertPseudoRandomly(base, extra, entropy) {
  let result = base;
  let value = entropy;
  for (const c of extra) {
    const positionCount = BigInt(result.length + 1);
    const position = Number(value % positionCount);
    value /= positionCount;
    result = result.slice(0, position) + c + result.slice(position);
  }
  return { result, remaining: value };
}

function renderRandom(entropy, profile) {
  const { pools, combined } = enabledPools(profile);
  const bulk = consumeEntropy(entropy, combined, profile.length - pools.length);
  let entropyAfter = bulk.remaining;
  let oneOfEach = "";
  for (const pool of pools) {
    const step = consumeEntropy(entropyAfter, pool, 1);
    oneOfEach += step.consumed;
    entropyAfter = step.remaining;
  }
  return insertPseudoRandomly(bulk.consumed, oneOfEach, entropyAfter).result;
}

const SUFFIX_DIGITS = "0123456789";
const SUFFIX_SYMBOLS = "!@#$%^&*?";

function renderMemorable(entropy, profile) {
  const poolSize = BigInt(EFF_LARGE_WORDLIST.length);
  let value = entropy;
  const words = [];
  for (let i = 0; i < profile.wordCount; i++) {
    const idx = Number(value % poolSize);
    value /= poolSize;
    words.push(EFF_LARGE_WORDLIST[idx]);
  }
  if (profile.capitalise) {
    const positionCount = BigInt(words.length);
    const pos = Number(value % positionCount);
    value /= positionCount;
    words[pos] = words[pos].charAt(0).toUpperCase() + words[pos].slice(1);
  }
  let result = words.join(profile.separator);
  if (profile.suffix) {
    const d = consumeEntropy(value, SUFFIX_DIGITS, 1);
    const s = consumeEntropy(d.remaining, SUFFIX_SYMBOLS, 1);
    result += d.consumed + s.consumed;
  }
  return result;
}

async function derivePassword(inputs, profile) {
  const n = normalise(inputs);
  const salt = buildSalt(n.domain, n.email, profile.counter);
  const bytes = await deriveBits(n.master, salt);
  const entropy = bytesToBigInt(bytes);
  if (profile.mode === "random") return renderRandom(entropy, profile);
  return renderMemorable(entropy, profile);
}

async function fingerprint(master) {
  const hex = await argon2id({
    password: master,
    salt: FINGERPRINT_SALT,
    ...FINGERPRINT_PARAMS,
    outputType: "hex",
  });
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

const RANDOM_DEFAULT = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
};
const MEMORABLE_DEFAULT = {
  mode: "memorable",
  wordCount: 6,
  separator: ".",
  capitalise: true,
  suffix: true,
  counter: 1,
};

const cases = [
  // Random defaults
  {
    label: "random-default-c1",
    inputs: { master: "hunter2hunter2", domain: "example.com", email: "alice@example.com" },
    profile: RANDOM_DEFAULT,
  },
  {
    label: "random-default-c2",
    inputs: { master: "hunter2hunter2", domain: "example.com", email: "alice@example.com" },
    profile: { ...RANDOM_DEFAULT, counter: 2 },
  },
  {
    label: "random-no-symbols",
    inputs: {
      master: "correct horse battery staple",
      domain: "github.com",
      email: "alice@example.com",
    },
    profile: { ...RANDOM_DEFAULT, symbols: false, length: 20 },
  },
  {
    label: "random-lowercase-only-min",
    inputs: { master: "tr0ub4dor", domain: "example.org", email: "bob@example.org" },
    profile: {
      mode: "random",
      length: 5,
      lower: true,
      upper: false,
      digits: false,
      symbols: false,
      counter: 1,
    },
  },
  {
    label: "random-all-classes-max",
    inputs: {
      master: "Z" + "z".repeat(40),
      domain: "long-domain-name.example",
      email: "user@example.com",
    },
    profile: { ...RANDOM_DEFAULT, length: 35 },
  },
  {
    label: "random-mixed-case",
    inputs: { master: "MyMaster", domain: "Example.COM", email: "Alice@Example.com" },
    profile: RANDOM_DEFAULT,
  },
  // Memorable
  {
    label: "memorable-default",
    inputs: { master: "hunter2hunter2", domain: "example.com", email: "alice@example.com" },
    profile: MEMORABLE_DEFAULT,
  },
  {
    label: "memorable-no-suffix-no-cap",
    inputs: { master: "hunter2hunter2", domain: "example.com", email: "alice@example.com" },
    profile: { ...MEMORABLE_DEFAULT, capitalise: false, suffix: false },
  },
  {
    label: "memorable-5-words-dash",
    inputs: {
      master: "correct horse battery staple",
      domain: "github.com",
      email: "alice@example.com",
    },
    profile: { ...MEMORABLE_DEFAULT, wordCount: 5, separator: "-" },
  },
  {
    label: "memorable-8-words-underscore",
    inputs: {
      master: "correct horse battery staple",
      domain: "github.com",
      email: "alice@example.com",
    },
    profile: { ...MEMORABLE_DEFAULT, wordCount: 8, separator: "_" },
  },
];

const out = { cases: [], fingerprints: [] };

for (const c of cases) {
  process.stderr.write(`* deriving ${c.label}\n`);
  const password = await derivePassword(c.inputs, c.profile);
  out.cases.push({
    label: c.label,
    inputs: c.inputs,
    profile: c.profile,
    expected_password: password,
  });
}

const fpMasters = ["hunter2hunter2", "correct horse battery staple", "MyMaster", "Z".repeat(60)];
for (const m of fpMasters) {
  process.stderr.write(`* fingerprinting ${m.slice(0, 12)}…\n`);
  const bytes = await fingerprint(m);
  out.fingerprints.push({ master: m, expected_bytes: bytes });
}

const target = resolve(repoRoot, "tests/golden-vectors.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "utf8");
process.stderr.write(
  `✓ wrote ${out.cases.length} cases + ${out.fingerprints.length} fingerprints to ${target}\n`,
);
