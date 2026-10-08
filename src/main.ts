import * as core from '@actions/core';
import * as github from '@actions/github';
import { existsSync, readFileSync } from 'fs';
import { ClaudeClient } from './claude';
import { parseDiff } from './diff';
import { SEVERITIES, Severity } from './prompt';
import { formatComment, review } from './review';
import { DEFAULT_RULEBOOK } from './rulebook';

async function run(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info('Not a pull_request event; nothing to review.');
    return;
  }

  const minSeverity = core.getInput('min-severity') as Severity;
  if (!SEVERITIES.includes(minSeverity)) {
    throw new Error(`min-severity must be one of ${SEVERITIES.join(', ')}`);
  }
  const rulebookPath = core.getInput('rulebook-path');
  const rulebook = existsSync(rulebookPath) ? readFileSync(rulebookPath, 'utf8') : DEFAULT_RULEBOOK;
  core.info(existsSync(rulebookPath) ? `Using rulebook ${rulebookPath}` : 'Using the default rulebook');

  const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
  const { owner, repo } = github.context.repo;

  const { data: diff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pr.number,
    mediaType: { format: 'diff' },
  });

  const files = parseDiff(diff as unknown as string);
  core.info(`Reviewing ${files.length} changed file(s)`);

  const client = new ClaudeClient(core.getInput('anthropic-api-key', { required: true }), core.getInput('model'));
  const result = await review(files, client, {
    rulebook,
    minSeverity,
    maxComments: Number(core.getInput('max-comments')),
    maxDiffChars: Number(core.getInput('max-diff-chars')),
  });

  for (const r of result.rejected) {
    core.debug(`Dropped finding (${r.reason}): ${JSON.stringify(r.finding)}`);
  }
  core.setOutput('findings', result.findings.length);

  const truncatedNote = result.truncated ? '\n\n_The diff was large, so only part of it was reviewed._' : '';
  if (result.findings.length === 0) {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pr.number,
      event: 'COMMENT',
      body: `🤖 AI review: no issues found against the team rulebook.${truncatedNote}`,
    });
    return;
  }

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pr.number,
    commit_id: pr.head.sha,
    event: 'COMMENT',
    body: `🤖 AI review found ${result.findings.length} issue(s). A human reviewer still owns the final decision.${truncatedNote}`,
    comments: result.findings.map((f) => ({ path: f.file, line: f.line, side: 'RIGHT' as const, body: formatComment(f) })),
  });
}

run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
