/**
 * Measures review quality against labelled fixtures.
 *
 *   ANTHROPIC_API_KEY=... npm run eval
 *
 * A finding counts as a true positive when it hits the expected file, within 1 line, with the
 * expected category. Anything else is a false positive. Clean fixtures should produce nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ClaudeClient } from '../src/claude';
import { parseDiff } from '../src/diff';
import { DEFAULT_RULEBOOK } from '../src/rulebook';
import { review } from '../src/review';

interface Expected {
  file: string;
  line: number;
  category: string;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY to run the evaluation');
  const client = new ClaudeClient(apiKey, process.env.MODEL ?? 'claude-sonnet-5-5');
  const expected: Record<string, Expected[]> = JSON.parse(readFileSync(join(__dirname, 'expected.json'), 'utf8'));

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let cleanFlagged = 0;
  let cleanTotal = 0;

  for (const [fixture, wanted] of Object.entries(expected)) {
    const files = parseDiff(readFileSync(join(__dirname, 'fixtures', fixture), 'utf8'));
    const { findings } = await review(files, client, {
      rulebook: DEFAULT_RULEBOOK,
      minSeverity: 'low',
      maxComments: 20,
      maxDiffChars: 60_000,
    });

    const matched = new Set<number>();
    for (const f of findings) {
      const hit = wanted.findIndex(
        (w, i) => !matched.has(i) && w.file === f.file && Math.abs(w.line - f.line) <= 1 && w.category === f.category,
      );
      if (hit >= 0) {
        matched.add(hit);
        tp++;
      } else {
        fp++;
      }
    }
    fn += wanted.length - matched.size;
    if (wanted.length === 0) {
      cleanTotal++;
      if (findings.length > 0) cleanFlagged++;
    }
    console.log(`${fixture.padEnd(28)} expected ${wanted.length}  found ${findings.length}  matched ${matched.size}`);
  }

  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  console.log(
    `\nprecision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%  ` +
      `false positives ${fp}  clean fixtures flagged ${cleanFlagged}/${cleanTotal}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
