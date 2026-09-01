import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePastedKeywords } from "../src/lib/paste.js";

test("parses an Excel three-column keyword, match type, and bid table", () => {
  const parsed = parsePastedKeywords(
    "关键词\t匹配方式\t出价\nabstract wall art\texact\t0.68\nneutral wall decor\tphrase\t0.54\nlarge canvas art\tbroad\t0.42",
    { matchType: "exact", bid: "0.50" },
  );
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(
    parsed.rows.map(({ text, matchType, bid }) => ({ text, matchType, bid })),
    [
      { text: "abstract wall art", matchType: "exact", bid: "0.68" },
      { text: "neutral wall decor", matchType: "phrase", bid: "0.54" },
      { text: "large canvas art", matchType: "broad", bid: "0.42" },
    ],
  );
});

test("applies one shared match type and bid to a one-column keyword list", () => {
  const parsed = parsePastedKeywords(
    "abstract wall art\nneutral wall decor\nlarge canvas art",
    { matchType: "phrase", bid: "0.55" },
  );
  assert.deepEqual(
    parsed.rows.map(({ text, matchType, bid }) => ({ text, matchType, bid })),
    [
      { text: "abstract wall art", matchType: "phrase", bid: "0.55" },
      { text: "neutral wall decor", matchType: "phrase", bid: "0.55" },
      { text: "large canvas art", matchType: "phrase", bid: "0.55" },
    ],
  );
});
