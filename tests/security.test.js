import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("public entry point enforces a restrictive static-site CSP", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
});

test("public repository ignore rules exclude local state and credentials", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  for (const entry of ["node_modules/", "dist/", ".runtime/", "docs/CODEX_HANDOFF.md", ".env", "*.pem", "*.key"]) {
    assert.ok(gitignore.includes(entry), `missing .gitignore rule: ${entry}`);
  }
});

test("GitHub Pages deployment uses minimal permissions and immutable action pins", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/pages.yml", import.meta.url),
    "utf8",
  );
  const buildBlock = workflow.match(/\n  build:[\s\S]*?\n  deploy:/)?.[0] || "";
  const deployBlock = workflow.match(/\n  deploy:[\s\S]*$/)?.[0] || "";
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(buildBlock, /permissions:\s+contents: read/);
  assert.doesNotMatch(buildBlock, /pages: write|id-token: write/);
  assert.match(buildBlock, /persist-credentials: false/);
  assert.match(deployBlock, /pages: write/);
  assert.match(deployBlock, /id-token: write/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);

  const usesLines = workflow.split(/\r?\n/).filter((line) => line.includes("uses:"));
  assert.ok(usesLines.length >= 5);
  for (const line of usesLines) {
    assert.match(line, /@[0-9a-f]{40}\b/, `action is not pinned to a commit: ${line}`);
  }
});
