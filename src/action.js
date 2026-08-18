import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderDiagram } from "./render.js";

const PLUGIN_ID = "local.mermaid-preview";
const MAX_DIAGRAM_BYTES = 65_536;

function runHerdr(args, { raw = false } = {}) {
  const executable = process.env.HERDR_BIN_PATH || "herdr";
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${executable}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `herdr exited ${result.status}`).trim());
  }
  if (raw) return result.stdout || "";
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function context() {
  try {
    return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
  } catch {
    return {};
  }
}

function stripAnsi(text) {
  return text.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "");
}

function dedent(lines) {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const amount = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(amount));
}

function latestRenderedMermaid(scrollback) {
  const lines = stripAnsi(scrollback).replaceAll("\r\n", "\n").split("\n");
  let latestMarker = -1;
  let latestComplete;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*mermaid(?:\s+.*)?$/i)?.[1];
    if (fence) {
      latestMarker = index;
      const body = [];
      let closed = false;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const closing = lines[cursor].trim();
        if (
          closing.length >= fence.length &&
          [...closing].every((character) => character === fence[0])
        ) {
          closed = true;
          index = cursor;
          break;
        }
        body.push(lines[cursor]);
      }
      if (closed && body.some((line) => line.trim())) {
        latestComplete = { body, marker: latestMarker };
      }
      continue;
    }

    if (trimmed.toLowerCase() !== "mermaid") continue;
    latestMarker = index;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].trim()) break;
      body.push(lines[cursor]);
    }
    if (body.length) latestComplete = { body, marker: latestMarker };
  }

  if (!latestComplete) {
    throw new Error(
      latestMarker < 0
        ? "no Mermaid diagram found in recent pane output"
        : "the latest Mermaid block is empty or incomplete",
    );
  }
  if (latestComplete.marker !== latestMarker) {
    throw new Error("the latest Mermaid block is empty or incomplete");
  }
  return `${dedent(latestComplete.body).join("\n").trimEnd()}\n`;
}

function unwrapPaneId(response) {
  return response?.result?.plugin_pane?.pane?.pane_id;
}

function reusablePreviewPane(recordPath) {
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (typeof record.previewPaneId !== "string" || !record.previewPaneId) return undefined;
    const response = runHerdr(["pane", "get", record.previewPaneId]);
    return response?.result?.pane?.pane_id === record.previewPaneId
      ? record.previewPaneId
      : undefined;
  } catch {
    return undefined;
  }
}

function writePrivateFile(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
}

function main() {
  const ctx = context();
  const sourcePaneId = ctx.focused_pane_id || process.env.HERDR_PANE_ID;
  const cwd = ctx.focused_pane_cwd || ctx.workspace_cwd || process.cwd();
  if (!sourcePaneId) throw new Error("could not determine the source pane");

  const scrollback = runHerdr(
    [
      "pane",
      "read",
      sourcePaneId,
      "--source",
      "recent-unwrapped",
      "--lines",
      "2000",
      "--format",
      "text",
      "--raw",
    ],
    { raw: true },
  );
  const mermaid = latestRenderedMermaid(scrollback);
  const diagramBytes = Buffer.byteLength(mermaid, "utf8");
  if (diagramBytes > MAX_DIAGRAM_BYTES) {
    throw new Error(
      `the latest Mermaid block is ${diagramBytes} bytes and exceeds the ${MAX_DIAGRAM_BYTES} byte limit`,
    );
  }
  const rendered = renderDiagram(mermaid);
  const stateRoot = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateRoot) throw new Error("HERDR_PLUGIN_STATE_DIR is not available");
  const previewDirectory = path.join(
    stateRoot,
    "previews",
    sourcePaneId.replaceAll(/[^a-zA-Z0-9_-]/g, "_"),
  );
  mkdirSync(previewDirectory, { recursive: true, mode: 0o700 });
  const diagramPath = path.join(previewDirectory, "diagram.mmd");
  writePrivateFile(path.join(previewDirectory, "diagram.txt"), rendered.text);
  writePrivateFile(diagramPath, mermaid);
  const recordPath = path.join(previewDirectory, "preview.json");
  const existingPreviewPaneId = reusablePreviewPane(recordPath);
  if (existingPreviewPaneId) {
    runHerdr(["plugin", "pane", "focus", existingPreviewPaneId]);
    console.log(`Updated Mermaid preview in ${existingPreviewPaneId}`);
    return;
  }

  const opened = runHerdr([
    "plugin",
    "pane",
    "open",
    "--plugin",
    PLUGIN_ID,
    "--entrypoint",
    "viewer",
    "--placement",
    "split",
    "--target-pane",
    sourcePaneId,
    "--direction",
    "right",
    "--cwd",
    cwd,
    "--env",
    `MERMAID_PREVIEW_FILE=${diagramPath}`,
    "--focus",
  ]);
  const previewPaneId = unwrapPaneId(opened);
  if (!previewPaneId) throw new Error("Herdr did not return the preview pane id");
  writePrivateFile(
    recordPath,
    `${JSON.stringify({ previewPaneId, sourcePaneId })}\n`,
  );
  console.log(`Opened Mermaid preview in ${previewPaneId}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    runHerdr(["notification", "show", "Mermaid preview failed", "--body", message]);
  } catch {}
  console.error(`mermaid-preview: ${message}`);
  process.exitCode = 1;
}
