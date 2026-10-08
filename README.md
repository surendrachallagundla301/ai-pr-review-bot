# AI Pull-Request Review Bot

[![CI](https://github.com/surendrachallagundla301/ai-pr-review-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/surendrachallagundla301/ai-pr-review-bot/actions/workflows/ci.yml)

A GitHub Action that reviews every pull request against **your team's rulebook** using the Claude
API, and posts inline comments for security, correctness and performance problems.

The hard part of AI code review is not getting comments, it is getting comments people trust.
This bot is built around that: it validates every finding before posting it, and ships with an
evaluation set that measures precision, recall and false positives.

## How it works
```
PR opened / updated
   │
   ▼
Fetch diff ──► parse: keep added lines with new-file line numbers
   │           skip lock files, build output, binaries
   ▼
Prompt = rulebook + numbered lines ──► Claude (temperature 0, JSON only)
   │
   ▼
Validate every finding before posting:
   • schema check (severity, category, line, message)
   • grounding check: file + line must be an added line in THIS diff (blocks hallucinations)
   • severity filter, de-duplication, max comments (most severe first)
   │
   ▼
Post one review with inline comments. A human still owns the merge decision.
```

## Use it
1. Add an `ANTHROPIC_API_KEY` repository secret.
2. Optionally add `.github/review-rules.md` with your team's rules ([example](.github/review-rules.md)).
3. Add a workflow:

```yaml
name: AI review
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: surendrachallagundla301/ai-pr-review-bot@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          min-severity: medium
```

| Input | Default | Description |
|---|---|---|
| `anthropic-api-key` | (required) | Anthropic API key |
| `model` | `claude-sonnet-5-5` | Claude model |
| `rulebook-path` | `.github/review-rules.md` | Your rules; a built-in default is used if missing |
| `min-severity` | `medium` | Lowest severity to post: `high`, `medium`, `low` |
| `max-comments` | `10` | Cap on inline comments per review |
| `max-diff-chars` | `60000` | Largest diff sent to the model |

## Example comment
> **🔴 High · security · sql-injection**
>
> The query is built by concatenating `email` into the SQL string, so a crafted email can change the query.
>
> **Suggestion:** Use a parameterized query: `jdbc.queryForObject("SELECT * FROM users WHERE email = ?", mapper, email)`.

## Measuring quality
`evals/` holds labelled diffs: four with a known problem (SQL injection, PHI in logs, N+1 query,
swallowed exception) and two clean changes that should get **no** comments.

```bash
ANTHROPIC_API_KEY=sk-... npm run eval
```

The script reports precision, recall, false positives, and how many clean diffs were flagged.
Use it to compare prompt or model changes before rolling them out, instead of judging by feel.

## Design decisions
- **Grounding over trust.** The model is asked to cite line numbers, and anything that does not
  match an added line is dropped. This removes the most common failure: comments on code that
  is not in the PR.
- **Few, high-signal comments.** Default `min-severity: medium` and a comment cap. Noisy bots get
  ignored.
- **Testable core.** The model sits behind a small `ModelClient` interface, so the parsing,
  validation and filtering logic is unit-tested with a fake client and no network.
- **Human in the loop.** The bot only comments; it never approves or blocks a PR.

## Develop
```bash
npm ci
npm test          # Jest unit tests (no API key needed)
npm run build     # type-check and bundle to dist/ with ncc (commit dist/)
```

## Tech stack
TypeScript · Node.js 20 · Claude API (Anthropic SDK) · GitHub Actions toolkit · Octokit · Jest · ncc

## License
MIT
