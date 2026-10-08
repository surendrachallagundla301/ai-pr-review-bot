import { FileDiff, renderForPrompt } from './diff';
import { buildSystemPrompt, buildUserPrompt, CATEGORIES, Category, SEVERITIES, Severity } from './prompt';

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  category: Category;
  rule: string;
  message: string;
  suggestion?: string;
}

/** The one thing we need from the model. An interface so tests can swap in a fake. */
export interface ModelClient {
  complete(system: string, user: string): Promise<string>;
}

export interface ReviewOptions {
  rulebook: string;
  minSeverity: Severity;
  maxComments: number;
  maxDiffChars: number;
}

export interface ReviewResult {
  findings: Finding[];
  /** Findings the model returned that we dropped, with the reason. Logged for evaluation. */
  rejected: { finding: unknown; reason: string }[];
  truncated: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** Pulls the JSON object out of a reply, tolerating ```json fences or stray text around it. */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Model reply did not contain a JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function isFinding(value: unknown): value is Finding {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.file === 'string' &&
    Number.isInteger(f.line) &&
    SEVERITIES.includes(f.severity as Severity) &&
    CATEGORIES.includes(f.category as Category) &&
    typeof f.rule === 'string' &&
    typeof f.message === 'string' &&
    f.message.trim().length > 0
  );
}

/**
 * Validates model output before anything is posted:
 * - schema check (drops malformed findings)
 * - grounding check: the file and line must be an added line in this diff, so the model
 *   cannot comment on code that does not exist (a common hallucination)
 * - severity filter, de-duplication, and a cap on the number of comments
 */
export function validateFindings(raw: unknown, files: FileDiff[], options: ReviewOptions): Omit<ReviewResult, 'truncated'> {
  const rejected: ReviewResult['rejected'] = [];
  const list = (raw as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) {
    throw new Error('Model reply is missing a "findings" array');
  }

  const addedLines = new Map(files.map((f) => [f.path, new Set(f.addedLines.map((l) => l.line))]));
  const seen = new Set<string>();
  const accepted: Finding[] = [];

  for (const item of list) {
    if (!isFinding(item)) {
      rejected.push({ finding: item, reason: 'invalid schema' });
      continue;
    }
    if (!addedLines.get(item.file)?.has(item.line)) {
      rejected.push({ finding: item, reason: 'not an added line in this diff' });
      continue;
    }
    if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[options.minSeverity]) {
      rejected.push({ finding: item, reason: `below min severity ${options.minSeverity}` });
      continue;
    }
    const key = `${item.file}:${item.line}:${item.rule.toLowerCase()}`;
    if (seen.has(key)) {
      rejected.push({ finding: item, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    accepted.push(item);
  }

  accepted.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  for (const extra of accepted.splice(options.maxComments)) {
    rejected.push({ finding: extra, reason: `over max comments (${options.maxComments})` });
  }
  return { findings: accepted, rejected };
}

export async function review(files: FileDiff[], client: ModelClient, options: ReviewOptions): Promise<ReviewResult> {
  if (files.length === 0) {
    return { findings: [], rejected: [], truncated: false };
  }
  const { text, truncated } = renderForPrompt(files, options.maxDiffChars);
  const reply = await client.complete(buildSystemPrompt(options.rulebook), buildUserPrompt(text, truncated));
  return { ...validateFindings(extractJson(reply), files, options), truncated };
}

export function formatComment(f: Finding): string {
  const badge = { high: '🔴 High', medium: '🟠 Medium', low: '🟡 Low' }[f.severity];
  const suggestion = f.suggestion ? `\n\n**Suggestion:** ${f.suggestion}` : '';
  return `**${badge} · ${f.category} · ${f.rule}**\n\n${f.message}${suggestion}`;
}
