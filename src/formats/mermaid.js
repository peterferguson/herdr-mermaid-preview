import {
  parseBlankLineBlock,
  parseFencedBlock,
} from "../extract.js";
import { renderDiagrams } from "../render.js";

const incompleteMessage = "the latest Mermaid block is empty or incomplete";

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
    return trimmed.toLowerCase() === "mermaid" ? { kind: "label" } : undefined;
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
    return parseBlankLineBlock({ incompleteMessage, lines, startIndex });
  },
  render: renderDiagrams,
};
