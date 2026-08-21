import { renderMermaidASCII } from "beautiful-mermaid";

export function renderDiagram(source) {
  const text = `${renderMermaidASCII(source).trimEnd()}\n`;
  return { text };
}

export function renderBlocks(sources, { heading, renderBlock }) {
  const blocks = sources.map((source) => renderBlock(source).text.trimEnd());
  if (blocks.length === 1) return { text: `${blocks[0]}\n` };

  const text = blocks
    .map((block, index) => `${heading(index + 1, blocks.length)}\n${block}`)
    .join("\n\n");
  return { text: `${text}\n` };
}

export function renderDiagrams(sources) {
  return renderBlocks(sources, {
    heading: (index, total) => `Diagram ${index} of ${total}`,
    renderBlock: renderDiagram,
  });
}
