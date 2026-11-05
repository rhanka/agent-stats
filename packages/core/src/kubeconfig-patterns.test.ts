import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanFile } from './cleanser.js';
import { KUBECONFIG_PATTERNS } from './kubeconfig-patterns.js';
import { loadSecretPatterns, scanString } from './secrets.js';

// All kubeconfig material below is assembled at runtime from obviously-fake
// fragments, so the repo never contains a committable secret-shaped literal.

const ALPHABET = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';

function repeatChars(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[i % ALPHABET.length];
  return out;
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

function buildFakeKubeconfig(): {
  yaml: string;
  blob: string;
  keyData: string;
  certData: string;
  caData: string;
  token: string;
} {
  const keyData = b64(`-----BEGIN FAKE PRIVATE KEY-----\n${repeatChars(160)}`);
  const certData = b64(`-----BEGIN FAKE CERTIFICATE-----\n${repeatChars(160)}`);
  const caData = b64(`-----BEGIN FAKE CA-----\n${repeatChars(160)}`);
  const token = `FAKE-TOKEN-${repeatChars(40)}`;
  const yaml = [
    'apiVersion: v1',
    'kind: Config',
    'clusters:',
    '- cluster:',
    `    certificate-authority-data: ${caData}`,
    '    server: https://fake.example.invalid:6443',
    '  name: fake',
    'users:',
    '- user:',
    `    client-certificate-data: ${certData}`,
    `    client-key-data: ${keyData}`,
    `    token: ${token}`,
    '  name: fake-admin',
  ].join('\n');
  return { yaml, blob: b64(yaml), keyData, certData, caData, token };
}

function yamlPatternsPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'patterns',
    'kubeconfig.yaml',
  );
}

describe('kubeconfig default patterns file', () => {
  it('should stay in sync with the built-in KUBECONFIG_PATTERNS', () => {
    const fromYaml = loadSecretPatterns(yamlPatternsPath());
    expect(fromYaml.map((p) => p.id)).toEqual(KUBECONFIG_PATTERNS.map((p) => p.id));
    expect(fromYaml.map((p) => p.pattern)).toEqual(KUBECONFIG_PATTERNS.map((p) => p.pattern));
  });
});

describe('scanString with kubeconfig defaults', () => {
  it('should flag raw YAML secret values while keeping the key names', async () => {
    const { yaml, keyData, certData, caData, token } = buildFakeKubeconfig();
    const matches = await scanString(`kubectl output:\n${yaml}\nend`);
    const ids = matches.map((m) => m.ruleId);
    for (const id of [
      'custom:kubeconfig-client-key-data',
      'custom:kubeconfig-client-certificate-data',
      'custom:kubeconfig-certificate-authority-data',
      'custom:kubeconfig-token',
    ]) {
      expect(ids).toContain(id);
    }
    const byId = new Map(matches.map((m) => [m.ruleId, m]));
    const text = `kubectl output:\n${yaml}\nend`;
    const slice = (id: string): string => {
      const m = byId.get(id);
      if (!m) throw new Error(`missing match ${id}`);
      return text.slice(m.start, m.end);
    };
    expect(slice('custom:kubeconfig-client-key-data')).toBe(keyData);
    expect(slice('custom:kubeconfig-client-certificate-data')).toBe(certData);
    expect(slice('custom:kubeconfig-certificate-authority-data')).toBe(caData);
    expect(slice('custom:kubeconfig-token')).toBe(token);
  });

  it('should flag a base64-encoded kubeconfig blob by its header', async () => {
    const { blob } = buildFakeKubeconfig();
    const matches = await scanString(`pasted config: ${blob} done`);
    const hit = matches.find((m) => m.ruleId === 'custom:kubeconfig-blob');
    expect(hit).toBeDefined();
    if (!hit) throw new Error('unreachable');
    const matched = `pasted config: ${blob} done`.slice(hit.start, hit.end);
    expect(matched.startsWith('YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmln')).toBe(true);
  });

  it('should flag a line-wrapped base64 kubeconfig blob', async () => {
    const { blob } = buildFakeKubeconfig();
    const wrapped = blob.replace(/.{76}/g, '$&\n');
    const matches = await scanString(wrapped);
    expect(matches.some((m) => m.ruleId === 'custom:kubeconfig-blob')).toBe(true);
  });

  it('should not flag kubeconfig values when defaults are disabled', async () => {
    const { yaml } = buildFakeKubeconfig();
    const matches = await scanString(yaml, { includeDefaultPatterns: false });
    expect(matches.filter((m) => m.ruleId.startsWith('custom:kubeconfig'))).toHaveLength(0);
  });

  it('should not flag ordinary prose with the kubeconfig patterns', async () => {
    const matches = await scanString('deployed the cluster config successfully today');
    expect(matches.filter((m) => m.ruleId.startsWith('custom:kubeconfig'))).toHaveLength(0);
  });
});

describe('cleanFile with kubeconfig defaults', () => {
  let tmpDir: string;
  let workFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'agent-stats-kubeconfig-'));
    workFile = path.join(tmpDir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should redact kubeconfig values and the blob without extra patterns', async () => {
    const { yaml, blob, keyData, certData, caData, token } = buildFakeKubeconfig();
    const line = { type: 'user', message: { content: `config dump:\n${yaml}\nblob:${blob}` } };
    writeFileSync(workFile, `${JSON.stringify(line)}\n`);
    const outPath = path.join(tmpDir, 'out', 'session.jsonl');
    const stats = await cleanFile({ filePath: workFile, mode: 'archive', outputPath: outPath });
    expect(stats.secretsFound).toBeGreaterThan(0);
    const out = readFileSync(outPath, 'utf8');
    for (const secret of [keyData, certData, caData, token, blob]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toMatch(/<<SECRET:/);
    // Key names survive redaction, so the cleaned file stays greppable.
    expect(out).toContain('client-key-data:');
  });
});
