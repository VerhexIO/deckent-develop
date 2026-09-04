/**
 * Provider- and language-neutral production-wiring authority contract.
 *
 * This module is intentionally pure. It records declared topology and resolves
 * bounded evidence; verifier adapters and orchestration settlement live in
 * downstream layers. Presence in source, tests, or an import graph is never
 * promoted to executed production wiring here.
 */

import { types as nodeTypes } from 'node:util';

import {
  createRegisteredProductionWiringHostProofProgram,
  createProductionWiringHostProofProgram,
  isProductionWiringHostProofIdentityRegistered,
  parseProductionWiringHostProofProgram,
  parseProductionWiringHostProofProgramInput,
  validateProductionWiringHostProofCoverage,
  type ProductionWiringHostProofIdentity,
  type ProductionWiringHostProofProgramInput,
  type ProductionWiringHostProofProgramV1,
} from './production-wiring-host-proof.js';

export const PRODUCTION_WIRING_CONTRACT_VERSION = 1 as const;
export const PRODUCTION_WIRING_CONTRACT_V2_VERSION = 2 as const;

export type ProductionWiringChangeKind =
  | 'runtime-addition'
  | 'runtime-change'
  | 'refactor'
  | 'removal'
  | 'foundation'
  | 'public-library'
  | 'documentation'
  | 'data';

export type CompleteEvidenceBasis =
  | 'authority-record'
  | 'executed-production-path'
  | 'host-attested-execution';

export type PresenceOnlyEvidenceBasis =
  | 'code-presence'
  | 'test-presence'
  | 'static-reachability'
  | 'import-count';

export type ProductionWiringEvidence =
  | {
      readonly state: 'complete';
      readonly basis: CompleteEvidenceBasis;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly state: 'presence-only';
      readonly basis: PresenceOnlyEvidenceBasis;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly state: 'incomplete';
      readonly reasonCode: 'absent' | 'unresolved' | 'not-executed';
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly state: 'unsupported';
      readonly reasonCode:
        | 'adapter-unavailable'
        | 'capability-unavailable'
        | 'environment-unavailable';
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly state: 'contradictory';
      readonly reasonCode:
        | 'authority-conflict'
        | 'identity-conflict'
        | 'observation-conflict';
      readonly evidenceRefs: readonly string[];
    };

export interface ProductionWiringProducer {
  readonly producerId: string;
  readonly evidence: ProductionWiringEvidence;
}

export interface ProductionWiringCanonicalConsumer {
  readonly consumerId: string;
  readonly relationship: 'invokes-producer' | 'removed-or-migrated';
  readonly evidence: ProductionWiringEvidence;
}

export interface ProductionWiringIngress {
  readonly ingressId: string;
  readonly kind: 'ingress' | 'entrypoint';
  readonly evidence: ProductionWiringEvidence;
}

export interface ProductionWiringEnablementAuthority {
  readonly authorityId: string;
  readonly mechanism: 'configuration' | 'policy' | 'registration' | 'unconditional';
  readonly evidence: ProductionWiringEvidence;
}

export interface ProductionWiringProofTarget {
  readonly proofTargetId: string;
  readonly kind:
    | 'consumer-execution'
    | 'ingress-execution'
    | 'enablement-resolution'
    | 'removal-verification'
    | 'platform'
    | 'scale';
  readonly evidence: ProductionWiringEvidence;
}

export interface ProductionWiringDisposition {
  readonly kind: 'production-wiring';
}

export interface StagedFoundationClosureTask {
  readonly taskId: string;
  readonly dagId: string;
}

export interface StagedFoundationDisposition {
  readonly kind: 'staged-foundation';
  readonly foundationTaskId: string;
  readonly dagId: string;
  readonly closureTasks: readonly StagedFoundationClosureTask[];
  readonly outerSettlementBarrier: {
    readonly kind: 'block-until-exact-closure-settles';
    readonly dagId: string;
    readonly closureTaskIds: readonly string[];
  };
}

export interface ProductionWiringContractV1 {
  readonly version: typeof PRODUCTION_WIRING_CONTRACT_VERSION;
  readonly changeKind: ProductionWiringChangeKind;
  readonly producer: ProductionWiringProducer;
  readonly canonicalConsumer: ProductionWiringCanonicalConsumer;
  readonly affectedIngresses: readonly ProductionWiringIngress[];
  readonly enablementAuthority: ProductionWiringEnablementAuthority;
  readonly disposition: ProductionWiringDisposition | StagedFoundationDisposition;
  readonly proofTargets: readonly ProductionWiringProofTarget[];
}

export interface ProductionWiringContractV2 {
  readonly version: typeof PRODUCTION_WIRING_CONTRACT_V2_VERSION;
  readonly changeKind: ProductionWiringChangeKind;
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
  readonly disposition: ProductionWiringDisposition | StagedFoundationDisposition;
  readonly proofTargets: readonly {
    readonly proofTargetId: string;
    readonly kind: ProductionWiringProofTarget['kind'];
  }[];
  readonly hostProofProgram: ProductionWiringHostProofProgramV1;
}

export interface ProductionWiringContractV2Input {
  readonly version: typeof PRODUCTION_WIRING_CONTRACT_V2_VERSION;
  readonly changeKind: ProductionWiringChangeKind;
  readonly producer: ProductionWiringContractV2['producer'];
  readonly canonicalConsumer: ProductionWiringContractV2['canonicalConsumer'];
  readonly affectedIngresses: ProductionWiringContractV2['affectedIngresses'];
  readonly enablementAuthority: ProductionWiringContractV2['enablementAuthority'];
  readonly disposition: ProductionWiringContractV2['disposition'];
  readonly proofTargets: ProductionWiringContractV2['proofTargets'];
  readonly hostProofProgram: ProductionWiringHostProofProgramInput;
}

export interface ProductionWiringProposalV1 extends ProductionWiringHostProofIdentity {
  readonly version: 1;
  readonly changeKind: ProductionWiringChangeKind;
  readonly disposition: ProductionWiringContractV2['disposition'];
}

export type ProductionWiringProposalCompletionReason =
  | 'proposal-invalid'
  | 'host-proof-profile-unregistered'
  | 'host-proof-assets-unavailable'
  | 'host-proof-contract-invalid';

export class ProductionWiringProposalCompletionError extends TypeError {
  public readonly reasonCode: ProductionWiringProposalCompletionReason;

  constructor(reasonCode: ProductionWiringProposalCompletionReason) {
    super(`production-wiring proposal completion failed: ${reasonCode}`);
    this.name = 'ProductionWiringProposalCompletionError';
    this.reasonCode = reasonCode;
  }
}

export type ProductionWiringContract = ProductionWiringContractV1 | ProductionWiringContractV2;

export type ProductionWiringIssueTarget =
  | 'contract'
  | 'producer'
  | 'canonical-consumer'
  | 'affected-ingress'
  | 'enablement-authority'
  | 'disposition'
  | 'proof-target';

export type ProductionWiringIssueReason =
  | 'unsupported-contract-version'
  | 'missing-identity'
  | 'missing-affected-ingress'
  | 'missing-proof-target'
  | 'missing-evidence-reference'
  | 'presence-only-evidence'
  | 'proof-target-not-executed'
  | 'host-proof-program-invalid'
  | 'host-proof-coverage-missing'
  | 'host-proof-coverage-unexpected'
  | 'host-proof-coverage-duplicate'
  | 'duplicate-affected-ingress'
  | 'duplicate-proof-target'
  | 'evidence-incomplete'
  | 'evidence-unsupported'
  | 'evidence-contradictory'
  | 'foundation-disposition-required'
  | 'foundation-change-kind-required'
  | 'missing-closure-task'
  | 'duplicate-closure-task'
  | 'closure-task-dag-conflict'
  | 'closure-barrier-dag-conflict'
  | 'closure-barrier-task-conflict'
  | 'foundation-self-closure';

export interface ProductionWiringIssue {
  readonly target: ProductionWiringIssueTarget;
  readonly targetId: string | null;
  readonly reasonCode: ProductionWiringIssueReason;
  readonly evidenceRefs: readonly string[];
}

export type ProductionWiringDecision =
  | {
      readonly version: typeof PRODUCTION_WIRING_CONTRACT_VERSION | typeof PRODUCTION_WIRING_CONTRACT_V2_VERSION;
      readonly decision: 'complete';
      readonly disposition: 'production-wired';
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly version: typeof PRODUCTION_WIRING_CONTRACT_VERSION | typeof PRODUCTION_WIRING_CONTRACT_V2_VERSION;
      readonly decision: 'staged-foundation';
      readonly disposition: 'staged-foundation';
      readonly dagId: string;
      readonly foundationTaskId: string;
      readonly closureTaskIds: readonly string[];
      readonly outerSettlement: 'blocked-pending-exact-closure';
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly version: typeof PRODUCTION_WIRING_CONTRACT_VERSION | typeof PRODUCTION_WIRING_CONTRACT_V2_VERSION;
      readonly decision: 'incomplete' | 'unsupported' | 'contradictory';
      readonly disposition: 'hold';
      readonly outerSettlement: 'blocked';
      readonly issues: readonly ProductionWiringIssue[];
    };

function issue(
  target: ProductionWiringIssueTarget,
  targetId: string | null,
  reasonCode: ProductionWiringIssueReason,
  evidenceRefs: readonly string[] = [],
): ProductionWiringIssue {
  return { target, targetId, reasonCode, evidenceRefs };
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
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

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && !isBlank(value) && Buffer.byteLength(value, 'utf8') <= 16 * 1024;
}

function parseIdentityNode(
  value: unknown,
  idKey: string,
  optional: readonly [string, readonly string[]] | null = null,
): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const keys = optional ? [idKey, optional[0]] : [idKey];
  if (!exactKeys(value, keys) || !nonblank(value[idKey])) return null;
  if (optional && !optional[1].includes(String(value[optional[0]]))) return null;
  return Object.fromEntries(keys.map(key => [key, value[key] as string]));
}

function parseDisposition(value: unknown): ProductionWiringContractV2['disposition'] | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'production-wiring' && exactKeys(value, ['kind'])) {
    return { kind: 'production-wiring' };
  }
  if (!exactKeys(value, [
    'kind', 'foundationTaskId', 'dagId', 'closureTasks', 'outerSettlementBarrier',
  ]) || value.kind !== 'staged-foundation' || !nonblank(value.foundationTaskId)
    || !nonblank(value.dagId) || !Array.isArray(value.closureTasks)
    || !isRecord(value.outerSettlementBarrier)) return null;
  const closureTasks = value.closureTasks.map(candidate => {
    if (!isRecord(candidate) || !exactKeys(candidate, ['taskId', 'dagId'])
      || !nonblank(candidate.taskId) || !nonblank(candidate.dagId)) return null;
    return { taskId: candidate.taskId, dagId: candidate.dagId };
  });
  if (closureTasks.some(candidate => candidate === null)) return null;
  const barrier = value.outerSettlementBarrier;
  if (!exactKeys(barrier, ['kind', 'dagId', 'closureTaskIds'])
    || barrier.kind !== 'block-until-exact-closure-settles'
    || !nonblank(barrier.dagId)
    || !Array.isArray(barrier.closureTaskIds)
    || !barrier.closureTaskIds.every(nonblank)) return null;
  return {
    kind: 'staged-foundation',
    foundationTaskId: value.foundationTaskId,
    dagId: value.dagId,
    closureTasks: closureTasks as StagedFoundationClosureTask[],
    outerSettlementBarrier: {
      kind: 'block-until-exact-closure-settles',
      dagId: barrier.dagId,
      closureTaskIds: [...barrier.closureTaskIds] as string[],
    },
  };
}

/** Strict authoring parser shared by AI planner and structured DIRECTIVES. */
export function parseProductionWiringContractV2Input(
  value: unknown,
): ProductionWiringContractV2Input | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'changeKind', 'producer', 'canonicalConsumer', 'affectedIngresses',
    'enablementAuthority', 'disposition', 'proofTargets', 'hostProofProgram',
  ]) || value.version !== PRODUCTION_WIRING_CONTRACT_V2_VERSION
    || !['runtime-addition', 'runtime-change', 'refactor', 'removal', 'foundation',
      'public-library', 'documentation', 'data'].includes(String(value.changeKind))) return null;
  const producer = parseIdentityNode(value.producer, 'producerId');
  const consumer = parseIdentityNode(value.canonicalConsumer, 'consumerId', [
    'relationship', ['invokes-producer', 'removed-or-migrated'],
  ]);
  const enablement = parseIdentityNode(value.enablementAuthority, 'authorityId', [
    'mechanism', ['configuration', 'policy', 'registration', 'unconditional'],
  ]);
  const disposition = parseDisposition(value.disposition);
  const hostProofProgram = parseProductionWiringHostProofProgramInput(value.hostProofProgram);
  if (producer === null || consumer === null || enablement === null
    || disposition === null || hostProofProgram === null
    || !Array.isArray(value.affectedIngresses) || value.affectedIngresses.length === 0
    || !Array.isArray(value.proofTargets) || value.proofTargets.length === 0) return null;
  const affectedIngresses = value.affectedIngresses.map(entry => parseIdentityNode(
    entry, 'ingressId', ['kind', ['ingress', 'entrypoint']],
  ));
  const proofTargets = value.proofTargets.map(entry => parseIdentityNode(entry, 'proofTargetId', [
    'kind', ['consumer-execution', 'ingress-execution', 'enablement-resolution',
      'removal-verification', 'platform', 'scale'],
  ]));
  if (affectedIngresses.some(entry => entry === null) || proofTargets.some(entry => entry === null)) return null;
  return {
    version: PRODUCTION_WIRING_CONTRACT_V2_VERSION,
    changeKind: value.changeKind as ProductionWiringChangeKind,
    producer: producer as unknown as ProductionWiringContractV2['producer'],
    canonicalConsumer: consumer as unknown as ProductionWiringContractV2['canonicalConsumer'],
    affectedIngresses: affectedIngresses as unknown as ProductionWiringContractV2['affectedIngresses'],
    enablementAuthority: enablement as unknown as ProductionWiringContractV2['enablementAuthority'],
    disposition,
    proofTargets: proofTargets as unknown as ProductionWiringContractV2['proofTargets'],
    hostProofProgram,
  };
}

/** Strict model-authoring surface: identities and disposition only, never host authority. */
export function parseProductionWiringProposalV1(value: unknown): ProductionWiringProposalV1 | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'changeKind', 'producer', 'canonicalConsumer', 'affectedIngresses',
    'enablementAuthority', 'disposition', 'proofTargets',
  ]) || value.version !== 1
    || !['runtime-addition', 'runtime-change', 'refactor', 'removal', 'foundation',
      'public-library', 'documentation', 'data'].includes(String(value.changeKind))) return null;
  const producer = parseIdentityNode(value.producer, 'producerId');
  const consumer = parseIdentityNode(value.canonicalConsumer, 'consumerId', [
    'relationship', ['invokes-producer', 'removed-or-migrated'],
  ]);
  const enablement = parseIdentityNode(value.enablementAuthority, 'authorityId', [
    'mechanism', ['configuration', 'policy', 'registration', 'unconditional'],
  ]);
  const disposition = parseDisposition(value.disposition);
  if (producer === null || consumer === null || enablement === null || disposition === null
    || !Array.isArray(value.affectedIngresses) || value.affectedIngresses.length === 0
    || !Array.isArray(value.proofTargets) || value.proofTargets.length === 0) return null;
  const affectedIngresses = value.affectedIngresses.map(entry => parseIdentityNode(
    entry, 'ingressId', ['kind', ['ingress', 'entrypoint']],
  ));
  const proofTargets = value.proofTargets.map(entry => parseIdentityNode(
    entry, 'proofTargetId', ['kind', ['consumer-execution', 'ingress-execution',
      'enablement-resolution', 'removal-verification', 'platform', 'scale']],
  ));
  if (affectedIngresses.some(entry => entry === null)
    || proofTargets.some(entry => entry === null)) return null;
  return deepFreeze({
    version: 1,
    changeKind: value.changeKind as ProductionWiringChangeKind,
    producer: producer as unknown as ProductionWiringProposalV1['producer'],
    canonicalConsumer: consumer as unknown as ProductionWiringProposalV1['canonicalConsumer'],
    affectedIngresses: affectedIngresses as unknown as ProductionWiringProposalV1['affectedIngresses'],
    enablementAuthority: enablement as unknown as ProductionWiringProposalV1['enablementAuthority'],
    disposition,
    proofTargets: proofTargets as unknown as ProductionWiringProposalV1['proofTargets'],
  });
}

/**
 * Compatibility reader for old planner output. A supplied V2 program is deliberately discarded;
 * only its identity fields cross the model/host boundary.
 */
export function parseProductionWiringProposalFromPlannerValue(
  value: unknown,
): ProductionWiringProposalV1 | null {
  const proposal = parseProductionWiringProposalV1(value);
  if (proposal) return proposal;
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'changeKind', 'producer', 'canonicalConsumer', 'affectedIngresses',
    'enablementAuthority', 'disposition', 'proofTargets', 'hostProofProgram',
  ]) || value.version !== 2) return null;
  return parseProductionWiringProposalV1({
    version: 1,
    changeKind: value.changeKind,
    producer: value.producer,
    canonicalConsumer: value.canonicalConsumer,
    affectedIngresses: value.affectedIngresses,
    enablementAuthority: value.enablementAuthority,
    disposition: value.disposition,
    proofTargets: value.proofTargets,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Host canonicalizer; authored JSON never supplies a contract or program digest. */
export function createProductionWiringContractV2(
  input: ProductionWiringContractV2Input,
): ProductionWiringContractV2 {
  const parsed = parseProductionWiringContractV2Input(input);
  if (parsed === null) throw new TypeError('invalid production-wiring contract v2 input');
  const contract: ProductionWiringContractV2 = {
    ...parsed,
    hostProofProgram: createProductionWiringHostProofProgram(parsed.hostProofProgram),
  };
  const coverage = validateProductionWiringHostProofCoverage(contract.hostProofProgram, {
    producerId: contract.producer.producerId,
    canonicalConsumerId: contract.canonicalConsumer.consumerId,
    canonicalConsumerRelationship: contract.canonicalConsumer.relationship,
    affectedIngressIds: contract.affectedIngresses.map(entry => entry.ingressId),
    enablementAuthorityId: contract.enablementAuthority.authorityId,
    proofTargets: contract.proofTargets,
  });
  if (coverage.state === 'hold') {
    throw new TypeError(`invalid production-wiring host proof coverage: ${coverage.reasonCode}`);
  }
  return deepFreeze(contract);
}

export function completeProductionWiringFromProposal(
  value: unknown,
  context: Readonly<{ readonly projectRoot: string }>,
): ProductionWiringContractV2 {
  const proposal = parseProductionWiringProposalFromPlannerValue(value);
  if (!proposal) throw new ProductionWiringProposalCompletionError('proposal-invalid');
  if (!isProductionWiringHostProofIdentityRegistered(proposal)) {
    throw new ProductionWiringProposalCompletionError('host-proof-profile-unregistered');
  }
  const hostProofProgram = createRegisteredProductionWiringHostProofProgram(
    proposal,
    context.projectRoot,
  );
  if (!hostProofProgram) {
    throw new ProductionWiringProposalCompletionError('host-proof-assets-unavailable');
  }
  try {
    return createProductionWiringContractV2({
      version: 2,
      changeKind: proposal.changeKind,
      producer: proposal.producer,
      canonicalConsumer: proposal.canonicalConsumer,
      affectedIngresses: proposal.affectedIngresses,
      enablementAuthority: proposal.enablementAuthority,
      disposition: proposal.disposition,
      proofTargets: proposal.proofTargets,
      hostProofProgram,
    });
  } catch {
    throw new ProductionWiringProposalCompletionError('host-proof-contract-invalid');
  }
}

/** Lossless canonical-contract projection for the existing structured DIRECTIVES reader. */
export function productionWiringContractV2InputFromCanonical(
  contract: ProductionWiringContractV2,
): ProductionWiringContractV2Input {
  const program = contract.hostProofProgram;
  return {
    version: 2,
    changeKind: contract.changeKind,
    producer: contract.producer,
    canonicalConsumer: contract.canonicalConsumer,
    affectedIngresses: contract.affectedIngresses,
    enablementAuthority: contract.enablementAuthority,
    disposition: contract.disposition,
    proofTargets: contract.proofTargets,
    hostProofProgram: {
      network: program.network,
      verifierAssets: program.verifierAssets,
      platforms: program.platforms.map(platform => platform.state === 'unsupported'
        ? platform
        : {
            platform: platform.platform,
            state: platform.state,
            runnerAdapterId: platform.runnerAdapterId,
            probes: platform.probes.map(({ probeId: _probeId, ...probe }) => probe),
          }),
    },
  };
}

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

/** Strict historical/current reader; it never repairs caller-authored digests. */
export function parseProductionWiringContractV2(value: unknown): ProductionWiringContractV2 | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'changeKind', 'producer', 'canonicalConsumer', 'affectedIngresses',
    'enablementAuthority', 'disposition', 'proofTargets', 'hostProofProgram',
  ])) return null;
  const program = parseProductionWiringHostProofProgram(value.hostProofProgram);
  if (program === null) return null;
  const programInput: ProductionWiringHostProofProgramInput = {
    network: program.network,
    verifierAssets: program.verifierAssets,
    platforms: program.platforms.map(platform => platform.state === 'unsupported'
      ? platform
      : {
          platform: platform.platform,
          state: platform.state,
          runnerAdapterId: platform.runnerAdapterId,
          probes: platform.probes.map(({ probeId: _probeId, ...probe }) => probe),
        }),
  };
  const input = parseProductionWiringContractV2Input({ ...value, hostProofProgram: programInput });
  if (input === null) return null;
  let canonical: ProductionWiringContractV2;
  try {
    canonical = createProductionWiringContractV2(input);
  } catch {
    return null;
  }
  return canonicalJson(canonical) === canonicalJson(value) ? canonical : null;
}

function evidenceIssues(
  target: ProductionWiringIssueTarget,
  targetId: string,
  evidence: ProductionWiringEvidence,
  requiresExecution: boolean,
): ProductionWiringIssue[] {
  if (isBlank(targetId)) {
    return [issue(target, null, 'missing-identity', evidence.evidenceRefs)];
  }

  switch (evidence.state) {
    case 'complete': {
      if (evidence.evidenceRefs.length === 0 || evidence.evidenceRefs.some(isBlank)) {
        return [issue(target, targetId, 'missing-evidence-reference', evidence.evidenceRefs)];
      }
      if (
        requiresExecution
        && evidence.basis !== 'executed-production-path'
        && evidence.basis !== 'host-attested-execution'
      ) {
        return [issue(target, targetId, 'proof-target-not-executed', evidence.evidenceRefs)];
      }
      return [];
    }
    case 'presence-only':
      return [issue(target, targetId, 'presence-only-evidence', evidence.evidenceRefs)];
    case 'incomplete':
      return [issue(target, targetId, 'evidence-incomplete', evidence.evidenceRefs)];
    case 'unsupported':
      return [issue(target, targetId, 'evidence-unsupported', evidence.evidenceRefs)];
    case 'contradictory':
      return [issue(target, targetId, 'evidence-contradictory', evidence.evidenceRefs)];
  }
}

function collectEvidenceRefs(contract: ProductionWiringContractV1): string[] {
  const refs = [
    ...contract.producer.evidence.evidenceRefs,
    ...contract.canonicalConsumer.evidence.evidenceRefs,
    ...contract.affectedIngresses.flatMap(ingress => ingress.evidence.evidenceRefs),
    ...contract.enablementAuthority.evidence.evidenceRefs,
    ...contract.proofTargets.flatMap(target => target.evidence.evidenceRefs),
  ];
  return [...new Set(refs.filter(ref => !isBlank(ref)))];
}

function stagedDispositionIssues(
  contract: ProductionWiringContractV1,
  disposition: StagedFoundationDisposition,
): ProductionWiringIssue[] {
  const issues: ProductionWiringIssue[] = [];
  if (contract.changeKind !== 'foundation') {
    issues.push(issue('disposition', disposition.foundationTaskId, 'foundation-change-kind-required'));
  }
  if (isBlank(disposition.foundationTaskId) || isBlank(disposition.dagId)) {
    issues.push(issue('disposition', null, 'missing-identity'));
  }
  if (disposition.closureTasks.length === 0) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'missing-closure-task'));
  }

  const taskIds = disposition.closureTasks.map(task => task.taskId);
  if (taskIds.some(isBlank) || disposition.closureTasks.some(task => isBlank(task.dagId))) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'missing-identity'));
  }
  if (new Set(taskIds).size !== taskIds.length) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'duplicate-closure-task'));
  }
  if (taskIds.includes(disposition.foundationTaskId)) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'foundation-self-closure'));
  }
  if (disposition.closureTasks.some(task => task.dagId !== disposition.dagId)) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'closure-task-dag-conflict'));
  }

  const barrier = disposition.outerSettlementBarrier;
  if (barrier.dagId !== disposition.dagId) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'closure-barrier-dag-conflict'));
  }
  const barrierIds = barrier.closureTaskIds;
  const exactClosureSet = taskIds.length === barrierIds.length
    && new Set(taskIds).size === taskIds.length
    && new Set(barrierIds).size === barrierIds.length
    && taskIds.every(taskId => barrierIds.includes(taskId));
  if (!exactClosureSet) {
    issues.push(issue('disposition', disposition.foundationTaskId, 'closure-barrier-task-conflict'));
  }
  return issues;
}

function classifyDecision(issues: readonly ProductionWiringIssue[]): 'incomplete' | 'unsupported' | 'contradictory' {
  const contradictoryReasons: ReadonlySet<ProductionWiringIssueReason> = new Set([
    'evidence-contradictory',
    'foundation-disposition-required',
    'foundation-change-kind-required',
    'duplicate-closure-task',
    'closure-task-dag-conflict',
    'closure-barrier-dag-conflict',
    'closure-barrier-task-conflict',
    'foundation-self-closure',
  ]);
  if (issues.some(candidate => contradictoryReasons.has(candidate.reasonCode))) return 'contradictory';
  if (issues.some(candidate => candidate.reasonCode === 'unsupported-contract-version'
    || candidate.reasonCode === 'evidence-unsupported')) return 'unsupported';
  return 'incomplete';
}

function resolveProductionWiringContractV2(
  contract: ProductionWiringContractV2,
): ProductionWiringDecision {
  const issues: ProductionWiringIssue[] = [];
  if (contract.version !== PRODUCTION_WIRING_CONTRACT_V2_VERSION) {
    issues.push(issue('contract', null, 'unsupported-contract-version'));
  }
  if (isBlank(contract.producer.producerId)) issues.push(issue('producer', null, 'missing-identity'));
  if (isBlank(contract.canonicalConsumer.consumerId)) {
    issues.push(issue('canonical-consumer', null, 'missing-identity'));
  }
  if (contract.affectedIngresses.length === 0) {
    issues.push(issue('affected-ingress', null, 'missing-affected-ingress'));
  }
  const ingressIds = contract.affectedIngresses.map(entry => entry.ingressId);
  if (new Set(ingressIds).size !== ingressIds.length) {
    issues.push(issue('affected-ingress', null, 'duplicate-affected-ingress'));
  }
  for (const ingress of contract.affectedIngresses) {
    if (isBlank(ingress.ingressId)) issues.push(issue('affected-ingress', null, 'missing-identity'));
  }
  if (isBlank(contract.enablementAuthority.authorityId)) {
    issues.push(issue('enablement-authority', null, 'missing-identity'));
  }
  if (contract.proofTargets.length === 0) {
    issues.push(issue('proof-target', null, 'missing-proof-target'));
  }
  const proofTargetIds = contract.proofTargets.map(entry => entry.proofTargetId);
  if (new Set(proofTargetIds).size !== proofTargetIds.length) {
    issues.push(issue('proof-target', null, 'duplicate-proof-target'));
  }
  for (const proofTarget of contract.proofTargets) {
    if (isBlank(proofTarget.proofTargetId)) issues.push(issue('proof-target', null, 'missing-identity'));
  }
  if (contract.disposition.kind === 'staged-foundation') {
    issues.push(...stagedDispositionIssues(
      contract as unknown as ProductionWiringContractV1,
      contract.disposition,
    ));
  } else if (contract.changeKind === 'foundation') {
    issues.push(issue('disposition', null, 'foundation-disposition-required'));
  }
  const coverage = validateProductionWiringHostProofCoverage(contract.hostProofProgram, {
    producerId: contract.producer.producerId,
    canonicalConsumerId: contract.canonicalConsumer.consumerId,
    canonicalConsumerRelationship: contract.canonicalConsumer.relationship,
    affectedIngressIds: ingressIds,
    enablementAuthorityId: contract.enablementAuthority.authorityId,
    proofTargets: contract.proofTargets,
  });
  if (coverage.state === 'hold') {
    const reasonCode = coverage.reasonCode === 'unexpected-proof-target'
      ? 'host-proof-coverage-unexpected'
      : coverage.reasonCode === 'duplicate-proof-target'
        ? 'host-proof-coverage-duplicate'
        : 'host-proof-coverage-missing';
    issues.push(issue('proof-target', coverage.targetKey ?? null, reasonCode));
  }
  if (issues.length > 0) {
    return {
      version: PRODUCTION_WIRING_CONTRACT_V2_VERSION,
      decision: classifyDecision(issues),
      disposition: 'hold',
      outerSettlement: 'blocked',
      issues,
    };
  }
  if (contract.disposition.kind === 'staged-foundation') {
    return {
      version: PRODUCTION_WIRING_CONTRACT_V2_VERSION,
      decision: 'staged-foundation',
      disposition: 'staged-foundation',
      dagId: contract.disposition.dagId,
      foundationTaskId: contract.disposition.foundationTaskId,
      closureTaskIds: contract.disposition.closureTasks.map(task => task.taskId),
      outerSettlement: 'blocked-pending-exact-closure',
      evidenceRefs: [],
    };
  }
  // `complete` means the immutable plan topology and proof coverage are complete;
  // runtime success remains impossible without the independent host settlement.
  return {
    version: PRODUCTION_WIRING_CONTRACT_V2_VERSION,
    decision: 'complete',
    disposition: 'production-wired',
    evidenceRefs: [],
  };
}

/**
 * Resolve one immutable wiring declaration against its bounded evidence.
 * Contradiction outranks unsupported evidence, which outranks incompleteness.
 * A valid staged foundation remains blocked at the outer settlement boundary.
 */
export function resolveProductionWiringContract(
  contract: ProductionWiringContract,
): ProductionWiringDecision {
  if (contract.version === PRODUCTION_WIRING_CONTRACT_V2_VERSION) {
    return resolveProductionWiringContractV2(contract);
  }
  const issues: ProductionWiringIssue[] = [];

  if (contract.version !== PRODUCTION_WIRING_CONTRACT_VERSION) {
    issues.push(issue('contract', null, 'unsupported-contract-version'));
  }
  issues.push(...evidenceIssues(
    'producer',
    contract.producer.producerId,
    contract.producer.evidence,
    false,
  ));
  issues.push(...evidenceIssues(
    'canonical-consumer',
    contract.canonicalConsumer.consumerId,
    contract.canonicalConsumer.evidence,
    false,
  ));

  if (contract.affectedIngresses.length === 0) {
    issues.push(issue('affected-ingress', null, 'missing-affected-ingress'));
  }
  for (const ingress of contract.affectedIngresses) {
    issues.push(...evidenceIssues(
      'affected-ingress',
      ingress.ingressId,
      ingress.evidence,
      false,
    ));
  }

  issues.push(...evidenceIssues(
    'enablement-authority',
    contract.enablementAuthority.authorityId,
    contract.enablementAuthority.evidence,
    false,
  ));

  if (contract.proofTargets.length === 0) {
    issues.push(issue('proof-target', null, 'missing-proof-target'));
  }
  for (const proofTarget of contract.proofTargets) {
    issues.push(...evidenceIssues(
      'proof-target',
      proofTarget.proofTargetId,
      proofTarget.evidence,
      true,
    ));
  }

  if (contract.disposition.kind === 'staged-foundation') {
    issues.push(...stagedDispositionIssues(contract, contract.disposition));
  } else if (contract.changeKind === 'foundation') {
    issues.push(issue('disposition', null, 'foundation-disposition-required'));
  }

  if (issues.length > 0) {
    return {
      version: PRODUCTION_WIRING_CONTRACT_VERSION,
      decision: classifyDecision(issues),
      disposition: 'hold',
      outerSettlement: 'blocked',
      issues,
    };
  }

  const evidenceRefs = collectEvidenceRefs(contract);
  if (contract.disposition.kind === 'staged-foundation') {
    return {
      version: PRODUCTION_WIRING_CONTRACT_VERSION,
      decision: 'staged-foundation',
      disposition: 'staged-foundation',
      dagId: contract.disposition.dagId,
      foundationTaskId: contract.disposition.foundationTaskId,
      closureTaskIds: contract.disposition.closureTasks.map(task => task.taskId),
      outerSettlement: 'blocked-pending-exact-closure',
      evidenceRefs,
    };
  }
  return {
    version: PRODUCTION_WIRING_CONTRACT_VERSION,
    decision: 'complete',
    disposition: 'production-wired',
    evidenceRefs,
  };
}
