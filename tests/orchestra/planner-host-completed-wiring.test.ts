import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ProductionWiringProposalCompletionError,
  completeProductionWiringFromProposal,
  parseProductionWiringProposalV1,
  productionWiringContractV2InputFromCanonical,
} from '../../src/core/production-wiring-contract.js';
import {
  PRODUCTION_WIRING_HOST_PROOF_PLATFORMS,
  TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
} from '../../src/core/production-wiring-host-proof.js';
import {
  buildPlanPrompt,
  buildZeroConfigPlanPrompt,
  parsePlannerResponseDetailed,
} from '../../src/orchestra/planner.js';
import type { BrainContext, SprintSizeRecommendation } from '../../src/core/types.js';
import {
  createProductionWiringPlanEvidenceV2,
  productionWiringVerifierAssetWriteScopeOverlap,
} from '../../src/core/task-types.js';
import { compileRunProposal } from '../../src/orchestra/run-proposal-compiler.js';
import { parseStructuredDirectives } from '../../src/orchestra/task-builder.js';

function terminalProposal() {
  return {
    version: 1 as const,
    changeKind: 'runtime-change' as const,
    ...TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
    disposition: { kind: 'production-wiring' as const },
  };
}

function sha256(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function plannerEnvelope(wiring: unknown, field = 'productionWiringProposal') {
  return JSON.stringify({
    tasks: [{
      title: 'Unify terminal provider authority',
      description: 'Route the native terminal through one provider resolver.',
      model: 'claude-sonnet-5',
      effort: 'high',
      priority: 'CRITICAL',
      reason: 'Cross-surface authority change.',
      scope: {
        directories: ['src/cli/'],
        filesRead: ['src/cli/repl/native-transport.ts'],
        filesWrite: ['src/cli/repl/provider-authority.ts'],
      },
      dependencies: [],
      goNogo: {
        goCriteria: 'Resolver is canonical.',
        noGoCriteria: 'Ingress bypasses the resolver.',
        techDebtAcceptable: 'None.',
      },
      [field]: wiring,
    }],
    reasoning: 'One authority task.',
  });
}

describe('planner host-completed production wiring', () => {
  it('turns a registered identity-only proposal into a digest-bound four-platform V2 contract', () => {
    const contract = completeProductionWiringFromProposal(terminalProposal(), {
      projectRoot: process.cwd(),
    });

    expect(contract.version).toBe(2);
    expect(contract.producer).toEqual(TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY.producer);
    expect(contract.hostProofProgram.platforms.map(row => row.platform))
      .toEqual(PRODUCTION_WIRING_HOST_PROOF_PLATFORMS);
    expect(contract.hostProofProgram.platforms.find(row => row.platform === 'darwin'))
      .toEqual({ platform: 'darwin', state: 'unsupported', reasonCode: 'capability-unavailable' });
    expect(contract.hostProofProgram.platforms.find(row => row.platform === 'win32'))
      .toEqual({ platform: 'win32', state: 'unsupported', reasonCode: 'capability-unavailable' });
    expect(contract.hostProofProgram.verifierAssets.map(asset => asset.path)).toEqual([
      'scripts/production-wiring-host-proof-harness.mjs',
    ]);
    for (const asset of contract.hostProofProgram.verifierAssets) {
      expect(asset.sha256).toBe(sha256(asset.path));
    }
  });

  it('keeps the immutable verifier outside the natural 7099 L1 source and test write scope', () => {
    const contract = completeProductionWiringFromProposal(terminalProposal(), {
      projectRoot: process.cwd(),
    });
    const authority = createProductionWiringPlanEvidenceV2(
      productionWiringContractV2InputFromCanonical(contract),
    );

    expect(productionWiringVerifierAssetWriteScopeOverlap({
      directories: ['src/cli/', 'src/core/', 'tests/cli/'],
      filesRead: [],
      filesWrite: [
        'src/cli/repl/native-transport.ts',
        'src/cli/repl/run.tsx',
        'tests/cli/native-transport-selection.test.ts',
        'tests/cli/health-snapshot-live-provider.test.ts',
        'tests/cli/native-provider-setting.test.ts',
      ],
    }, authority)).toBeNull();
  });

  it('rejects an identity tuple that has no code-owned proof profile', () => {
    expect(() => completeProductionWiringFromProposal({
      ...terminalProposal(),
      producer: { producerId: 'model-invented-producer' },
    }, { projectRoot: process.cwd() })).toThrowError(
      expect.objectContaining<Partial<ProductionWiringProposalCompletionError>>({
        reasonCode: 'host-proof-profile-unregistered',
      }),
    );
    expect(() => completeProductionWiringFromProposal({
      ...terminalProposal(),
      canonicalConsumer: {
        ...TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY.canonicalConsumer,
        relationship: 'removed-or-migrated',
      },
    }, { projectRoot: process.cwd() })).toThrowError(
      expect.objectContaining<Partial<ProductionWiringProposalCompletionError>>({
        reasonCode: 'host-proof-profile-unregistered',
      }),
    );
  });

  it('accepts only the exact identity-proposal shape', () => {
    expect(parseProductionWiringProposalV1(terminalProposal())).not.toBeNull();
    expect(parseProductionWiringProposalV1({
      ...terminalProposal(),
      hostProofProgram: { verifierAssets: [{ sha256: `sha256:${'a'.repeat(64)}` }] },
    })).toBeNull();
  });

  it('serializes a canonical host-owned contract back to authoring input without derived digests', () => {
    const contract = completeProductionWiringFromProposal(terminalProposal(), {
      projectRoot: process.cwd(),
    });
    const input = productionWiringContractV2InputFromCanonical(contract);

    expect(JSON.stringify(input)).not.toContain('programDigest');
    expect(JSON.stringify(input)).not.toContain('probeId');
    expect(input.hostProofProgram.verifierAssets).toEqual(contract.hostProofProgram.verifierAssets);
  });

  it('planner parsing replaces the identity proposal with host-completed plan evidence', () => {
    const parsed = parsePlannerResponseDetailed(plannerEnvelope(terminalProposal()), undefined, {
      projectRoot: process.cwd(),
    });

    expect(parsed.failure).toBeUndefined();
    expect(parsed.result?.tasks[0]?.productionWiring?.contract.producer)
      .toEqual(TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY.producer);
    expect(parsed.result?.tasks[0]).not.toHaveProperty('productionWiringProposal');
  });

  it('discards a legacy full-V2 model program and every model-authored digest', () => {
    const modelDigest = `sha256:${'a'.repeat(64)}`;
    const legacy = {
      ...terminalProposal(),
      version: 2,
      hostProofProgram: {
        network: 'forbidden',
        verifierAssets: [{
          path: 'model/invented-proof.mjs', sha256: modelDigest, role: 'trusted-harness',
        }],
        platforms: [],
      },
    };
    const parsed = parsePlannerResponseDetailed(
      plannerEnvelope(legacy, 'productionWiring'),
      undefined,
      { projectRoot: process.cwd() },
    );

    expect(parsed.result).not.toBeNull();
    expect(JSON.stringify(parsed.result)).not.toContain(modelDigest);
    expect(JSON.stringify(parsed.result)).not.toContain('model/invented-proof.mjs');
  });

  it('reports an exact wiring issue path for an unregistered proposal', () => {
    const parsed = parsePlannerResponseDetailed(plannerEnvelope({
      ...terminalProposal(), producer: { producerId: 'invented' },
    }), undefined, { projectRoot: process.cwd() });

    expect(parsed).toEqual({
      result: null,
      failure: {
        stage: 'wiring',
        issues: ['tasks.0.productionWiringProposal:host-proof-profile-unregistered'],
      },
    });
  });

  it('both planner prompts request identities only and publish the registered tuple', () => {
    const context = {
      directives: 'Unify native provider resolution',
      memory: '', patterns: '', retro: '', decisions: '', projectIdentity: '',
      debt: [], projectState: { gitStatus: '', fileTree: [] },
    } as unknown as BrainContext;
    const recommendation = { maxWorkers: 2 } as SprintSizeRecommendation;
    const prompts = [
      buildPlanPrompt(context, recommendation, 'deckent'),
      buildZeroConfigPlanPrompt('Unify native provider resolution', 'deckent'),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain('"productionWiringProposal"');
      expect(prompt).toContain(TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY.producer.producerId);
      expect(prompt).not.toContain('"hostProofProgram"');
      expect(prompt).not.toContain('sha256:<64 lowercase hex>');
    }
  });

  it('preserves host-completed authority through compiler and structured DIRECTIVES admission', async () => {
    const contract = completeProductionWiringFromProposal(terminalProposal(), {
      projectRoot: process.cwd(),
    });
    const authority = createProductionWiringPlanEvidenceV2(
      productionWiringContractV2InputFromCanonical(contract),
    );
    const { directivesMarkdown } = await compileRunProposal({
      flowId: 'flow-host-wiring-roundtrip',
      tenant: 'local',
      project: 'deckent',
      actor: { id: 'owner', role: 'operator' },
      origin: 'cli',
      revision: 1,
      intentSummary: 'Unify native provider resolution.',
    }, () => ({
      reasoning: 'One production task.',
      tasks: [{
        title: 'Unify native provider authority',
        description: 'Route native provider selection through the canonical resolver.',
        model: 'claude-sonnet-5',
        effort: 'high',
        priority: 'CRITICAL',
        reason: 'Authority convergence.',
        scope: {
          directories: ['src/cli/repl/'],
          filesRead: ['src/cli/repl/native-transport.ts'],
          filesWrite: ['src/cli/repl/provider-authority.ts'],
        },
        dependencies: [],
        goNogo: {
          goCriteria: 'The native entry invokes one resolver.',
          noGoCriteria: 'Any ingress bypasses the resolver.',
          techDebtAcceptable: 'None.',
        },
        productionWiring: authority,
      }],
    }));

    expect(directivesMarkdown).toContain('- ProductionWiring: {"version":2');
    expect(directivesMarkdown).not.toContain('programDigest');
    expect(directivesMarkdown).not.toContain('probeId');
    const task = parseStructuredDirectives(directivesMarkdown)[0]!;
    expect(task.productionWiring?.contractDigest).toBe(authority.contractDigest);
    expect(task.productionWiring?.hostProofProgramDigest).toBe(authority.hostProofProgramDigest);
  });
});
