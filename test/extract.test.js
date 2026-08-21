import assert from "node:assert/strict";
import test from "node:test";
import { extractLatestDelimitedSources } from "../src/extract.js";

test("extracts every injected format block from the latest matching message", () => {
  const format = {
    displayName: "Example",
    findOpeningDelimiter(line) {
      return line.trim() === "example" ? {} : undefined;
    },
    parseBlock({ lines, startIndex }) {
      return {
        endIndex: startIndex + 1,
        source: `${lines[startIndex + 1].trim()}\n`,
      };
    },
  };

  const sources = extractLatestDelimitedSources(
    `
❯ old request
example
old block
› current request
example
first current block
example
second current block
❯ next request
`,
    format,
  );

  assert.deepEqual(sources, ["first current block\n", "second current block\n"]);
});
