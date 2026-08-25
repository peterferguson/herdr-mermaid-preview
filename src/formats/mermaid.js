import {
  dedent,
  parseBlankLineBlock,
  parseFencedBlock,
} from "../extract.js";
import { renderDiagrams } from "../render.js";

const incompleteMessage = "the latest Mermaid block is empty or incomplete";
const bareDiagramHeader = /^(?:(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL)|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart(?:-beta)?(?:\s+horizontal)?)$/i;

function parseBareSyntaxBlock({ lines, startIndex }) {
  const body = [];
  for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
    if (!lines[cursor].trim()) {
      if (!body.slice(1).some((line) => line.trim())) throw new Error(incompleteMessage);
      return {
        endIndex: cursor,
        source: `${dedent(body).join("\n").trimEnd()}\n`,
      };
    }
    body.push(lines[cursor]);
  }
  throw new Error(incompleteMessage);
}

export const mermaidFormat = {
  id: "mermaid",
  displayName: "Mermaid",
  sourceFileName: "diagram.mmd",
  recordFileName: "preview.json",
  viewerEntrypoint: "viewer",
  notFoundMessage: "no Mermaid diagram found in recent pane output",
  findOpeningDelimiter(line) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*mermaid(?:\s+.*)?$/i)?.[1];
    if (fence) return { kind: "fence", fence };
    if (trimmed.toLowerCase() === "mermaid") return { kind: "label" };
    return bareDiagramHeader.test(trimmed) ? { kind: "bare-syntax" } : undefined;
  },
  parseBlock({ delimiter, lines, startIndex }) {
    if (delimiter.kind === "fence") {
      return parseFencedBlock({
        fence: delimiter.fence,
        incompleteMessage,
        lines,
        startIndex,
      });
    }
    if (delimiter.kind === "bare-syntax") {
      return parseBareSyntaxBlock({ lines, startIndex });
    }
    return parseBlankLineBlock({ incompleteMessage, lines, startIndex });
  },
  render: renderDiagrams,
};
