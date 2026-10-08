import { parseDiff, renderForPrompt, shouldSkip } from '../src/diff';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,4 +10,5 @@ export function main() {
   const a = 1;
-  const b = 2;
+  const b = 3;
+  const c = 4;
   return a + b;
 }
@@ -40,2 +41,3 @@
 function other() {
+  console.log('hi');
 }
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-  "version": "1"
+  "version": "2"
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
`;

describe('parseDiff', () => {
  it('tracks new-file line numbers across hunks', () => {
    const files = parseDiff(DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.ts');
    expect(files[0].addedLines).toEqual([
      { line: 11, content: '  const b = 3;' },
      { line: 12, content: '  const c = 4;' },
      { line: 42, content: "  console.log('hi');" },
    ]);
  });

  it('skips lock files and deleted files', () => {
    const paths = parseDiff(DIFF).map((f) => f.path);
    expect(paths).not.toContain('package-lock.json');
    expect(paths).not.toContain('old.txt');
  });
});

describe('shouldSkip', () => {
  it.each(['yarn.lock', 'dist/index.js', 'assets/logo.png', 'app.min.js'])('skips %s', (path) => {
    expect(shouldSkip(path)).toBe(true);
  });

  it('keeps source files', () => {
    expect(shouldSkip('src/Service.java')).toBe(false);
  });
});

describe('renderForPrompt', () => {
  it('prefixes each line with its number', () => {
    const { text, truncated } = renderForPrompt(parseDiff(DIFF), 10_000);
    expect(truncated).toBe(false);
    expect(text).toContain('### src/app.ts');
    expect(text).toContain('   11 |   const b = 3;');
  });

  it('truncates whole files when over the limit', () => {
    const { text, truncated } = renderForPrompt(parseDiff(DIFF), 10);
    expect(truncated).toBe(true);
    expect(text).toBe('');
  });
});
