import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { types as nodeTypes } from 'node:util';

export const PRODUCTION_WIRING_HOST_PROOF_PROGRAM_VERSION = 1 as const;
export const PRODUCTION_WIRING_HOST_PROOF_PLATFORMS = Object.freeze([
  'linux',
  'wsl2-linux',
  'darwin',
  'win32',
] as const);

export const PRODUCTION_WIRING_HOST_PROOF_MAX_CASES = 256;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_ARGS = 64;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_STRING_BYTES = 16 * 1024;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_TIMEOUT_MS = 15 * 60 * 1_000;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_PROGRAM_BYTES = 1024 * 1024;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_VERIFIER_ASSETS = 128;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_TOTAL_TIMEOUT_MS = 30 * 60 * 1_000;
export const PRODUCTION_WIRING_HOST_PROOF_MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
export const PRODUCTION_WIRING_DOCKER_RUNNER_ADAPTER_ID =
  'docker-readonly-host-proof-v1' as const;

const CLOSURE_OS_HOST_PROOF_ADAPTER_ID = 'deckent-closure-os-authority-gate-v1';
const CLOSURE_OS_HOST_PROOF_HARNESS_PATH =
  'scripts/production-wiring-host-proof-harness.mjs';
const CLOSURE_OS_HOST_PROOF_GROUP_ID = 'deckent:closure-os-authority-gate';
const CLOSURE_OS_HOST_PROOF_SCHEMA_ID = 'deckent.host-proof.closure-os-authority-gate.v1';
const CLOSURE_OS_HOST_PROOF_ASSETS = Object.freeze([
  Object.freeze({
    path: CLOSURE_OS_HOST_PROOF_HARNESS_PATH,
    role: 'trusted-harness' as const,
  }),
  Object.freeze({ path: 'scripts/lint-closure-dispositions.mjs', role: 'config-authority' as const }),
  Object.freeze({ path: 'scripts/closure-ledger/canonical.mjs', role: 'config-authority' as const }),
  Object.freeze({ path: 'scripts/master-plan-integrity.mjs', role: 'config-authority' as const }),
  Object.freeze({ path: 'scripts/approval-identity.mjs', role: 'config-authority' as const }),
  Object.freeze({
    path: 'src/core/closure-classification-schema.json',
    role: 'config-authority' as const,
  }),
]);
const CLOSURE_OS_HOST_PROOF_TARGET_KEYS = Object.freeze([
  'affected-ingress:closure-os.ledger-file-ingress',
  'canonical-consumer:closure-os.authority-gate',
  'enablement-authority:closure-os.reviewed-trust-anchor',
  'producer:closure-os.append-only-ledger',
  'proof-target:closure-os.chain-identity-lifecycle-authority',
].sort());

const TERMINAL_NATIVE_PROVIDER_HOST_PROOF_ADAPTER_ID =
  'deckent-terminal-native-provider-resolution-v1';
const TERMINAL_NATIVE_PROVIDER_HOST_PROOF_GROUP_ID =
  'deckent:terminal-native-provider-resolution';
const TERMINAL_NATIVE_PROVIDER_HOST_PROOF_SCHEMA_ID =
  'deckent.host-proof.terminal-native-provider-resolution.v1';
const TERMINAL_NATIVE_PROVIDER_HOST_PROOF_ASSETS = Object.freeze([
  Object.freeze({
    path: CLOSURE_OS_HOST_PROOF_HARNESS_PATH,
    role: 'trusted-harness' as const,
  }),
]);

export interface ProductionWiringHostProofIdentity {
  readonly producer: { readonly producerId: string };
  readonly canonicalConsumer: {
    readonly consumerId: string;
    readonly relationship: 'invokes-producer' | 'removed-or-migrated';
  };
  readonly affectedIngresses: readonly {
    readonly ingressId: string;
    readonly kind: 'ingress' | 'entrypoint';
  }[];
  readonly enablementAuthority: {
    readonly authorityId: string;
    readonly mechanism: 'configuration' | 'policy' | 'registration' | 'unconditional';
  };
  readonly proofTargets: readonly {
    readonly proofTargetId: string;
    readonly kind:
      | 'consumer-execution'
      | 'ingress-execution'
      | 'enablement-resolution'
      | 'removal-verification'
      | 'platform'
      | 'scale';
  }[];
}

/** Prompt-safe identity tuple for 7099 L1. It contains no executable or digest authority. */
export const TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY: ProductionWiringHostProofIdentity =
  Object.freeze({
    producer: Object.freeze({
      producerId: 'deckent.terminal.native-provider-authority-resolver',
    }),
    canonicalConsumer: Object.freeze({
      consumerId: 'deckent.terminal.native-session-provider',
      relationship: 'invokes-producer' as const,
    }),
    affectedIngresses: Object.freeze([
      Object.freeze({ ingressId: 'deckent.native-terminal.entry', kind: 'entrypoint' as const }),
    ]),
    enablementAuthority: Object.freeze({
      authorityId: 'deckent.config.native-provider',
      mechanism: 'configuration' as const,
    }),
    proofTargets: Object.freeze([
      Object.freeze({
        proofTargetId: 'deckent.terminal.native-provider-resolution-execution',
        kind: 'consumer-execution' as const,
      }),
    ]),
  });

interface RegisteredHostProofProfile {
  readonly adapterId: string;
  readonly observationGroupId: string;
  readonly harnessPath: string;
  readonly schemaId: string;
  readonly assets: readonly Readonly<{
    readonly path: string;
    readonly role: ProductionWiringHostProofVerifierAsset['role'];
  }>[];
  readonly targetKeys: readonly string[];
  readonly proposalIdentity?: ProductionWiringHostProofIdentity;
  readonly platformPolicy?: Readonly<Record<
    ProductionWiringHostProofPlatform,
    'supported' | 'capability-unavailable'
  >>;
}

export type ProductionWiringHostProofPlatform =
  (typeof PRODUCTION_WIRING_HOST_PROOF_PLATFORMS)[number];

export type ProductionWiringHostProofTarget =
  | { readonly kind: 'producer'; readonly targetId: string }
  | { readonly kind: 'canonical-consumer'; readonly targetId: string }
  | { readonly kind: 'affected-ingress'; readonly targetId: string }
  | { readonly kind: 'enablement-authority'; readonly targetId: string }
  | { readonly kind: 'proof-target'; readonly targetId: string };

export interface ProductionWiringHostProofProbeInput {
  readonly target: ProductionWiringHostProofTarget;
  readonly observationGroupId: string;
  readonly harnessPath: string;
  readonly verifierAssetPaths: readonly string[];
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly expectation: {
    readonly kind: 'adapter-structured-outcome';
    readonly schemaId: string;
    readonly outcome: 'observed';
  };
}

export interface ProductionWiringHostProofProbe extends ProductionWiringHostProofProbeInput {
  readonly probeId: string;
}

export type ProductionWiringHostProofPlatformInput =
  | {
      readonly platform: ProductionWiringHostProofPlatform;
      readonly state: 'supported';
      readonly runnerAdapterId: string;
      readonly probes: readonly ProductionWiringHostProofProbeInput[];
    }
  | {
      readonly platform: ProductionWiringHostProofPlatform;
      readonly state: 'unsupported';
      readonly reasonCode:
        | 'adapter-unavailable'
        | 'capability-unavailable'
        | 'environment-unavailable'
        | 'owner-deferred';
    };

export type ProductionWiringHostProofPlatformPlan =
  | {
      readonly platform: ProductionWiringHostProofPlatform;
      readonly state: 'supported';
      readonly runnerAdapterId: string;
      readonly probes: readonly ProductionWiringHostProofProbe[];
    }
  | {
      readonly platform: ProductionWiringHostProofPlatform;
      readonly state: 'unsupported';
      readonly reasonCode:
        | 'adapter-unavailable'
        | 'capability-unavailable'
        | 'environment-unavailable'
        | 'owner-deferred';
    };

export interface ProductionWiringHostProofProgramInput {
  readonly network: 'forbidden' | 'loopback-only';
  readonly verifierAssets: readonly ProductionWiringHostProofVerifierAsset[];
  readonly platforms: readonly ProductionWiringHostProofPlatformInput[];
}

export interface ProductionWiringHostProofVerifierAsset {
  readonly path: string;
  readonly sha256: `sha256:${string}`;
  readonly role: 'trusted-harness' | 'config-authority';
}

export interface ProductionWiringHostProofProgramV1 {
  readonly version: typeof PRODUCTION_WIRING_HOST_PROOF_PROGRAM_VERSION;
  readonly kind: 'production-wiring-host-proof-program-v1';
  readonly executionClass: 'read-only-idempotent';
  readonly effect: 'read-only';
  readonly replayPolicy: 'reuse-terminal-receipt';
  readonly shell: 'forbidden';
  readonly ambientEnvironment: 'forbidden';
  readonly network: 'forbidden' | 'loopback-only';
  readonly verifierAssets: readonly ProductionWiringHostProofVerifierAsset[];
  readonly platforms: readonly ProductionWiringHostProofPlatformPlan[];
  readonly programDigest: string;
}

export interface ProductionWiringHostProofCoverageInput {
  readonly canonicalConsumerId: string;
  readonly canonicalConsumerRelationship: 'invokes-producer' | 'removed-or-migrated';
  readonly producerId: string;
  readonly affectedIngressIds: readonly string[];
  readonly enablementAuthorityId: string;
  readonly proofTargets: readonly {
    readonly proofTargetId: string;
    readonly kind: string;
  }[];
}

export type ProductionWiringHostProofCoverageResult =
  | { readonly state: 'valid' }
  | {
      readonly state: 'hold';
      readonly reasonCode:
        | 'missing-supported-platform'
        | 'missing-proof-target'
        | 'unexpected-proof-target'
        | 'duplicate-proof-target'
        | 'verifier-asset-unbound'
        | 'relationship-proof-unbound';
      readonly platform?: ProductionWiringHostProofPlatform;
      readonly targetKey?: string;
    };

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

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || nodeTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  return keys.every(key => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor
      && descriptor.value !== undefined;
  });
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every(key => keys.includes(key));
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= PRODUCTION_WIRING_HOST_PROOF_MAX_STRING_BYTES;
}

function safeRelativeCwd(value: unknown): value is string {
  if (!boundedString(value) || value.startsWith('/') || value.includes('\\')) return false;
  if (value === '.') return true;
  const parts = value.split('/');
  return parts.every(part => part.length > 0 && part !== '..' && part !== '.');
}

function safeRelativeFilePath(value: unknown): value is string {
  return safeRelativeCwd(value) && value !== '.' && !value.endsWith('/');
}

function parseTarget(value: unknown): ProductionWiringHostProofTarget | null {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'targetId']) || !boundedString(value.targetId)) {
    return null;
  }
  if (!['producer', 'canonical-consumer', 'affected-ingress', 'enablement-authority', 'proof-target']
    .includes(String(value.kind))) return null;
  return { kind: value.kind as ProductionWiringHostProofTarget['kind'], targetId: value.targetId };
}

function parseExpectation(value: unknown): ProductionWiringHostProofProbeInput['expectation'] | null {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'schemaId', 'outcome'])
    || value.kind !== 'adapter-structured-outcome'
    || !boundedString(value.schemaId)
    || value.outcome !== 'observed') return null;
  return { kind: 'adapter-structured-outcome', schemaId: value.schemaId, outcome: 'observed' };
}

function parseProbeInput(value: unknown): ProductionWiringHostProofProbeInput | null {
  if (!isRecord(value) || !exactKeys(value, [
    'target', 'observationGroupId', 'harnessPath', 'verifierAssetPaths', 'args', 'cwd',
    'timeoutMs', 'outputLimitBytes', 'expectation',
  ])) return null;
  const target = parseTarget(value.target);
  const expectation = parseExpectation(value.expectation);
  if (
    target === null
    || expectation === null
    || !boundedString(value.observationGroupId)
    || !safeRelativeFilePath(value.harnessPath)
    || !Array.isArray(value.verifierAssetPaths)
    || value.verifierAssetPaths.length === 0
    || value.verifierAssetPaths.length > PRODUCTION_WIRING_HOST_PROOF_MAX_VERIFIER_ASSETS
    || !value.verifierAssetPaths.every(safeRelativeFilePath)
    || new Set(value.verifierAssetPaths).size !== value.verifierAssetPaths.length
    || !Array.isArray(value.args)
    || value.args.length > PRODUCTION_WIRING_HOST_PROOF_MAX_ARGS
    || !value.args.every(boundedString)
    || !safeRelativeCwd(value.cwd)
    || !Number.isSafeInteger(value.timeoutMs)
    || Number(value.timeoutMs) < 1
    || Number(value.timeoutMs) > PRODUCTION_WIRING_HOST_PROOF_MAX_TIMEOUT_MS
    || !Number.isSafeInteger(value.outputLimitBytes)
    || Number(value.outputLimitBytes) < 1
    || Number(value.outputLimitBytes) > PRODUCTION_WIRING_HOST_PROOF_MAX_OUTPUT_BYTES
  ) return null;
  return {
    target,
    observationGroupId: value.observationGroupId,
    harnessPath: value.harnessPath,
    verifierAssetPaths: [...value.verifierAssetPaths] as string[],
    args: [...value.args] as string[],
    cwd: value.cwd,
    timeoutMs: value.timeoutMs as number,
    outputLimitBytes: value.outputLimitBytes as number,
    expectation,
  };
}

function parsePlatformInput(value: unknown): ProductionWiringHostProofPlatformInput | null {
  if (!isRecord(value) || !PRODUCTION_WIRING_HOST_PROOF_PLATFORMS.includes(
    value.platform as ProductionWiringHostProofPlatform,
  )) return null;
  const platform = value.platform as ProductionWiringHostProofPlatform;
  if (value.state === 'unsupported') {
    if (!exactKeys(value, ['platform', 'state', 'reasonCode']) || ![
      'adapter-unavailable', 'capability-unavailable', 'environment-unavailable', 'owner-deferred',
    ].includes(String(value.reasonCode))) return null;
    return { platform, state: 'unsupported', reasonCode: value.reasonCode as 'adapter-unavailable' };
  }
  if (
    value.state !== 'supported'
    || !exactKeys(value, ['platform', 'state', 'runnerAdapterId', 'probes'])
    || !boundedString(value.runnerAdapterId)
    || !Array.isArray(value.probes)
    || value.probes.length === 0
    || value.probes.length > PRODUCTION_WIRING_HOST_PROOF_MAX_CASES
  ) return null;
  const probes = value.probes.map(parseProbeInput);
  if (probes.some(probe => probe === null)) return null;
  return { platform, state: 'supported', runnerAdapterId: value.runnerAdapterId, probes: probes as ProductionWiringHostProofProbeInput[] };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function parseProductionWiringHostProofProgramInput(
  value: unknown,
): ProductionWiringHostProofProgramInput | null {
  if (!isRecord(value) || !exactKeys(value, ['network', 'verifierAssets', 'platforms'])
    || (value.network !== 'forbidden' && value.network !== 'loopback-only')
    || !Array.isArray(value.verifierAssets)
    || value.verifierAssets.length === 0
    || value.verifierAssets.length > PRODUCTION_WIRING_HOST_PROOF_MAX_VERIFIER_ASSETS
    || !Array.isArray(value.platforms)
    || Buffer.byteLength(canonicalJson(value), 'utf8') > PRODUCTION_WIRING_HOST_PROOF_MAX_PROGRAM_BYTES) return null;
  const verifierAssets = value.verifierAssets.map(candidate => {
    if (!isRecord(candidate) || !exactKeys(candidate, ['path', 'sha256', 'role'])
      || !safeRelativeFilePath(candidate.path)
      || typeof candidate.sha256 !== 'string'
      || !/^sha256:[a-f0-9]{64}$/u.test(candidate.sha256)
      || (candidate.role !== 'trusted-harness' && candidate.role !== 'config-authority')) return null;
    return { path: candidate.path, sha256: candidate.sha256, role: candidate.role } as ProductionWiringHostProofVerifierAsset;
  });
  if (verifierAssets.some(asset => asset === null)
    || new Set(verifierAssets.map(asset => asset!.path)).size !== verifierAssets.length) return null;
  const assetByPath = new Map(verifierAssets.map(asset => [asset!.path, asset!]));
  const platforms = value.platforms.map(parsePlatformInput);
  if (platforms.some(platform => platform === null)) return null;
  for (const platform of platforms) {
    if (platform?.state !== 'supported') continue;
    let totalTimeoutMs = 0;
    let totalOutputBytes = 0;
    const groupExecution = new Map<string, string>();
    for (const probe of platform.probes) {
      if (!probe.verifierAssetPaths.includes(probe.harnessPath)
        || probe.verifierAssetPaths.some(path => !assetByPath.has(path))
        || assetByPath.get(probe.harnessPath)?.role !== 'trusted-harness') return null;
      totalTimeoutMs += probe.timeoutMs;
      totalOutputBytes += probe.outputLimitBytes;
      const execution = canonicalJson({
        harnessPath: probe.harnessPath,
        verifierAssetPaths: probe.verifierAssetPaths,
        args: probe.args,
        cwd: probe.cwd,
        timeoutMs: probe.timeoutMs,
        outputLimitBytes: probe.outputLimitBytes,
        expectation: probe.expectation,
      });
      const prior = groupExecution.get(probe.observationGroupId);
      if (prior !== undefined && prior !== execution) return null;
      groupExecution.set(probe.observationGroupId, execution);
    }
    if (totalTimeoutMs > PRODUCTION_WIRING_HOST_PROOF_MAX_TOTAL_TIMEOUT_MS
      || totalOutputBytes > PRODUCTION_WIRING_HOST_PROOF_MAX_TOTAL_OUTPUT_BYTES) return null;
  }
  const names = platforms.map(platform => platform!.platform);
  if (
    names.length !== PRODUCTION_WIRING_HOST_PROOF_PLATFORMS.length
    || new Set(names).size !== names.length
    || !PRODUCTION_WIRING_HOST_PROOF_PLATFORMS.every(platform => names.includes(platform))
  ) return null;
  const byPlatform = new Map(platforms.map(platform => [platform!.platform, platform!]));
  return deepFreeze({
    network: value.network,
    verifierAssets: verifierAssets as ProductionWiringHostProofVerifierAsset[],
    platforms: PRODUCTION_WIRING_HOST_PROOF_PLATFORMS.map(platform => byPlatform.get(platform)!),
  });
}

/** Host-owned canonicalizer: callers author no probe or program digests. */
export function createProductionWiringHostProofProgram(
  input: ProductionWiringHostProofProgramInput,
): ProductionWiringHostProofProgramV1 {
  const parsed = parseProductionWiringHostProofProgramInput(input);
  if (parsed === null) throw new TypeError('invalid production-wiring host proof program');
  const platforms: ProductionWiringHostProofPlatformPlan[] = parsed.platforms.map(platform => {
    if (platform.state === 'unsupported') return platform;
    const probes = platform.probes.map(probe => ({
      ...probe,
      probeId: `production-wiring-probe:${digest([platform.platform, probe])}`,
    }));
    return { ...platform, probes };
  });
  const body = {
    version: PRODUCTION_WIRING_HOST_PROOF_PROGRAM_VERSION,
    kind: 'production-wiring-host-proof-program-v1' as const,
    executionClass: 'read-only-idempotent' as const,
    effect: 'read-only' as const,
    replayPolicy: 'reuse-terminal-receipt' as const,
    shell: 'forbidden' as const,
    ambientEnvironment: 'forbidden' as const,
    network: parsed.network,
    verifierAssets: parsed.verifierAssets,
    platforms,
  };
  return deepFreeze({ ...body, programDigest: digest(body) });
}

/** Strict read parser for a previously canonicalized immutable program. */
export function parseProductionWiringHostProofProgram(
  value: unknown,
): ProductionWiringHostProofProgramV1 | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'kind', 'executionClass', 'effect', 'replayPolicy', 'shell',
    'ambientEnvironment', 'network', 'verifierAssets', 'platforms', 'programDigest',
  ]) || value.version !== PRODUCTION_WIRING_HOST_PROOF_PROGRAM_VERSION
    || value.kind !== 'production-wiring-host-proof-program-v1'
    || value.executionClass !== 'read-only-idempotent'
    || value.effect !== 'read-only'
    || value.replayPolicy !== 'reuse-terminal-receipt'
    || value.shell !== 'forbidden'
    || value.ambientEnvironment !== 'forbidden'
    || (value.network !== 'forbidden' && value.network !== 'loopback-only')
    || typeof value.programDigest !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.programDigest)
    || !Array.isArray(value.platforms)) return null;
  const authoringPlatforms: ProductionWiringHostProofPlatformInput[] = [];
  for (const candidate of value.platforms) {
    if (!isRecord(candidate)) return null;
    if (candidate.state === 'unsupported') {
      const parsed = parsePlatformInput(candidate);
      if (parsed === null || parsed.state !== 'unsupported') return null;
      authoringPlatforms.push(parsed);
      continue;
    }
    if (!exactKeys(candidate, ['platform', 'state', 'runnerAdapterId', 'probes'])
      || candidate.state !== 'supported' || !Array.isArray(candidate.probes)) return null;
    const probes: ProductionWiringHostProofProbeInput[] = [];
    for (const probe of candidate.probes) {
      if (!isRecord(probe) || !exactKeys(probe, [
        'target', 'observationGroupId', 'harnessPath', 'verifierAssetPaths', 'args', 'cwd',
        'timeoutMs', 'outputLimitBytes', 'expectation', 'probeId',
      ]) || !boundedString(probe.probeId)) return null;
      const { probeId: _probeId, ...input } = probe;
      const parsedProbe = parseProbeInput(input);
      if (parsedProbe === null) return null;
      probes.push(parsedProbe);
    }
    const parsed = parsePlatformInput({
      platform: candidate.platform,
      state: candidate.state,
      runnerAdapterId: candidate.runnerAdapterId,
      probes,
    });
    if (parsed === null || parsed.state !== 'supported') return null;
    authoringPlatforms.push(parsed);
  }
  let canonical: ProductionWiringHostProofProgramV1;
  try {
    canonical = createProductionWiringHostProofProgram({
      network: value.network,
      verifierAssets: value.verifierAssets as ProductionWiringHostProofVerifierAsset[],
      platforms: authoringPlatforms,
    });
  } catch {
    return null;
  }
  return canonicalJson(canonical) === canonicalJson(value) ? canonical : null;
}

function targetKey(target: ProductionWiringHostProofTarget): string {
  return `${target.kind}\0${target.targetId}`;
}

function adapterTargetKey(target: ProductionWiringHostProofTarget): string {
  return `${target.kind}:${target.targetId}`;
}

function identityTargetKeys(identity: ProductionWiringHostProofIdentity): string[] {
  return [
    adapterTargetKey({ kind: 'producer', targetId: identity.producer.producerId }),
    adapterTargetKey({
      kind: 'canonical-consumer',
      targetId: identity.canonicalConsumer.consumerId,
    }),
    ...identity.affectedIngresses.map(entry => adapterTargetKey({
      kind: 'affected-ingress',
      targetId: entry.ingressId,
    })),
    adapterTargetKey({
      kind: 'enablement-authority',
      targetId: identity.enablementAuthority.authorityId,
    }),
    ...identity.proofTargets.map(entry => adapterTargetKey({
      kind: 'proof-target',
      targetId: entry.proofTargetId,
    })),
  ].sort();
}

const REGISTERED_HOST_PROOF_PROFILES: readonly RegisteredHostProofProfile[] = Object.freeze([
  Object.freeze({
    adapterId: CLOSURE_OS_HOST_PROOF_ADAPTER_ID,
    observationGroupId: CLOSURE_OS_HOST_PROOF_GROUP_ID,
    harnessPath: CLOSURE_OS_HOST_PROOF_HARNESS_PATH,
    schemaId: CLOSURE_OS_HOST_PROOF_SCHEMA_ID,
    assets: CLOSURE_OS_HOST_PROOF_ASSETS,
    targetKeys: CLOSURE_OS_HOST_PROOF_TARGET_KEYS,
  }),
  Object.freeze({
    adapterId: TERMINAL_NATIVE_PROVIDER_HOST_PROOF_ADAPTER_ID,
    observationGroupId: TERMINAL_NATIVE_PROVIDER_HOST_PROOF_GROUP_ID,
    harnessPath: CLOSURE_OS_HOST_PROOF_HARNESS_PATH,
    schemaId: TERMINAL_NATIVE_PROVIDER_HOST_PROOF_SCHEMA_ID,
    assets: TERMINAL_NATIVE_PROVIDER_HOST_PROOF_ASSETS,
    targetKeys: Object.freeze(identityTargetKeys(TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY)),
    proposalIdentity: TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
    platformPolicy: Object.freeze({
      linux: 'supported' as const,
      'wsl2-linux': 'supported' as const,
      darwin: 'capability-unavailable' as const,
      win32: 'capability-unavailable' as const,
    }),
  }),
]);

function profileForTargetKeys(targetKeys: readonly string[]): RegisteredHostProofProfile | null {
  const canonical = canonicalJson([...targetKeys].sort());
  return REGISTERED_HOST_PROOF_PROFILES.find(profile =>
    canonicalJson(profile.targetKeys) === canonical) ?? null;
}

function profileForProposalIdentity(
  identity: ProductionWiringHostProofIdentity,
): RegisteredHostProofProfile | null {
  const identityTuple = (value: ProductionWiringHostProofIdentity) => canonicalJson({
    producer: value.producer,
    canonicalConsumer: value.canonicalConsumer,
    affectedIngresses: value.affectedIngresses,
    enablementAuthority: value.enablementAuthority,
    proofTargets: value.proofTargets,
  });
  const canonical = identityTuple(identity);
  return REGISTERED_HOST_PROOF_PROFILES.find(profile =>
    profile.proposalIdentity !== undefined
      && identityTuple(profile.proposalIdentity) === canonical) ?? null;
}

export function isProductionWiringHostProofIdentityRegistered(
  identity: ProductionWiringHostProofIdentity,
): boolean {
  return profileForProposalIdentity(identity) !== null;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`)
    && relation !== '..' && !isAbsolute(relation));
}

function readVerifierAssetDigest(projectRoot: string, assetPath: string): `sha256:${string}` | null {
  if (!safeRelativeFilePath(assetPath)) return null;
  let root: string;
  try {
    root = realpathSync(projectRoot);
  } catch {
    return null;
  }
  const absolute = resolve(root, assetPath);
  if (!isInsideRoot(root, absolute)) return null;
  let cursor = root;
  try {
    for (const segment of assetPath.split('/').slice(0, -1)) {
      cursor = resolve(cursor, segment);
      const entry = lstatSync(cursor);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
    }
    const pathEntry = lstatSync(absolute);
    if (!pathEntry.isFile() || pathEntry.isSymbolicLink() || pathEntry.nlink !== 1
      || realpathSync(absolute) !== absolute) return null;
  } catch {
    return null;
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1) return null;
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return null;
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function targetFromKey(key: string): ProductionWiringHostProofTarget {
  const separator = key.indexOf(':');
  return {
    kind: key.slice(0, separator) as ProductionWiringHostProofTarget['kind'],
    targetId: key.slice(separator + 1),
  };
}

/**
 * Complete a proposal's exact identity tuple from the immutable host registry.
 * The caller supplies no executable, argv, digest, platform claim, or success predicate.
 */
export function createRegisteredProductionWiringHostProofProgram(
  identity: ProductionWiringHostProofIdentity,
  projectRoot: string,
): ProductionWiringHostProofProgramInput | null {
  const profile = profileForProposalIdentity(identity);
  if (!profile) return null;
  const verifierAssets: ProductionWiringHostProofVerifierAsset[] = [];
  for (const asset of profile.assets) {
    const sha256 = readVerifierAssetDigest(projectRoot, asset.path);
    if (!sha256) return null;
    verifierAssets.push({ ...asset, sha256 });
  }
  const request = canonicalJson({
    version: 1,
    kind: 'deckent-production-wiring-host-proof-request-v1',
    adapterId: profile.adapterId,
    assets: verifierAssets,
    timeoutMs: 60_000,
    outputLimitBytes: 64 * 1024,
  });
  const probes = profile.targetKeys.map(key => ({
    target: targetFromKey(key),
    observationGroupId: profile.observationGroupId,
    harnessPath: profile.harnessPath,
    verifierAssetPaths: verifierAssets.map(asset => asset.path),
    args: [request],
    cwd: '.',
    timeoutMs: 60_000,
    outputLimitBytes: 64 * 1024,
    expectation: {
      kind: 'adapter-structured-outcome' as const,
      schemaId: profile.schemaId,
      outcome: 'observed' as const,
    },
  }));
  return {
    network: 'forbidden',
    verifierAssets,
    platforms: PRODUCTION_WIRING_HOST_PROOF_PLATFORMS.map(platform => {
      const policy = profile.platformPolicy?.[platform] ?? 'supported';
      return policy === 'supported'
        ? {
            platform,
            state: 'supported' as const,
            runnerAdapterId: PRODUCTION_WIRING_DOCKER_RUNNER_ADAPTER_ID,
            probes,
          }
        : { platform, state: 'unsupported' as const, reasonCode: policy };
    }),
  };
}

export type ProductionWiringHostProofAdapterAdmission =
  | Readonly<{ readonly state: 'valid' }>
  | Readonly<{ readonly state: 'hold'; readonly reasonCode: 'host-proof-harness-unregistered' }>;

/**
 * Execution admission registry. A planner may bind current asset digests and
 * finite resource ceilings, but it cannot nominate a repository executable as
 * trusted or invent the adapter request/target map that will attest its work.
 */
export function validateProductionWiringHostProofAdapterAdmission(
  program: ProductionWiringHostProofProgramV1,
): ProductionWiringHostProofAdapterAdmission {
  if (program.network !== 'forbidden') {
    return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
  }
  const programTargetKeys = program.platforms
    .filter(platform => platform.state === 'supported')
    .flatMap(platform => platform.state === 'supported'
      ? platform.probes.map(probe => adapterTargetKey(probe.target)) : []);
  const profile = profileForTargetKeys([...new Set(programTargetKeys)]);
  if (!profile || program.verifierAssets.length !== profile.assets.length) {
    return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
  }
  const assetByPath = new Map(program.verifierAssets.map(asset => [asset.path, asset]));
  if (profile.assets.some(required => {
    const actual = assetByPath.get(required.path);
    return !actual || actual.role !== required.role;
  })) return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
  for (const platform of program.platforms) {
    const platformPolicy = profile.platformPolicy?.[platform.platform];
    if (platformPolicy !== undefined
      && ((platformPolicy === 'supported') !== (platform.state === 'supported')
        || (platform.state === 'unsupported' && platform.reasonCode !== platformPolicy))) {
      return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
    }
    if (platform.state !== 'supported') continue;
    if (platform.runnerAdapterId !== PRODUCTION_WIRING_DOCKER_RUNNER_ADAPTER_ID) {
      return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
    }
    const groups = new Map<string, ProductionWiringHostProofProbe[]>();
    for (const probe of platform.probes) {
      const group = groups.get(probe.observationGroupId) ?? [];
      group.push(probe);
      groups.set(probe.observationGroupId, group);
    }
    for (const probes of groups.values()) {
      const representative = probes[0];
      if (!representative
        || representative.observationGroupId !== profile.observationGroupId
        || representative.harnessPath !== profile.harnessPath
        || representative.cwd !== '.'
        || representative.expectation.schemaId !== profile.schemaId
        || representative.args.length !== 1
        || probes.some(probe => probe.observationGroupId !== profile.observationGroupId
          || probe.harnessPath !== profile.harnessPath
          || probe.cwd !== '.'
          || probe.expectation.schemaId !== profile.schemaId)) {
        return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
      }
      const targetKeys = probes.map(probe => adapterTargetKey(probe.target)).sort();
      if (canonicalJson(targetKeys) !== canonicalJson(profile.targetKeys)
        || canonicalJson(representative.verifierAssetPaths)
          !== canonicalJson(profile.assets.map(asset => asset.path))) {
        return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
      }
      let request: unknown;
      try {
        request = JSON.parse(representative.args[0]!);
      } catch {
        return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
      }
      if (!isRecord(request)
        || canonicalJson(request) !== representative.args[0]
        || !exactKeys(request, [
          'version', 'kind', 'adapterId', 'assets', 'timeoutMs', 'outputLimitBytes',
        ])
        || request.version !== 1
        || request.kind !== 'deckent-production-wiring-host-proof-request-v1'
        || request.adapterId !== profile.adapterId
        || request.timeoutMs !== representative.timeoutMs
        || request.outputLimitBytes !== representative.outputLimitBytes
        || !Array.isArray(request.assets)
        || request.assets.length !== profile.assets.length) {
        return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
      }
      for (let index = 0; index < profile.assets.length; index += 1) {
        const expected = profile.assets[index]!;
        const candidate = request.assets[index];
        const declared = assetByPath.get(expected.path);
        if (!isRecord(candidate) || !exactKeys(candidate, ['path', 'sha256', 'role'])
          || candidate.path !== expected.path || candidate.role !== expected.role
          || candidate.sha256 !== declared?.sha256) {
          return { state: 'hold', reasonCode: 'host-proof-harness-unregistered' };
        }
      }
    }
  }
  return { state: 'valid' };
}

/** Every supported adapter must prove every declared runtime link exactly once. */
export function validateProductionWiringHostProofCoverage(
  program: ProductionWiringHostProofProgramV1,
  coverage: ProductionWiringHostProofCoverageInput,
): ProductionWiringHostProofCoverageResult {
  const expected = new Set<string>([
    targetKey({ kind: 'producer', targetId: coverage.producerId }),
    targetKey({ kind: 'canonical-consumer', targetId: coverage.canonicalConsumerId }),
    ...coverage.affectedIngressIds.map(targetId => targetKey({ kind: 'affected-ingress', targetId })),
    targetKey({ kind: 'enablement-authority', targetId: coverage.enablementAuthorityId }),
    ...coverage.proofTargets.map(({ proofTargetId }) => targetKey({ kind: 'proof-target', targetId: proofTargetId })),
  ]);
  const supported = program.platforms.filter(platform => platform.state === 'supported');
  if (supported.length === 0) return { state: 'hold', reasonCode: 'missing-supported-platform' };
  for (const platform of supported) {
    const observed = new Set<string>();
    for (const probe of platform.probes) {
      const key = targetKey(probe.target);
      if (observed.has(key)) {
        return { state: 'hold', reasonCode: 'duplicate-proof-target', platform: platform.platform, targetKey: key };
      }
      if (!expected.has(key)) {
        return { state: 'hold', reasonCode: 'unexpected-proof-target', platform: platform.platform, targetKey: key };
      }
      observed.add(key);
    }
    for (const key of expected) {
      if (!observed.has(key)) {
        return { state: 'hold', reasonCode: 'missing-proof-target', platform: platform.platform, targetKey: key };
      }
    }
    if (coverage.canonicalConsumerRelationship === 'invokes-producer') {
      const producer = platform.probes.find(probe => probe.target.kind === 'producer'
        && probe.target.targetId === coverage.producerId);
      const consumer = platform.probes.find(probe => probe.target.kind === 'canonical-consumer'
        && probe.target.targetId === coverage.canonicalConsumerId);
      if (!producer || !consumer
        || producer.observationGroupId !== consumer.observationGroupId
        || producer.harnessPath !== consumer.harnessPath) {
        return { state: 'hold', reasonCode: 'relationship-proof-unbound', platform: platform.platform };
      }
    }
  }
  return { state: 'valid' };
}
