import assert from "node:assert/strict";
import test from "node:test";
import { extractLatestDelimitedSources } from "../src/extract.js";
import { mermaidFormat } from "../src/formats/mermaid.js";

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

test("recognizes exact bare headers supported by the Mermaid renderer", () => {
  for (const header of [
    "flowchart LR",
    "graph TD",
    "stateDiagram-v2",
    "sequenceDiagram",
    "classDiagram",
    "erDiagram",
    "xychart-beta horizontal",
  ]) {
    assert.deepEqual(mermaidFormat.findOpeningDelimiter(header), {
      kind: "bare-syntax",
    });
  }

  for (const prose of [
    "A flowchart LR would help here.",
    "flowchart LR is the selected direction",
    "sequenceDiagram examples",
  ]) {
    assert.equal(mermaidFormat.findOpeningDelimiter(prose), undefined);
  }
});
