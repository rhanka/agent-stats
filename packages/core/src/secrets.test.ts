import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { scanString, loadSecretPatterns } from './secrets.js';

// A fake org token, assembled at runtime so it never sits as a literal in the
// repo (avoids push-protection false positives).
const fakeToken = ['stp', '_', 'A1b2C3d4'.repeat(4)].join(''); // stp_ + 32 chars

let dir: string;
let yamlPath: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'secret-patterns-'));
  yamlPath = path.join(dir, 'patterns.yaml');
  writeFileSync(
    yamlPath,
    [
      'patterns:',
      '  - id: sentropic-token',
      "    pattern: 'stp_[A-Za-z0-9]{32}'",
      '  - id: bad-regex',
      "    pattern: '([unterminated'", // invalid → must be skipped
      '  - missing-id: true', // malformed → skipped
    ].join('\n'),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('loadSecretPatterns', () => {
  it('loads valid patterns and skips invalid/malformed entries', () => {
    const pats = loadSecretPatterns(yamlPath);
    expect(pats.map((p) => p.id)).toEqual(['sentropic-token']);
  });

  it('returns [] for a missing file', () => {
    expect(loadSecretPatterns(path.join(dir, 'nope.yaml'))).toEqual([]);
  });
});

describe('scanString with custom patterns', () => {
  it('does NOT flag the org token without a custom pattern', async () => {
    const matches = await scanString(`token is ${fakeToken} end`);
    expect(matches.some((m) => m.ruleId.startsWith('custom:'))).toBe(false);
  });

  it('flags the org token via the loaded custom pattern', async () => {
    const customPatterns = loadSecretPatterns(yamlPath);
    const text = `token is ${fakeToken} end`;
    const matches = await scanString(text, { customPatterns });
    const hit = matches.find((m) => m.ruleId === 'custom:sentropic-token');
    expect(hit).toBeDefined();
    if (!hit) throw new Error('unreachable');
    expect(text.slice(hit.start, hit.end)).toBe(fakeToken);
  });

  it('finds every occurrence (global)', async () => {
    const customPatterns = loadSecretPatterns(yamlPath);
    const matches = await scanString(`${fakeToken} and ${fakeToken}`, { customPatterns });
    expect(matches.filter((m) => m.ruleId === 'custom:sentropic-token')).toHaveLength(2);
  });
});
