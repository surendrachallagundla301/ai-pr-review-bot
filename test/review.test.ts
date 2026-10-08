import { FileDiff } from '../src/diff';
import { extractJson, formatComment, ModelClient, review, ReviewOptions, validateFindings } from '../src/review';

const files: FileDiff[] = [
  {
    path: 'src/UserRepo.java',
    addedLines: [
      { line: 20, content: 'String sql = "SELECT * FROM users WHERE id = " + id;' },
      { line: 21, content: 'log.info("user " + user);' },
    ],
  },
];

const options: ReviewOptions = { rulebook: '- no PHI in logs', minSeverity: 'low', maxComments: 10, maxDiffChars: 50_000 };

const finding = (overrides: Record<string, unknown> = {}) => ({
  file: 'src/UserRepo.java',
  line: 20,
  severity: 'high',
  category: 'security',
  rule: 'sql-injection',
  message: 'Query is built by string concatenation.',
  suggestion: 'Use a parameterized query.',
  ...overrides,
});

class FakeClient implements ModelClient {
  public system = '';
  public user = '';
  constructor(private readonly reply: string) {}
  async complete(system: string, user: string) {
    this.system = system;
    this.user = user;
    return this.reply;
  }
}

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"findings": []}')).toEqual({ findings: [] });
  });

  it('parses JSON inside a code fence with surrounding text', () => {
    expect(extractJson('Here you go:\n```json\n{"findings": []}\n```\nThanks')).toEqual({ findings: [] });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('Looks good to me!')).toThrow('did not contain a JSON object');
  });
});

describe('validateFindings', () => {
  it('accepts grounded findings', () => {
    const result = validateFindings({ findings: [finding()] }, files, options);
    expect(result.findings).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('drops findings on lines that are not in the diff (hallucinations)', () => {
    const result = validateFindings(
      { findings: [finding({ line: 99 }), finding({ file: 'src/Other.java' })] },
      files,
      options,
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'not an added line in this diff',
      'not an added line in this diff',
    ]);
  });

  it('drops malformed findings', () => {
    const result = validateFindings(
      { findings: [finding({ severity: 'critical' }), finding({ line: '20' }), { note: 'hi' }] },
      files,
      options,
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rejected.every((r) => r.reason === 'invalid schema')).toBe(true);
  });

  it('filters by minimum severity', () => {
    const result = validateFindings(
      { findings: [finding(), finding({ line: 21, severity: 'low', rule: 'naming' })] },
      files,
      { ...options, minSeverity: 'medium' },
    );
    expect(result.findings.map((f) => f.rule)).toEqual(['sql-injection']);
  });

  it('removes duplicates and caps the number of comments, keeping the most severe', () => {
    const result = validateFindings(
      {
        findings: [
          finding({ line: 21, severity: 'low', rule: 'style' }),
          finding(),
          finding(),
          finding({ line: 21, severity: 'medium', rule: 'phi-in-logs', category: 'security' }),
        ],
      },
      files,
      { ...options, maxComments: 2 },
    );
    expect(result.findings.map((f) => f.rule)).toEqual(['sql-injection', 'phi-in-logs']);
    expect(result.rejected.map((r) => r.reason)).toEqual(['duplicate', 'over max comments (2)']);
  });

  it('rejects replies without a findings array', () => {
    expect(() => validateFindings({ issues: [] }, files, options)).toThrow('findings');
  });
});

describe('review', () => {
  it('sends the rulebook and numbered lines, and returns validated findings', async () => {
    const client = new FakeClient(JSON.stringify({ findings: [finding(), finding({ line: 500 })] }));
    const result = await review(files, client, options);

    expect(client.system).toContain('- no PHI in logs');
    expect(client.user).toContain('   20 | String sql');
    expect(result.findings).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('does not call the model when there is nothing to review', async () => {
    const client = new FakeClient('should not be used');
    const result = await review([], client, options);
    expect(result.findings).toEqual([]);
    expect(client.user).toBe('');
  });
});

describe('formatComment', () => {
  it('includes severity, category, rule and suggestion', () => {
    const body = formatComment(finding() as never);
    expect(body).toContain('High · security · sql-injection');
    expect(body).toContain('**Suggestion:** Use a parameterized query.');
  });
});
