/** A line added in the pull request, with its line number in the new version of the file. */
export interface AddedLine {
  line: number;
  content: string;
}

export interface FileDiff {
  path: string;
  addedLines: AddedLine[];
}

const SKIP_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)dist\//,
  /\.min\.(js|css)$/,
  /\.(png|jpe?g|gif|svg|ico|pdf|zip)$/,
];

/** Lock files, build output and binaries are noise for a code review. */
export function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Parses a unified diff (as returned by the GitHub API) into the lines each file adds.
 * Only added lines can receive inline review comments, so that is all we keep.
 */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let newLine = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).replace(/^b\//, '').trim();
      if (path === '/dev/null' || shouldSkip(path)) {
        current = null;
      } else {
        current = { path, addedLines: [] };
        files.push(current);
      }
      continue;
    }
    if (raw.startsWith('--- ')) continue;

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;

    if (raw.startsWith('+')) {
      current.addedLines.push({ line: newLine, content: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // Removed line or "\ No newline at end of file": does not exist in the new file.
    } else {
      newLine += 1; // context line
    }
  }
  return files.filter((f) => f.addedLines.length > 0);
}

/** Renders added lines with their line numbers so the model can cite exact locations. */
export function renderForPrompt(files: FileDiff[], maxChars: number): { text: string; truncated: boolean } {
  let text = '';
  for (const file of files) {
    const block =
      `### ${file.path}\n` + file.addedLines.map((l) => `${String(l.line).padStart(5)} | ${l.content}`).join('\n') + '\n\n';
    if (text.length + block.length > maxChars) {
      return { text, truncated: true };
    }
    text += block;
  }
  return { text, truncated: false };
}
