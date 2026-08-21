function stripAnsi(text) {
  return text.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "");
}

function isPromptLine(line) {
  return /^\s*[❯›](?:\s|$)/u.test(line);
}

function messages(lines) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isPromptLine(lines[index])) continue;
    if (index > start) ranges.push(lines.slice(start, index));
    start = index;
  }
  ranges.push(lines.slice(start));
  return ranges;
}

function findOpeningDelimiters(lines, findOpeningDelimiter) {
  const openings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const delimiter = findOpeningDelimiter(lines[index]);
    if (delimiter !== undefined) openings.push({ delimiter, index });
  }
  return openings;
}

export function dedent(lines) {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const amount = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(amount));
}

export function parseFencedBlock({ lines, startIndex, fence, incompleteMessage }) {
  const body = [];
  for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
    const closing = lines[cursor].trim();
    if (
      closing.length >= fence.length &&
      [...closing].every((character) => character === fence[0])
    ) {
      if (!body.some((line) => line.trim())) throw new Error(incompleteMessage);
      return {
        endIndex: cursor,
        source: `${dedent(body).join("\n").trimEnd()}\n`,
      };
    }
    body.push(lines[cursor]);
  }
  throw new Error(incompleteMessage);
}

export function parseBlankLineBlock({ lines, startIndex, incompleteMessage }) {
  const body = [];
  for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
    if (!lines[cursor].trim()) {
      if (!body.some((line) => line.trim())) throw new Error(incompleteMessage);
      return {
        endIndex: cursor,
        source: `${dedent(body).join("\n").trimEnd()}\n`,
      };
    }
    body.push(lines[cursor]);
  }
  throw new Error(incompleteMessage);
}

export function parsePairedDelimiterBlock({
  close,
  incompleteMessage,
  lines,
  normalizeLine = (line) => line,
  open,
  startIndex,
}) {
  const openingLine = lines[startIndex].trim();
  const firstLine = openingLine.slice(open.length);
  const normalizedFirstLine = normalizeLine(firstLine);
  const sameLineClose = normalizedFirstLine.lastIndexOf(close);
  if (sameLineClose >= 0) {
    const source = firstLine.slice(0, sameLineClose).trim();
    if (!source) throw new Error(incompleteMessage);
    return { endIndex: startIndex, source: `${source}\n` };
  }

  const body = firstLine.trim() ? [firstLine] : [];
  for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const normalizedLine = normalizeLine(line);
    const closingIndex = normalizedLine.lastIndexOf(close);
    if (
      closingIndex >= 0 &&
      !normalizedLine.slice(closingIndex + close.length).trim()
    ) {
      const beforeClose = line.slice(0, closingIndex);
      if (beforeClose.trim()) body.push(beforeClose);
      if (!body.some((bodyLine) => bodyLine.trim())) throw new Error(incompleteMessage);
      return {
        endIndex: cursor,
        source: `${dedent(body).join("\n").trim()}\n`,
      };
    }
    body.push(line);
  }
  throw new Error(incompleteMessage);
}

export function extractLatestDelimitedSources(scrollback, format) {
  const lines = stripAnsi(scrollback).replaceAll("\r\n", "\n").split("\n");
  const recentMessages = messages(lines);

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    const openings = findOpeningDelimiters(message, format.findOpeningDelimiter);
    if (openings.length === 0) continue;

    const sources = [];
    let parsedThrough = -1;
    for (const { delimiter, index: startIndex } of openings) {
      if (startIndex <= parsedThrough) continue;
      const block = format.parseBlock({ delimiter, lines: message, startIndex });
      if (
        !block ||
        !Number.isInteger(block.endIndex) ||
        block.endIndex < startIndex ||
        block.endIndex >= message.length ||
        typeof block.source !== "string"
      ) {
        throw new Error(`${format.displayName} parser returned an invalid block`);
      }
      sources.push(block.source);
      parsedThrough = block.endIndex;
    }
    return sources;
  }

  throw new Error(
    format.notFoundMessage ?? `no ${format.displayName} block found in recent pane output`,
  );
}
