/**
 * Test helpers that build realistic-shaped fake secrets at runtime, so the
 * source files never contain a scannable secret pattern verbatim. This
 * lets repository-side push-protection (GitHub secret scanning) accept
 * the diff while still letting secretlint detect the tokens we generate.
 */

function repeatChars(len: number): string {
  const chars = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[i % chars.length];
  return out;
}

/** Returns a fake GitHub personal access token (`ghp_…`, 40 chars total). */
export function fakeGithubPat(): string {
  return ['gh', 'p_', repeatChars(36)].join('');
}

/** Returns a fake Slack bot token (`xoxb-…`). */
export function fakeSlackBotToken(): string {
  return ['xo', 'xb-', '123456789012-1234567890123-', repeatChars(24)].join('');
}

/** Returns a fake Anthropic API key (`sk-ant-api03-…`). */
export function fakeAnthropicKey(): string {
  return ['sk-', 'ant-', 'api03-', repeatChars(95), 'AA'].join('');
}

/**
 * Build a jsonl payload containing the three fake tokens above, embedded
 * in a realistic Bash tool_result output. The exact secret strings are
 * also returned so tests can assert on their absence post-redaction.
 */
export function buildSecretFixture(): {
  jsonl: string;
  tokens: { github: string; slack: string; anthropic: string };
} {
  const github = fakeGithubPat();
  const slack = fakeSlackBotToken();
  const anthropic = fakeAnthropicKey();
  const envDump = `GITHUB_TOKEN=${github}\nANTHROPIC_API_KEY=${anthropic}\nSLACK_BOT_TOKEN=${slack}`;
  const lines = [
    {
      type: 'user',
      timestamp: '2026-05-18T10:00:00.000Z',
      sessionId: 'sec-001',
      cwd: '/h/u/x',
      message: { role: 'user', content: 'Show me my env tokens please' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-18T10:00:01.000Z',
      sessionId: 'sec-001',
      cwd: '/h/u/x',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'env | grep -E TOKEN' } },
        ],
        usage: {
          input_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 20,
        },
      },
    },
    {
      type: 'user',
      timestamp: '2026-05-18T10:00:02.000Z',
      sessionId: 'sec-001',
      cwd: '/h/u/x',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: envDump }] },
        ],
      },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-18T10:00:03.000Z',
      sessionId: 'sec-001',
      cwd: '/h/u/x',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [{ type: 'text', text: 'I see your tokens. Let me NOT remember them.' }],
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 50,
          output_tokens: 30,
        },
      },
    },
  ];
  const jsonl = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
  return { jsonl, tokens: { github, slack, anthropic } };
}
