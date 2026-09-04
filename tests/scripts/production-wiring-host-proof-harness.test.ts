import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLOSURE_OS_AUTHORITY_ADAPTER_ID,
  CLOSURE_OS_AUTHORITY_OBSERVATION_GROUP_ID,
  CLOSURE_OS_AUTHORITY_SCHEMA_ID,
  TERMINAL_NATIVE_PROVIDER_ADAPTER_ID,
  TERMINAL_NATIVE_PROVIDER_OBSERVATION_GROUP_ID,
  TERMINAL_NATIVE_PROVIDER_SCHEMA_ID,
  runProductionWiringHostProofHarness,
} from '../../scripts/production-wiring-host-proof-harness.mjs';
import {
  loadBatchManifests,
  loadBatchSnapshots,
  parseTrustAnchorsDoc,
  runGate,
} from '../../scripts/lint-closure-dispositions.mjs';

const repositoryRoot = join(import.meta.dirname, '..', '..');
const roots: string[] = [];

const requiredAssets = [
  { path: 'scripts/production-wiring-host-proof-harness.mjs', role: 'trusted-harness' },
  { path: 'scripts/lint-closure-dispositions.mjs', role: 'config-authority' },
  { path: 'scripts/closure-ledger/canonical.mjs', role: 'config-authority' },
  { path: 'scripts/master-plan-integrity.mjs', role: 'config-authority' },
  { path: 'scripts/approval-identity.mjs', role: 'config-authority' },
  { path: 'src/core/closure-classification-schema.json', role: 'config-authority' },
] as const;

const targetKeys = [
  'affected-ingress:closure-os.ledger-file-ingress',
  'canonical-consumer:closure-os.authority-gate',
  'enablement-authority:closure-os.reviewed-trust-anchor',
  'producer:closure-os.append-only-ledger',
  'proof-target:closure-os.chain-identity-lifecycle-authority',
].sort();

const terminalAssets = [
  { path: 'scripts/production-wiring-host-proof-harness.mjs', role: 'trusted-harness' },
] as const;

const terminalTargetKeys = [
  'affected-ingress:deckent.native-terminal.entry',
  'canonical-consumer:deckent.terminal.native-session-provider',
  'enablement-authority:deckent.config.native-provider',
  'producer:deckent.terminal.native-provider-authority-resolver',
  'proof-target:deckent.terminal.native-provider-resolution-execution',
].sort();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function createFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deckent-host-proof-harness-'));
  roots.push(root);
  for (const asset of requiredAssets) {
    const absolute = join(root, asset.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `fixture:${asset.path}\n`);
  }
  return root;
}

function buildRequest(root: string, overrides: Record<string, unknown> = {}): string {
  const request = {
    adapterId: CLOSURE_OS_AUTHORITY_ADAPTER_ID,
    assets: requiredAssets.map(asset => ({
      path: asset.path,
      role: asset.role,
      sha256: sha256(readFileSync(join(root, asset.path))),
    })),
    kind: 'deckent-production-wiring-host-proof-request-v1',
    outputLimitBytes: 8 * 1024,
    timeoutMs: 10_000,
    version: 1,
    ...overrides,
  };
  return canonicalJson(request);
}

function buildTerminalRequest(root: string): string {
  return canonicalJson({
    adapterId: TERMINAL_NATIVE_PROVIDER_ADAPTER_ID,
    assets: terminalAssets.map(asset => ({
      path: asset.path,
      role: asset.role,
      sha256: sha256(readFileSync(join(root, asset.path))),
    })),
    kind: 'deckent-production-wiring-host-proof-request-v1',
    outputLimitBytes: 64 * 1024,
    timeoutMs: 60_000,
    version: 1,
  });
}

function commandResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 0,
    signal: null,
    stdout: Buffer.from(
      '[closure-gate] OK — 7 events, chain + identity + lifecycle + append-only verified\n',
    ),
    stderr: Buffer.alloc(0),
    overflow: false,
    timedOut: false,
    cancelled: false,
    error: false,
    ...overrides,
  };
}

function copyRealClosureAuthority(root: string): void {
  const files = [
    ...requiredAssets.map(asset => asset.path),
    'docs/governance/closure-dispositions.jsonl',
    'docs/governance/closure-trust-anchors.json',
    'docs/generated/master-plan-active.json',
  ];
  for (const relativePath of files) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repositoryRoot, relativePath), destination);
  }
  for (const relativePath of [
    'docs/governance/closure-dispositions.receipts',
    'docs/governance/closure-batches',
  ]) {
    cpSync(join(repositoryRoot, relativePath), join(root, relativePath), { recursive: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('canonical production-wiring host-proof harness', () => {
  it('runs the registered Terminal provider observer with code-owned tests and target identities', async () => {
    await expect(runProductionWiringHostProofHarness(
      buildTerminalRequest(repositoryRoot),
      { root: repositoryRoot },
    )).resolves.toEqual({
      state: 'observed',
      outcome: {
        version: 1,
        kind: 'deckent-production-wiring-host-proof-outcome',
        schemaId: TERMINAL_NATIVE_PROVIDER_SCHEMA_ID,
        observationGroupId: TERMINAL_NATIVE_PROVIDER_OBSERVATION_GROUP_ID,
        outcome: 'observed',
        targetKeys: terminalTargetKeys,
      },
    });
  }, 90_000);

  it('accepts only after the real Closure OS receipt reader validates isolated durable authority data', async () => {
    const root = createFixtureRoot();
    copyRealClosureAuthority(root);
    expect(readFileSync(join(root, 'scripts/lint-closure-dispositions.mjs'), 'utf8'))
      .toContain("process.exit(main())");
    const processRunner = vi.fn(async (input: {
      executable: string;
      args: readonly string[];
      cwd: string;
    }) => {
      expect(input).toMatchObject({
        executable: process.execPath,
        args: [join(root, 'scripts/lint-closure-dispositions.mjs')],
        cwd: root,
      });
      const ledgerText = readFileSync(
        join(root, 'docs/governance/closure-dispositions.jsonl'), 'utf8',
      );
      const master = JSON.parse(readFileSync(
        join(root, 'docs/generated/master-plan-active.json'), 'utf8',
      )) as { identityRegistry: unknown; sourceDigest?: { value?: string } };
      const receipts = loadBatchManifests(
        join(root, 'docs/governance/closure-dispositions.receipts'),
      );
      const anchors = parseTrustAnchorsDoc(readFileSync(
        join(root, 'docs/governance/closure-trust-anchors.json'), 'utf8',
      ), 'isolated reviewed trust anchors');
      const gate = runGate({
        ledgerText,
        baseline: { baselineText: ledgerText },
        registry: master.identityRegistry,
        masterSourceDigest: master.sourceDigest?.value ?? null,
        batchManifests: receipts.manifests,
        verifyAuthority: true,
        trustAnchors: anchors.anchors,
        batchSnapshots: loadBatchSnapshots(join(root, 'docs/governance/closure-batches')),
        trustAnchorProblems: anchors.problems,
        receiptProblems: receipts.problems,
      });
      expect(gate).toMatchObject({ ok: true, errors: [], holds: [] });
      expect(gate.eventCount).toBeGreaterThan(0);
      return commandResult({
        stdout: Buffer.from(
          `[closure-gate] OK — ${String(gate.eventCount)} events, chain + identity + lifecycle + append-only verified\n`,
        ),
      });
    });

    await expect(runProductionWiringHostProofHarness(buildRequest(root), { root, processRunner }))
      .resolves.toEqual({
        state: 'observed',
        outcome: {
          version: 1,
          kind: 'deckent-production-wiring-host-proof-outcome',
          schemaId: CLOSURE_OS_AUTHORITY_SCHEMA_ID,
          observationGroupId: CLOSURE_OS_AUTHORITY_OBSERVATION_GROUP_ID,
          outcome: 'observed',
          targetKeys,
        },
      });
    expect(processRunner).toHaveBeenCalledOnce();
  });

  it('uses a fixed executable, argv and isolated environment', async () => {
    const root = createFixtureRoot();
    const processRunner = vi.fn(async (input: Record<string, unknown>) => {
      expect(input.executable).toBe(process.execPath);
      expect(input.args).toEqual([join(root, 'scripts/lint-closure-dispositions.mjs')]);
      expect(input.cwd).toBe(root);
      expect(input.env).toEqual({
        HOME: '/tmp',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
      });
      expect(JSON.stringify(input.env)).not.toContain('TOKEN');
      return commandResult();
    });

    await expect(runProductionWiringHostProofHarness(buildRequest(root), {
      root,
      processRunner,
    })).resolves.toMatchObject({ state: 'observed' });
    expect(processRunner).toHaveBeenCalledOnce();
  });

  it.each([
    ['malformed JSON', '{'],
    ['noncanonical JSON', '{ "version": 1 }'],
  ])('rejects %s before invoking any adapter', async (_label, request) => {
    const processRunner = vi.fn();
    await expect(runProductionWiringHostProofHarness(request, { processRunner }))
      .resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-request-invalid' });
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('rejects unknown adapters, arbitrary executables and plan-authored target echoes', async () => {
    const root = createFixtureRoot();
    const base = JSON.parse(buildRequest(root)) as Record<string, unknown>;
    const processRunner = vi.fn();
    for (const mutation of [
      { ...base, adapterId: 'arbitrary-executable-v1' },
      { ...base, executable: '/tmp/attacker' },
      { ...base, targetKeys },
    ]) {
      await expect(runProductionWiringHostProofHarness(canonicalJson(mutation), {
        root,
        processRunner,
      })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-request-invalid' });
    }
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('rejects asset path drift, symlinks and digest mismatch before execution', async () => {
    const root = createFixtureRoot();
    const original = JSON.parse(buildRequest(root)) as {
      assets: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const processRunner = vi.fn();
    const wrongPath = structuredClone(original);
    wrongPath.assets[1]!.path = 'scripts/another-validator.mjs';
    await expect(runProductionWiringHostProofHarness(canonicalJson(wrongPath), {
      root,
      processRunner,
    })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-request-invalid' });

    const wrongDigest = structuredClone(original);
    wrongDigest.assets[1]!.sha256 = `sha256:${'0'.repeat(64)}`;
    await expect(runProductionWiringHostProofHarness(canonicalJson(wrongDigest), {
      root,
      processRunner,
    })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-verifier-asset-invalid' });

    const symlinkRequest = buildRequest(root);
    const gate = join(root, 'scripts/lint-closure-dispositions.mjs');
    const outside = join(root, 'gate-copy.mjs');
    copyFileSync(gate, outside);
    rmSync(gate);
    symlinkSync(outside, gate);
    await expect(runProductionWiringHostProofHarness(symlinkRequest, {
      root,
      processRunner,
    })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-verifier-asset-invalid' });
    expect(processRunner).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', { timedOut: true, error: true }, 'host-proof-adapter-timeout'],
    ['output overflow', { overflow: true, error: true }, 'host-proof-adapter-output-overflow'],
    ['cancellation', { cancelled: true, error: true }, 'host-proof-adapter-cancelled'],
    ['process failure', { status: 1, error: true }, 'host-proof-adapter-failed'],
  ])('fails closed on adapter %s', async (_label, result, reasonCode) => {
    const root = createFixtureRoot();
    const processRunner = vi.fn(async () => commandResult(result));
    await expect(runProductionWiringHostProofHarness(buildRequest(root), {
      root,
      processRunner,
    })).resolves.toEqual({ state: 'hold', reasonCode });
  });

  it('rejects generic structured target echo and non-authoritative success text', async () => {
    const root = createFixtureRoot();
    const echoed = canonicalJson({
      version: 1,
      kind: 'deckent-production-wiring-host-proof-outcome',
      schemaId: CLOSURE_OS_AUTHORITY_SCHEMA_ID,
      observationGroupId: CLOSURE_OS_AUTHORITY_OBSERVATION_GROUP_ID,
      outcome: 'observed',
      targetKeys,
    });
    for (const stdout of [echoed, '[closure-gate] ledger empty/absent — nothing to validate (OK)\n']) {
      await expect(runProductionWiringHostProofHarness(buildRequest(root), {
        root,
        processRunner: async () => commandResult({ stdout: Buffer.from(stdout) }),
      })).resolves.toEqual({
        state: 'hold',
        reasonCode: 'host-proof-adapter-observation-failed',
      });
    }
  });

  it('rejects adapter errors and verifier-asset changes after observation', async () => {
    const root = createFixtureRoot();
    await expect(runProductionWiringHostProofHarness(buildRequest(root), {
      root,
      processRunner: async () => { throw new Error('adapter failed'); },
    })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-adapter-failed' });

    const request = buildRequest(root);
    await expect(runProductionWiringHostProofHarness(request, {
      root,
      processRunner: async () => {
        writeFileSync(join(root, 'scripts/approval-identity.mjs'), 'changed\n');
        return commandResult();
      },
    })).resolves.toEqual({ state: 'hold', reasonCode: 'host-proof-verifier-asset-changed' });
  });
});
