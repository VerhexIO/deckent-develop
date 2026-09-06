import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('memory compact observer diagnostic contract', () => {
  it('retains the failing import stage without leaking paths or emitting success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'memory-observer-diagnostic-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts', 'memory-compact-host-proof-observer.mjs');
    copyFileSync(join(import.meta.dirname, '../../scripts/memory-compact-host-proof-observer.mjs'), script);
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    expect(result.code).toBe(59);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      kind: 'deckent-memory-compact-observation-failure-v1',
      stage: 'module-import',
      reasonCode: 'MEMORY_COMPACT_OBSERVER_EXCEPTION',
      errorCode: 'ERR_MODULE_NOT_FOUND',
    });
    expect(result.stderr).not.toContain(root);
  });
});
