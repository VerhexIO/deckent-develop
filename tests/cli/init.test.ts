import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── ADR Seed Data Tests ────────────────────────────────────────────────

describe('ADR Seed Data (adr-seed.ts)', () => {
  // Dynamic import to test the actual module
  let ADR_SEED_DATA: Array<{ id: string; type: string; title: string; content: string; status: string; decay_exempt: boolean; tags: string[] }>;
  let createIdentitySeed: (name: string) => { id: string; type: string; title: string; content: string };

  beforeEach(async () => {
    const mod = await import('../../src/core/adr-seed.js');
    ADR_SEED_DATA = mod.ADR_SEED_DATA;
    createIdentitySeed = mod.createIdentitySeed;
  });

  it('should have at least 40 ADR entries', () => {
    expect(ADR_SEED_DATA.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry has required fields', () => {
    for (const adr of ADR_SEED_DATA) {
      expect(adr.id).toMatch(/^adr-\d{3}/);
      expect(adr.type).toBe('adr');
      expect(adr.title).toBeTruthy();
      expect(adr.content).toBeTruthy();
      expect(adr.decay_exempt).toBe(true);
      expect(adr.tags).toContain('adr');
    }
  });

  it('each ADR has a valid status', () => {
    const validStatuses = ['accepted', 'deprecated', 'superseded', 'proposed', 'rejected'];
    for (const adr of ADR_SEED_DATA) {
      expect(validStatuses).toContain(adr.status);
    }
  });

  it('ADR IDs are unique', () => {
    const ids = ADR_SEED_DATA.map(a => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('contains known ADRs (spot check)', () => {
    const ids = ADR_SEED_DATA.map(a => a.id);
    expect(ids).toContain('adr-001'); // TypeScript + ESM
    expect(ids).toContain('adr-010'); // Tek Runtime Dependency
    expect(ids).toContain('adr-039'); // Self-Modifying Task Detection
  });

  it('ADR-005 is deprecated', () => {
    const adr005 = ADR_SEED_DATA.find(a => a.id === 'adr-005');
    expect(adr005).toBeDefined();
    expect(adr005!.status).toBe('deprecated');
  });

  it('createIdentitySeed returns valid entry', () => {
    const entry = createIdentitySeed('my-project');
    expect(entry.id).toBe('identity-project');
    expect(entry.type).toBe('identity');
    expect(entry.title).toContain('my-project');
    expect(entry.content).toContain('my-project');
  });
});

// ─── Template Reference Tests ───────────────────────────────────────────

describe('init.ts template references', () => {
  it('DECKENT.md templates reference exports/summary.md, not MEMORY.md', async () => {
    // Templates moved to init-templates.ts (Sprint 144 Task 1 split)
    const initContent = readFileSync(
      join(process.cwd(), 'src', 'cli', 'commands', 'init-templates.ts'),
      'utf-8',
    );

    // Find the two generateDeckentContent functions (TR and EN)
    const trMatch = initContent.match(/function generateDeckentContentTR[\s\S]*?^}/m);
    const enMatch = initContent.match(/function generateDeckentContentEN[\s\S]*?^}/m);

    // Both TR and EN templates should use exports/summary.md
    for (const match of [trMatch, enMatch]) {
      expect(match).toBeTruthy();
      if (match) {
        expect(match[0]).not.toContain('@.brain/MEMORY.md');
        expect(match[0]).toContain('@.brain/exports/summary.md');
      }
    }
  });

  it('describes memory_budget as the retained-entry decay threshold in both init locales', () => {
    const initContent = readFileSync(
      join(process.cwd(), 'src', 'cli', 'commands', 'init-templates.ts'),
      'utf-8',
    );

    expect(initContent).toContain('| memory_budget | sayı | 900 | Tamamlanan sprintlerde tutulan girdiler için çürüme eşiği |');
    expect(initContent).toContain('| memory_budget | number | 900 | Retained-entry decay threshold across completed sprints |');
    expect(initContent).not.toContain('.brain/ total line budget');
    expect(initContent).not.toContain('.brain/ toplam satır bütçesi');
  });

  it('init.ts does not create DECISIONS.md for new projects', () => {
    // Brain files logic moved to init-steps.ts (Sprint 144 Task 1 split)
    const initContent = readFileSync(
      join(process.cwd(), 'src', 'cli', 'commands', 'init-steps.ts'),
      'utf-8',
    );

    // The old line was: writeIfNotExists(join(root, BRAIN_DIR, DECISIONS_FILE), ...)
    // Verify it's commented out or removed
    const brainFilesSection = initContent.substring(
      initContent.indexOf('// 10. Brain files'),
      initContent.indexOf('// 10a.'),
    );
    expect(brainFilesSection).not.toContain('DECISIONS_FILE), \'# Architecture');
  });

  it('mcp/tools/init.ts does not create DECISIONS.md for new projects (CLI/MCP parity)', () => {
    const mcpInitContent = readFileSync(
      join(process.cwd(), 'src', 'mcp', 'tools', 'init.ts'),
      'utf-8',
    );
    // DECISIONS.md is a legacy V1 file — Memory V2 keeps decisions in
    // memory.db (exported to exports/decisions.md). Neither init path writes it.
    expect(mcpInitContent).not.toContain("DECISIONS_FILE), '# Architecture");
  });
});
