import katex from "katex";
import { latexToUnicode } from "../../dist/latex-runtime.js";
import {
  parseBlankLineBlock,
  parseFencedBlock,
  parsePairedDelimiterBlock,
} from "../extract.js";
import { renderBlocks } from "../render.js";

const incompleteMessage = "the latest LaTeX block is empty or incomplete";
const misrepresentedEnvironments = new Set(["alignat", "alignedat", "array"]);
const katexOptions = {
  displayMode: true,
  maxExpand: 1_000,
  maxSize: 50,
  output: "mathml",
  strict: "error",
  throwOnError: true,
  trust: false,
};

function stripLatexComments(source) {
  let stripped = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "%") {
      stripped += source[index];
      continue;
    }

    let precedingBackslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 1) {
      stripped += source[index];
      continue;
    }

    while (index < source.length && source[index] !== "\n") index += 1;
    if (index < source.length) stripped += "\n";
  }
  return stripped;
}

function commandsIn(source) {
  const commands = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\\") continue;
    if (source[index + 1] === "\\") {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (/[a-zA-Z]/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor > index + 1) {
      commands.push(source.slice(index + 1, cursor));
      index = cursor - 1;
    }
  }
  return [...new Set(commands)];
}

function commandProblems(source) {
  const unsupported = [];
  for (const command of commandsIn(source)) {
    if (command === "begin" || command === "end") continue;
    const probeSource = `\\${command}{x}`;
    const probeText = latexToUnicode(probeSource);
    if (hasOrphanedCombiningMark(probeText)) {
      return { orphanedMark: `\\${command}`, unsupported };
    }
    if (!probeText.includes(command)) continue;
    try {
      const probeMathml = katex.renderToString(probeSource, katexOptions);
      if (!probeMathml.includes(`>${command}<`)) unsupported.push(`\\${command}`);
    } catch {
      unsupported.push(`\\${command}`);
    }
  }
  return { unsupported };
}

function unsupportedEnvironments(source) {
  const unsupported = new Set();
  for (const match of source.matchAll(/\\(?:begin|end)\s*\{([^}]+)\}/g)) {
    const environment = match[1];
    const probe = latexToUnicode(`\\begin{${environment}}x\\end{${environment}}`);
    if (
      misrepresentedEnvironments.has(environment) ||
      probe.includes("begin") ||
      probe.includes("end")
    ) {
      unsupported.add(environment);
    }
  }
  return [...unsupported];
}

function hasOrphanedCombiningMark(text) {
  let previous;
  for (const character of text) {
    if (/\p{Mark}/u.test(character) && (!previous || /[\s([{]/u.test(previous))) {
      return true;
    }
    previous = character;
  }
  return false;
}

function renderFormula(source) {
  const uncommentedSource = stripLatexComments(source);
  katex.renderToString(uncommentedSource, katexOptions);
  const unsupportedEnvironment = unsupportedEnvironments(uncommentedSource).at(0);
  if (unsupportedEnvironment) {
    throw new Error(`Unicode renderer does not support environment ${unsupportedEnvironment}`);
  }
  const problems = commandProblems(uncommentedSource);
  if (problems.orphanedMark) {
    throw new Error("Unicode renderer produced an orphaned combining mark");
  }
  const unsupportedCommand = problems.unsupported.at(0);
  if (unsupportedCommand) {
    throw new Error(`Unicode renderer does not support ${unsupportedCommand}`);
  }
  const text = `${latexToUnicode(uncommentedSource.trim()).trimEnd()}\n`;
  if (hasOrphanedCombiningMark(text)) {
    throw new Error("Unicode renderer produced an orphaned combining mark");
  }
  return { text };
}

function renderFormulas(sources) {
  return renderBlocks(sources, {
    heading: (index, total) => `Formula ${index} of ${total}`,
    renderBlock: renderFormula,
  });
}

export const latexFormat = {
  id: "latex",
  displayName: "LaTeX",
  sourceFileName: "formula.tex",
  recordFileName: "latex-preview.json",
  viewerEntrypoint: "latex-viewer",
  notFoundMessage: "no LaTeX formula found in recent pane output",
  findOpeningDelimiter(line) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*(?:latex|tex|math)(?:\s+.*)?$/i)?.[1];
    if (fence) return { kind: "fence", fence };
    if (/^(?:latex|tex)$/i.test(trimmed)) return { kind: "label" };
    if (trimmed.startsWith("$$")) return { close: "$$", kind: "paired", open: "$$" };
    if (trimmed.startsWith("\\[")) return { close: "\\]", kind: "paired", open: "\\[" };
    return undefined;
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
    if (delimiter.kind === "label") {
      return parseBlankLineBlock({ incompleteMessage, lines, startIndex });
    }
    return parsePairedDelimiterBlock({
      close: delimiter.close,
      incompleteMessage,
      lines,
      normalizeLine: stripLatexComments,
      open: delimiter.open,
      startIndex,
    });
  },
  render: renderFormulas,
};
