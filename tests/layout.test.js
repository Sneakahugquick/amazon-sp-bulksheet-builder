import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Guards the fix for the blank band below the page: hidden table labels (.sr-only) must stay
// inside the scrolling columns, and jumping between steps must not scroll the whole page.
test("scrolling columns contain positioned elements and step jumps never move the page", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  for (const selector of [".app-shell", ".workspace", ".summary-rail"]) {
    assert.match(rule(selector), /position:\s*relative/, selector);
  }
  assert.match(rule(".app-shell"), /overflow:\s*clip/);
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\.scrollIntoView\(/);
});
