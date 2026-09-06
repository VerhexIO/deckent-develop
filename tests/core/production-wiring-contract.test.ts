import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_WIRING_CONTRACT_VERSION,
  completeProductionWiringFromProposal,
  createProductionWiringContractV2,
  parseProductionWiringContractV2,
  productionWiringContractV2InputFromCanonical,
  resolveProductionWiringContract,
  type ProductionWiringContractV2Input,
  type ProductionWiringContractV1,
  type ProductionWiringEvidence,
} from '../../src/core/production-wiring-contract.js';
import {
  MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY,
  TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
  createProductionWiringHostProofProgram,
  isProductionWiringHostProofIdentityRegistered,
  parseProductionWiringHostProofProgram,
  parseProductionWiringHostProofProgramInput,
  validateProductionWiringHostProofCoverage,
} from '../../src/core/production-wiring-host-proof.js';
import {
  createProductionWiringPlanEvidenceV2,
  productionWiringVerifierAssetWriteScopeOverlap,
} from '../../src/core/task-types.js';

const completeAuthorityEvidence: ProductionWiringEvidence = {
  state: 'complete',
  basis: 'authority-record',
  evidenceRefs: ['authority:task-contract:sha256'],
};

const executedEvidence: ProductionWiringEvidence = {
  state: 'complete',
  basis: 'host-attested-execution',
  evidenceRefs: ['receipt:host-execution:001'],
};

function contract(
  overrides: Partial<ProductionWiringContractV1> = {},
): ProductionWiringContractV1 {
  return {
    version: PRODUCTION_WIRING_CONTRACT_VERSION,
    changeKind: 'runtime-change',
    producer: {
      producerId: 'runtime.producer',
      evidence: completeAuthorityEvidence,
    },
    canonicalConsumer: {
      consumerId: 'runtime.canonical-consumer',
      relationship: 'invokes-producer',
      evidence: executedEvidence,
    },
    affectedIngresses: [{
      ingressId: 'terminal.entrypoint',
      kind: 'entrypoint',
      evidence: executedEvidence,
    }],
    enablementAuthority: {
      authorityId: 'effective-config.policy',
      mechanism: 'policy',
      evidence: completeAuthorityEvidence,
    },
    disposition: { kind: 'production-wiring' },
    proofTargets: [{
      proofTargetId: 'terminal-to-consumer',
      kind: 'ingress-execution',
      evidence: executedEvidence,
    }],
    ...overrides,
  };
}

function v2Input(): ProductionWiringContractV2Input {
  const probe = (kind: 'producer' | 'canonical-consumer' | 'affected-ingress' | 'enablement-authority' | 'proof-target', targetId: string) => ({
    target: { kind, targetId },
    observationGroupId: kind === 'producer' || kind === 'canonical-consumer' ? 'runtime-path-observation' : `${kind}:${targetId}`,
    harnessPath: 'scripts/production-wiring-proof.mjs',
    verifierAssetPaths: ['scripts/production-wiring-proof.mjs'],
    args: kind === 'producer' || kind === 'canonical-consumer' ? ['observe-runtime-relation'] : ['observe', targetId],
    cwd: '.',
    timeoutMs: 30_000,
    outputLimitBytes: 1024 * 1024,
    expectation: { kind: 'adapter-structured-outcome' as const, schemaId: 'deckent.production-wiring-observation.v1', outcome: 'observed' as const },
  });
  return {
    version: 2,
    changeKind: 'runtime-change',
    producer: { producerId: 'runtime.producer' },
    canonicalConsumer: { consumerId: 'runtime.consumer', relationship: 'invokes-producer' },
    affectedIngresses: [{ ingressId: 'terminal.entrypoint', kind: 'entrypoint' }],
    enablementAuthority: { authorityId: 'effective-config.policy', mechanism: 'policy' },
    disposition: { kind: 'production-wiring' },
    proofTargets: [{ proofTargetId: 'terminal-to-consumer', kind: 'ingress-execution' }],
    hostProofProgram: {
      network: 'forbidden',
      verifierAssets: [{ path: 'scripts/production-wiring-proof.mjs', sha256: `sha256:${'a'.repeat(64)}`, role: 'trusted-harness' }],
      platforms: [
        { platform: 'linux', state: 'unsupported', reasonCode: 'environment-unavailable' },
        {
          platform: 'wsl2-linux',
          state: 'supported',
          runnerAdapterId: 'native-bounded-process-v1',
          probes: [
            probe('producer', 'runtime.producer'),
            probe('canonical-consumer', 'runtime.consumer'),
            probe('affected-ingress', 'terminal.entrypoint'),
            probe('enablement-authority', 'effective-config.policy'),
            probe('proof-target', 'terminal-to-consumer'),
          ],
        },
        { platform: 'darwin', state: 'unsupported', reasonCode: 'owner-deferred' },
        { platform: 'win32', state: 'unsupported', reasonCode: 'owner-deferred' },
      ],
    },
  };
}

describe('production wiring contract', () => {
  const memoryProposal = () => ({
    version: 1 as const,
    changeKind: 'runtime-change' as const,
    ...MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY,
    disposition: { kind: 'production-wiring' as const },
  });

  it('registers the exact memory compact read/export identity without changing Terminal authority', () => {
    expect(isProductionWiringHostProofIdentityRegistered(
      MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY,
    )).toBe(true);
    expect(isProductionWiringHostProofIdentityRegistered(
      TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
    )).toBe(true);

    const terminalContract = completeProductionWiringFromProposal({
      version: 1,
      changeKind: 'runtime-change',
      ...TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
      disposition: { kind: 'production-wiring' },
    }, { projectRoot: process.cwd() });
    expect(terminalContract.hostProofProgram.verifierAssets.map(asset => asset.path)).toEqual([
      'scripts/production-wiring-host-proof-harness.mjs',
    ]);
  });

  it('completes only the exact memory identity into its two-asset bounded platform profile', () => {
    const contract = completeProductionWiringFromProposal(memoryProposal(), {
      projectRoot: process.cwd(),
    });

    expect(contract).toMatchObject({
      version: 2,
      producer: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.producer,
      canonicalConsumer: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.canonicalConsumer,
      affectedIngresses: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.affectedIngresses,
      enablementAuthority: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.enablementAuthority,
      proofTargets: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.proofTargets,
    });
    expect(contract.hostProofProgram.verifierAssets.map(asset => ({
      path: asset.path,
      role: asset.role,
    }))).toEqual([
      { path: 'scripts/production-wiring-host-proof-harness.mjs', role: 'trusted-harness' },
      { path: 'scripts/memory-compact-host-proof-observer.mjs', role: 'trusted-harness' },
    ]);
    expect(contract.hostProofProgram.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'linux', state: 'supported' }),
      expect.objectContaining({ platform: 'wsl2-linux', state: 'supported' }),
      { platform: 'darwin', state: 'unsupported', reasonCode: 'capability-unavailable' },
      { platform: 'win32', state: 'unsupported', reasonCode: 'capability-unavailable' },
    ]));
  });

  it('rejects near-match and foreign memory identities instead of borrowing the registered profile', () => {
    const nearMatch = {
      ...MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY,
      proofTargets: MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY.proofTargets.map((target, index) =>
        index === 0 ? { ...target, proofTargetId: `${target.proofTargetId}.renamed` } : target),
    };
    const foreign = {
      ...MEMORY_COMPACT_READ_EXPORT_PROOF_IDENTITY,
      producer: { producerId: 'deckent.memory-store.foreign-read-model' },
    };

    expect(isProductionWiringHostProofIdentityRegistered(nearMatch)).toBe(false);
    expect(isProductionWiringHostProofIdentityRegistered(foreign)).toBe(false);
    expect(() => completeProductionWiringFromProposal({
      ...memoryProposal(),
      ...nearMatch,
    }, { projectRoot: process.cwd() })).toThrow(/host-proof-profile-unregistered/u);
    expect(() => completeProductionWiringFromProposal({
      ...memoryProposal(),
      ...foreign,
    }, { projectRoot: process.cwd() })).toThrow(/host-proof-profile-unregistered/u);
  });

  it('keeps both memory verifier assets outside the later feature task write scope', () => {
    const contract = completeProductionWiringFromProposal(memoryProposal(), {
      projectRoot: process.cwd(),
    });
    const authority = createProductionWiringPlanEvidenceV2(
      productionWiringContractV2InputFromCanonical(contract),
    );

    expect(productionWiringVerifierAssetWriteScopeOverlap({
      directories: [],
      filesRead: [
        'scripts/production-wiring-host-proof-harness.mjs',
        'scripts/memory-compact-host-proof-observer.mjs',
      ],
      filesWrite: ['src/core/memory-query.ts', 'src/core/memory-export.ts'],
    }, authority)).toBeNull();
    expect(productionWiringVerifierAssetWriteScopeOverlap({
      directories: ['scripts/'],
      filesRead: [],
      filesWrite: [],
    }, authority)).toBe('scripts/production-wiring-host-proof-harness.mjs');

    const tampered = structuredClone(contract.hostProofProgram) as unknown as {
      verifierAssets: Array<{ sha256: string }>;
    };
    tampered.verifierAssets[1]!.sha256 = `sha256:${'f'.repeat(64)}`;
    expect(parseProductionWiringHostProofProgram(tampered)).toBeNull();
  });

  it('canonicalizes a V2 read-only proof program and resolves only exact declared coverage', () => {
    const canonical = createProductionWiringContractV2(v2Input());
    const decision = resolveProductionWiringContract(canonical);

    expect(decision).toMatchObject({ version: 2, decision: 'complete' });
    expect(canonical.hostProofProgram).toMatchObject({
      executionClass: 'read-only-idempotent',
      effect: 'read-only',
      replayPolicy: 'reuse-terminal-receipt',
      shell: 'forbidden',
      ambientEnvironment: 'forbidden',
    });
    expect(canonical.hostProofProgram.programDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(canonical)).not.toContain('evidenceRefs');
    expect(parseProductionWiringContractV2(structuredClone(canonical))).toEqual(canonical);
  });

  it('holds missing, duplicate, and unexpected host proof target coverage', () => {
    const input = v2Input();
    const program = createProductionWiringHostProofProgram(input.hostProofProgram);
    const supported = program.platforms.find(entry => entry.state === 'supported');
    if (!supported || supported.state !== 'supported') throw new Error('supported fixture absent');
    const baseCoverage = {
      producerId: 'runtime.producer',
      canonicalConsumerId: 'runtime.consumer',
      canonicalConsumerRelationship: 'invokes-producer' as const,
      affectedIngressIds: ['terminal.entrypoint'],
      enablementAuthorityId: 'effective-config.policy',
      proofTargets: [{ proofTargetId: 'terminal-to-consumer', kind: 'ingress-execution' }],
    };
    expect(validateProductionWiringHostProofCoverage(program, baseCoverage)).toEqual({ state: 'valid' });

    const missingProgram = { ...program, platforms: program.platforms.map(entry => entry.state !== 'supported'
      ? entry : { ...entry, probes: entry.probes.slice(1) }) };
    expect(validateProductionWiringHostProofCoverage(missingProgram, baseCoverage)).toMatchObject({
      state: 'hold', reasonCode: 'missing-proof-target', platform: 'wsl2-linux',
    });

    const duplicateProgram = { ...program, platforms: program.platforms.map(entry => entry.state !== 'supported'
      ? entry : { ...entry, probes: [...entry.probes, entry.probes[0]!] }) };
    expect(validateProductionWiringHostProofCoverage(duplicateProgram, baseCoverage)).toMatchObject({
      state: 'hold', reasonCode: 'duplicate-proof-target', platform: 'wsl2-linux',
    });
  });

  it('rejects a missing producer target and an unbound producer-consumer relationship', () => {
    const missing = v2Input();
    const supported = missing.hostProofProgram.platforms.find(entry => entry.state === 'supported');
    if (!supported || supported.state !== 'supported') throw new Error('fixture');
    (supported as unknown as { probes: typeof supported.probes }).probes =
      supported.probes.filter(probe => probe.target.kind !== 'producer');
    expect(() => createProductionWiringContractV2(missing)).toThrow(/coverage/u);

    const unbound = v2Input();
    const unboundSupported = unbound.hostProofProgram.platforms.find(entry => entry.state === 'supported');
    if (!unboundSupported || unboundSupported.state !== 'supported') throw new Error('fixture');
    const consumer = unboundSupported.probes.find(probe => probe.target.kind === 'canonical-consumer');
    if (!consumer) throw new Error('fixture');
    (consumer as unknown as { observationGroupId: string }).observationGroupId = 'separate-self-assertion';
    expect(() => createProductionWiringContractV2(unbound)).toThrow(/coverage/u);
  });

  it('rejects ambiguous adapter authority and divergent execution within one observation group', () => {
    const extraAdapter = v2Input().hostProofProgram;
    const supported = extraAdapter.platforms.find(entry => entry.state === 'supported');
    if (!supported || supported.state !== 'supported') throw new Error('fixture');
    (supported.probes[0] as unknown as Record<string, unknown>).adapterId = 'second-authority';
    expect(parseProductionWiringHostProofProgramInput(extraAdapter)).toBeNull();

    const divergent = v2Input().hostProofProgram;
    const divergentSupported = divergent.platforms.find(entry => entry.state === 'supported');
    if (!divergentSupported || divergentSupported.state !== 'supported') throw new Error('fixture');
    const consumer = divergentSupported.probes.find(probe => probe.target.kind === 'canonical-consumer');
    if (!consumer) throw new Error('fixture');
    (consumer as unknown as { args: string[] }).args = ['self-assert-consumer'];
    expect(parseProductionWiringHostProofProgramInput(divergent)).toBeNull();
  });

  it('rejects a mutated host program digest rather than repairing it', () => {
    const program = createProductionWiringHostProofProgram(v2Input().hostProofProgram);
    expect(parseProductionWiringHostProofProgram({
      ...program,
      programDigest: 'f'.repeat(64),
    })).toBeNull();
    expect(parseProductionWiringHostProofProgram({
      ...program,
      verifierAssets: [{ ...program.verifierAssets[0]!, sha256: `sha256:${'b'.repeat(64)}` }],
    })).toBeNull();
  });

  it('resolves a fully evidenced production path without a generic wired boolean', () => {
    const decision = resolveProductionWiringContract(contract());

    expect(decision).toEqual({
      version: PRODUCTION_WIRING_CONTRACT_VERSION,
      decision: 'complete',
      disposition: 'production-wired',
      evidenceRefs: [
        'authority:task-contract:sha256',
        'receipt:host-execution:001',
      ],
    });
    expect(decision).not.toHaveProperty('wired');
  });

  it('holds incomplete topology and evidence with stable typed reasons', () => {
    const decision = resolveProductionWiringContract(contract({
      affectedIngresses: [],
      proofTargets: [{
        proofTargetId: 'consumer-proof',
        kind: 'consumer-execution',
        evidence: {
          state: 'incomplete',
          reasonCode: 'not-executed',
          evidenceRefs: [],
        },
      }],
    }));

    expect(decision.decision).toBe('incomplete');
    expect(decision.disposition).toBe('hold');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues.map(candidate => candidate.reasonCode)).toEqual([
      'missing-affected-ingress',
      'evidence-incomplete',
    ]);
  });

  it('resolves unsupported capability separately from incomplete evidence', () => {
    const decision = resolveProductionWiringContract(contract({
      enablementAuthority: {
        authorityId: 'native-platform-policy',
        mechanism: 'policy',
        evidence: {
          state: 'unsupported',
          reasonCode: 'environment-unavailable',
          evidenceRefs: ['capability:native-platform:unsupported'],
        },
      },
    }));

    expect(decision.decision).toBe('unsupported');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues).toContainEqual(expect.objectContaining({
      target: 'enablement-authority',
      reasonCode: 'evidence-unsupported',
    }));
  });

  it('fails closed on contradictory evidence with precedence over unsupported evidence', () => {
    const decision = resolveProductionWiringContract(contract({
      canonicalConsumer: {
        consumerId: 'runtime.canonical-consumer',
        relationship: 'invokes-producer',
        evidence: {
          state: 'contradictory',
          reasonCode: 'observation-conflict',
          evidenceRefs: ['observation:a', 'observation:b'],
        },
      },
      enablementAuthority: {
        authorityId: 'platform-policy',
        mechanism: 'policy',
        evidence: {
          state: 'unsupported',
          reasonCode: 'adapter-unavailable',
          evidenceRefs: ['adapter:none'],
        },
      },
    }));

    expect(decision.decision).toBe('contradictory');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues.map(candidate => candidate.reasonCode)).toEqual([
      'evidence-contradictory',
      'evidence-unsupported',
    ]);
  });

  it.each([
    ['code-presence', 'source:file'],
    ['test-presence', 'test:file'],
    ['static-reachability', 'graph:edge'],
    ['import-count', 'imports:4'],
  ] as const)('never promotes %s evidence to completion', (basis, evidenceRef) => {
    const decision = resolveProductionWiringContract(contract({
      canonicalConsumer: {
        consumerId: 'runtime.canonical-consumer',
        relationship: 'invokes-producer',
        evidence: {
          state: 'presence-only',
          basis,
          evidenceRefs: [evidenceRef],
        },
      },
    }));

    expect(decision.decision).toBe('incomplete');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues).toContainEqual(expect.objectContaining({
      target: 'canonical-consumer',
      reasonCode: 'presence-only-evidence',
    }));
  });

  it('requires an executed proof target even when an authority record declares it complete', () => {
    const decision = resolveProductionWiringContract(contract({
      proofTargets: [{
        proofTargetId: 'declared-only-proof',
        kind: 'consumer-execution',
        evidence: completeAuthorityEvidence,
      }],
    }));

    expect(decision.decision).toBe('incomplete');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues[0]?.reasonCode).toBe('proof-target-not-executed');
  });

  it('does not grant public-library changes an implicit wiring exemption', () => {
    const decision = resolveProductionWiringContract(contract({
      changeKind: 'public-library',
      affectedIngresses: [],
      proofTargets: [],
    }));

    expect(decision.decision).toBe('incomplete');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues.map(candidate => candidate.reasonCode)).toEqual([
      'missing-affected-ingress',
      'missing-proof-target',
    ]);
  });

  it('accepts Task 25 only as a same-DAG staged foundation with an outer barrier', () => {
    const closureTaskIds = ['486-026', '486-029', '486-030', '486-031'];
    const decision = resolveProductionWiringContract(contract({
      changeKind: 'foundation',
      disposition: {
        kind: 'staged-foundation',
        foundationTaskId: '486-025',
        dagId: 'sprint-486',
        closureTasks: closureTaskIds.map(taskId => ({ taskId, dagId: 'sprint-486' })),
        outerSettlementBarrier: {
          kind: 'block-until-exact-closure-settles',
          dagId: 'sprint-486',
          closureTaskIds,
        },
      },
    }));

    expect(decision).toMatchObject({
      decision: 'staged-foundation',
      disposition: 'staged-foundation',
      dagId: 'sprint-486',
      foundationTaskId: '486-025',
      closureTaskIds,
      outerSettlement: 'blocked-pending-exact-closure',
    });
  });

  it.each([
    {
      name: 'foreign DAG task',
      closureTasks: [
        { taskId: '486-026', dagId: 'sprint-486' },
        { taskId: '486-031', dagId: 'sprint-foreign' },
      ],
      barrierDagId: 'sprint-486',
      barrierTaskIds: ['486-026', '486-031'],
      reasonCode: 'closure-task-dag-conflict',
    },
    {
      name: 'non-exact barrier task set',
      closureTasks: [
        { taskId: '486-026', dagId: 'sprint-486' },
        { taskId: '486-031', dagId: 'sprint-486' },
      ],
      barrierDagId: 'sprint-486',
      barrierTaskIds: ['486-026'],
      reasonCode: 'closure-barrier-task-conflict',
    },
    {
      name: 'foreign barrier DAG',
      closureTasks: [{ taskId: '486-031', dagId: 'sprint-486' }],
      barrierDagId: 'sprint-foreign',
      barrierTaskIds: ['486-031'],
      reasonCode: 'closure-barrier-dag-conflict',
    },
  ])('rejects a staged foundation with $name', ({
    closureTasks,
    barrierDagId,
    barrierTaskIds,
    reasonCode,
  }) => {
    const decision = resolveProductionWiringContract(contract({
      changeKind: 'foundation',
      disposition: {
        kind: 'staged-foundation',
        foundationTaskId: '486-025',
        dagId: 'sprint-486',
        closureTasks,
        outerSettlementBarrier: {
          kind: 'block-until-exact-closure-settles',
          dagId: barrierDagId,
          closureTaskIds: barrierTaskIds,
        },
      },
    }));

    expect(decision.decision).toBe('contradictory');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues.map(candidate => candidate.reasonCode)).toContain(reasonCode);
  });

  it('rejects a foundation that claims ordinary production completion', () => {
    const decision = resolveProductionWiringContract(contract({
      changeKind: 'foundation',
      disposition: { kind: 'production-wiring' },
    }));

    expect(decision.decision).toBe('contradictory');
    if (decision.disposition !== 'hold') throw new Error('expected hold');
    expect(decision.issues[0]?.reasonCode).toBe('foundation-disposition-required');
  });
});
