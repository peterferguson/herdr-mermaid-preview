import { renderMermaidASCII } from "beautiful-mermaid";

export function renderDiagram(source) {
  const text = `${renderMermaidASCII(source).trimEnd()}\n`;
  return { text };
}
