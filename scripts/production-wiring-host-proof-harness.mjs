#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST_PROOF_HARNESS_VERSION = 1;
export const CLOSURE_OS_AUTHORITY_ADAPTER_ID = 'deckent-closure-os-authority-gate-v1';
export const CLOSURE_OS_AUTHORITY_OBSERVATION_GROUP_ID = 'deckent:closure-os-authority-gate';
export const CLOSURE_OS_AUTHORITY_SCHEMA_ID = 'deckent.host-proof.closure-os-authority-gate.v1';
export const TERMINAL_NATIVE_PROVIDER_ADAPTER_ID = 'deckent-terminal-native-provider-resolution-v1';
export const TERMINAL_NATIVE_PROVIDER_OBSERVATION_GROUP_ID = 'deckent:terminal-native-provider-resolution';
export const TERMINAL_NATIVE_PROVIDER_SCHEMA_ID = 'deckent.host-proof.terminal-native-provider-resolution.v1';
export const MEMORY_COMPACT_READ_EXPORT_ADAPTER_ID = 'deckent-memory-compact-read-export-v1';
export const MEMORY_COMPACT_READ_EXPORT_OBSERVATION_GROUP_ID = 'deckent:memory-compact-read-export';
export const MEMORY_COMPACT_READ_EXPORT_SCHEMA_ID = 'deckent.host-proof.memory-compact-read-export.v1';

const REQUEST_KIND = 'deckent-production-wiring-host-proof-request-v1';
const OUTCOME_KIND = 'deckent-production-wiring-host-proof-outcome';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const TERMINATION_GRACE_MS = 500;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CLOSURE_GATE_SUCCESS = /^\[closure-gate\] OK — [1-9][0-9]* events, chain \+ identity \+ lifecycle \+ append-only verified\n?$/u;

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

const CLOSURE_OS_REQUIRED_ASSETS = Object.freeze([
  Object.freeze({
    path: 'scripts/production-wiring-host-proof-harness.mjs',
    role: 'trusted-harness',
  }),
  Object.freeze({ path: 'scripts/lint-closure-dispositions.mjs', role: 'config-authority' }),
  Object.freeze({ path: 'scripts/closure-ledger/canonical.mjs', role: 'config-authority' }),
  Object.freeze({ path: 'scripts/master-plan-integrity.mjs', role: 'config-authority' }),
  Object.freeze({ path: 'scripts/approval-identity.mjs', role: 'config-authority' }),
  Object.freeze({
    path: 'src/core/closure-classification-schema.json',
    role: 'config-authority',
  }),
]);

const CLOSURE_OS_TARGET_KEYS = Object.freeze([
  'affected-ingress:closure-os.ledger-file-ingress',
  'canonical-consumer:closure-os.authority-gate',
  'enablement-authority:closure-os.reviewed-trust-anchor',
  'producer:closure-os.append-only-ledger',
  'proof-target:closure-os.chain-identity-lifecycle-authority',
].sort());

const TERMINAL_NATIVE_PROVIDER_REQUIRED_ASSETS = Object.freeze([
  Object.freeze({ path: 'scripts/production-wiring-host-proof-harness.mjs', role: 'trusted-harness' }),
]);

// The verifier logic lives in this digest-pinned harness, outside the product
// task's write authority. The TypeScript modules are the observed production
// targets, not mutable test or verifier assets. `tsx` is only the loader: it
// receives this exact code-owned program through argv and cannot author the
// assertions, target identity, environment, or acceptance predicate.
const TERMINAL_NATIVE_PROVIDER_OBSERVER_SOURCE = String.raw`
const transport = await import('./src/cli/repl/native-transport.ts');
const core = await import('./src/core/native-provider-names.ts');
if (transport.NATIVE_PROVIDER_NAMES !== core.NATIVE_PROVIDER_NAMES
  || !core.NATIVE_PROVIDER_NAMES.includes('local-llm')) process.exit(41);
const selected = transport.resolveNativeProvider(
  { ANTHROPIC_API_KEY: 'must-not-fallback' },
  { native_provider: 'proof-unsupported-provider' },
  process.cwd(),
);
if (!('error' in selected)
  || selected.errorCode !== 'unsupported-native-provider'
  || selected.provider !== 'proof-unsupported-provider') process.exit(42);
let healthUrl = '';
const health = await transport.probeNativeEndpointHealth(
  'http://127.0.0.1:43110/v1',
  async input => {
    healthUrl = String(input);
    return { ok: true, status: 200 };
  },
);
if (!health.healthy
  || health.endpoint !== 'http://127.0.0.1:43110/v1'
  || healthUrl !== 'http://127.0.0.1:43110/health') process.exit(43);
process.stdout.write(JSON.stringify({ healthUrl, outcome: 'observed', provider: selected.provider }));
`;

const TERMINAL_NATIVE_PROVIDER_TARGET_KEYS = Object.freeze([
  'affected-ingress:deckent.native-terminal.entry',
  'canonical-consumer:deckent.terminal.native-session-provider',
  'enablement-authority:deckent.config.native-provider',
  'producer:deckent.terminal.native-provider-authority-resolver',
  'proof-target:deckent.terminal.native-provider-resolution-execution',
].sort());

const MEMORY_COMPACT_READ_EXPORT_OBSERVER_PATH =
  'scripts/memory-compact-host-proof-observer.mjs';
const MEMORY_COMPACT_READ_EXPORT_REQUIRED_ASSETS = Object.freeze([
  Object.freeze({
    path: 'scripts/production-wiring-host-proof-harness.mjs',
    role: 'trusted-harness',
  }),
  Object.freeze({
    path: MEMORY_COMPACT_READ_EXPORT_OBSERVER_PATH,
    role: 'trusted-harness',
  }),
]);
const MEMORY_COMPACT_READ_EXPORT_TARGET_KEYS = Object.freeze([
  'affected-ingress:deckent.memory-export.write-guarded-exports',
  'canonical-consumer:deckent.memory-export.compact-renderers',
  'enablement-authority:deckent.memory-export.source-preserving-contract',
  'producer:deckent.memory-store.entry-read-model',
  'proof-target:deckent.memory-export.legacy-epoch-recency-grouping',
  'proof-target:deckent.memory-export.meaning-unit-integrity',
  'proof-target:deckent.memory-export.source-preservation',
].sort());
const MEMORY_COMPACT_READ_EXPORT_OBSERVATION = canonicalJson({
  checks: [
    'deterministic-projection',
    'legacy-epoch-recency-grouping',
    'meaning-unit-integrity',
    'source-preservation',
  ],
  kind: 'deckent-memory-compact-read-export-observation-v1',
  outcome: 'observed',
  version: 1,
});

const PROFILES = Object.freeze([
  Object.freeze({
    adapterId: CLOSURE_OS_AUTHORITY_ADAPTER_ID,
    schemaId: CLOSURE_OS_AUTHORITY_SCHEMA_ID,
    observationGroupId: CLOSURE_OS_AUTHORITY_OBSERVATION_GROUP_ID,
    assets: CLOSURE_OS_REQUIRED_ASSETS,
    targetKeys: CLOSURE_OS_TARGET_KEYS,
    observer: 'closure-os',
  }),
  Object.freeze({
    adapterId: TERMINAL_NATIVE_PROVIDER_ADAPTER_ID,
    schemaId: TERMINAL_NATIVE_PROVIDER_SCHEMA_ID,
    observationGroupId: TERMINAL_NATIVE_PROVIDER_OBSERVATION_GROUP_ID,
    assets: TERMINAL_NATIVE_PROVIDER_REQUIRED_ASSETS,
    targetKeys: TERMINAL_NATIVE_PROVIDER_TARGET_KEYS,
    observer: 'terminal-native-provider',
  }),
  Object.freeze({
    adapterId: MEMORY_COMPACT_READ_EXPORT_ADAPTER_ID,
    schemaId: MEMORY_COMPACT_READ_EXPORT_SCHEMA_ID,
    observationGroupId: MEMORY_COMPACT_READ_EXPORT_OBSERVATION_GROUP_ID,
    assets: MEMORY_COMPACT_READ_EXPORT_REQUIRED_ASSETS,
    targetKeys: MEMORY_COMPACT_READ_EXPORT_TARGET_KEYS,
    observer: 'memory-compact-read-export',
  }),
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function safeRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.includes('\0')
    && !path.includes('\\')
    && !path.startsWith('/')
    && path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

function parseRequest(raw) {
  if (typeof raw !== 'string' || raw.length === 0
    || Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (canonicalJson(value) !== raw
    || !exactKeys(value, [
      'version', 'kind', 'adapterId', 'assets', 'timeoutMs', 'outputLimitBytes',
    ])
    || value.version !== HOST_PROOF_HARNESS_VERSION
    || value.kind !== REQUEST_KIND
    || typeof value.adapterId !== 'string'
    || !Number.isSafeInteger(value.timeoutMs)
    || value.timeoutMs < 1
    || value.timeoutMs > MAX_TIMEOUT_MS
    || !Number.isSafeInteger(value.outputLimitBytes)
    || value.outputLimitBytes < 1
    || value.outputLimitBytes > MAX_OUTPUT_BYTES
    || !Array.isArray(value.assets)) return null;
  const profile = PROFILES.find(candidate => candidate.adapterId === value.adapterId);
  if (!profile || value.assets.length !== profile.assets.length) return null;
  const assets = [];
  for (let index = 0; index < profile.assets.length; index += 1) {
    const candidate = value.assets[index];
    const required = profile.assets[index];
    if (!exactKeys(candidate, ['path', 'sha256', 'role'])
      || candidate.path !== required.path
      || candidate.role !== required.role
      || !safeRelativePath(candidate.path)
      || typeof candidate.sha256 !== 'string'
      || !SHA256_PATTERN.test(candidate.sha256)) return null;
    assets.push(Object.freeze({
      path: candidate.path,
      sha256: candidate.sha256,
      role: candidate.role,
    }));
  }
  return Object.freeze({
    version: HOST_PROOF_HARNESS_VERSION,
    kind: REQUEST_KIND,
    adapterId: profile.adapterId,
    profile,
    assets: Object.freeze(assets),
    timeoutMs: value.timeoutMs,
    outputLimitBytes: value.outputLimitBytes,
  });
}

function isInsideRoot(root, candidate) {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..');
}

function readAsset(root, asset) {
  if (!safeRelativePath(asset.path)) return null;
  const absolute = resolve(root, asset.path);
  if (!isInsideRoot(root, absolute)) return null;
  let current = root;
  for (const part of asset.path.split('/').slice(0, -1)) {
    current = join(current, part);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch {
      return null;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null;
  }
  let descriptor;
  try {
    const pathMetadata = lstatSync(absolute);
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.nlink !== 1) {
      return null;
    }
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1
      || before.dev !== pathMetadata.dev || before.ino !== pathMetadata.ino) return null;
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return null;
    const digest = sha256(bytes);
    if (digest !== asset.sha256) return null;
    return Object.freeze({
      path: asset.path,
      sha256: digest,
      role: asset.role,
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
    });
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sameAsset(left, right) {
  return right !== null
    && left.path === right.path
    && left.sha256 === right.sha256
    && left.role === right.role
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

async function runBoundedProcess(input) {
  return new Promise(resolveResult => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let cancelled = input.signal?.aborted === true;
    let error = false;
    let settled = false;
    let forceTimer;
    let child;

    const terminate = () => {
      if (!child) return;
      killTree(child, 'SIGTERM');
      if (forceTimer === undefined) {
        forceTimer = setTimeout(() => killTree(child, 'SIGKILL'), TERMINATION_GRACE_MS);
        forceTimer.unref?.();
      }
    };
    const onAbort = () => { cancelled = true; terminate(); };
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      input.signal?.removeEventListener('abort', onAbort);
      resolveResult(Object.freeze({
        status,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        overflow,
        timedOut,
        cancelled,
        error,
      }));
    };
    const collect = (chunks, currentBytes, chunk) => {
      const remaining = input.outputLimitBytes - currentBytes;
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      if (chunk.byteLength > remaining) {
        overflow = true;
        terminate();
      }
      return currentBytes + Math.min(chunk.byteLength, Math.max(remaining, 0));
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeoutTimer.unref?.();
    try {
      child = spawn(input.executable, input.args, {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.on('data', chunk => {
        stdoutBytes = collect(stdout, stdoutBytes, Buffer.from(chunk));
      });
      child.stderr.on('data', chunk => {
        stderrBytes = collect(stderr, stderrBytes, Buffer.from(chunk));
      });
      child.once('error', () => { error = true; });
      child.once('close', finish);
      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (cancelled) terminate();
    } catch {
      error = true;
      finish(null, null);
    }
  });
}

function processSucceeded(result) {
  return result.status === 0 && result.signal === null && !result.error && !result.overflow
    && !result.timedOut && !result.cancelled;
}

function observedOutcome(profile) {
  return Object.freeze({
    version: HOST_PROOF_HARNESS_VERSION,
    kind: OUTCOME_KIND,
    schemaId: profile.schemaId,
    observationGroupId: profile.observationGroupId,
    outcome: 'observed',
    targetKeys: profile.targetKeys,
  });
}

function observerInvocation(root, request) {
  if (request.profile.observer === 'closure-os') {
    return Object.freeze({
      executable: process.execPath,
      args: [resolve(root, 'scripts/lint-closure-dispositions.mjs')],
      accepts: result => result.stderr.byteLength === 0
        && CLOSURE_GATE_SUCCESS.test(Buffer.from(result.stdout).toString('utf8')),
    });
  }
  if (request.profile.observer === 'terminal-native-provider') {
    return Object.freeze({
      executable: process.execPath,
      args: [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        TERMINAL_NATIVE_PROVIDER_OBSERVER_SOURCE,
      ],
      // Every observation assertion exits with a distinct non-zero status.
      // processSucceeded() is therefore the authoritative predicate; stdout is
      // diagnostic only and never a model-authored success token.
      accepts: result => result.stderr.byteLength === 0,
    });
  }
  if (request.profile.observer === 'memory-compact-read-export') {
    return Object.freeze({
      executable: process.execPath,
      args: [
        '--import',
        'tsx',
        resolve(root, MEMORY_COMPACT_READ_EXPORT_OBSERVER_PATH),
      ],
      accepts: result => result.stderr.byteLength === 0
        && Buffer.from(result.stdout).toString('utf8') === MEMORY_COMPACT_READ_EXPORT_OBSERVATION,
    });
  }
  return null;
}

/**
 * Run one code-owned, read-only product observer. The request can bind current
 * asset digests and resource ceilings; it cannot choose an executable, argv,
 * environment, target set, schema, or success predicate.
 */
export async function runProductionWiringHostProofHarness(rawRequest, options = {}) {
  const request = parseRequest(rawRequest);
  if (!request) return Object.freeze({ state: 'hold', reasonCode: 'host-proof-request-invalid' });
  let root;
  try {
    root = options.root ? realpathSync(options.root) : ROOT;
    if (!statSync(root).isDirectory()) throw new Error('not-directory');
  } catch {
    return Object.freeze({ state: 'hold', reasonCode: 'host-proof-root-unavailable' });
  }
  const initial = new Map();
  for (const asset of request.assets) {
    const snapshot = readAsset(root, asset);
    if (!snapshot) {
      return Object.freeze({ state: 'hold', reasonCode: 'host-proof-verifier-asset-invalid' });
    }
    initial.set(asset.path, snapshot);
  }
  const invocation = observerInvocation(root, request);
  if (!invocation) {
    return Object.freeze({ state: 'hold', reasonCode: 'host-proof-adapter-unregistered' });
  }
  const runner = options.processRunner ?? runBoundedProcess;
  let result;
  try {
    result = await runner({
      executable: invocation.executable,
      args: invocation.args,
      cwd: root,
      env: Object.freeze({
        HOME: '/tmp',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        ...(request.profile.observer === 'terminal-native-provider'
          ? { NODE_ENV: 'test' }
          : {}),
      }),
      timeoutMs: request.timeoutMs,
      outputLimitBytes: request.outputLimitBytes,
      signal: options.signal,
    });
  } catch {
    return Object.freeze({ state: 'hold', reasonCode: 'host-proof-adapter-failed' });
  }
  if (!processSucceeded(result)) {
    const reasonCode = result.cancelled ? 'host-proof-adapter-cancelled'
      : result.timedOut ? 'host-proof-adapter-timeout'
        : result.overflow ? 'host-proof-adapter-output-overflow'
          : 'host-proof-adapter-failed';
    return Object.freeze({ state: 'hold', reasonCode });
  }
  if (!invocation.accepts(result)) {
    return Object.freeze({ state: 'hold', reasonCode: 'host-proof-adapter-observation-failed' });
  }
  for (const asset of request.assets) {
    if (!sameAsset(initial.get(asset.path), readAsset(root, asset))) {
      return Object.freeze({ state: 'hold', reasonCode: 'host-proof-verifier-asset-changed' });
    }
  }
  return Object.freeze({ state: 'observed', outcome: observedOutcome(request.profile) });
}

async function main() {
  if (process.argv.length !== 3) return 2;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const result = await runProductionWiringHostProofHarness(process.argv[2], {
      signal: controller.signal,
    });
    if (result.state !== 'observed') return 1;
    process.stdout.write(canonicalJson(result.outcome));
    return 0;
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
