import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractLatestDelimitedSources } from "./extract.js";
import { latexFormat } from "./formats/latex.js";
import { mermaidFormat } from "./formats/mermaid.js";

const PLUGIN_ID = "local.mermaid-preview";
const MAX_SOURCE_BYTES = 65_536;
const formats = new Map([
  [latexFormat.id, latexFormat],
  [mermaidFormat.id, mermaidFormat],
]);

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
  const formatId = process.argv[2] || "mermaid";
  const format = formats.get(formatId);
  if (!format) throw new Error(`unknown preview format: ${formatId}`);
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
  const sources = extractLatestDelimitedSources(scrollback, format);
  const sourceBytes = sources.reduce(
    (total, source) => total + Buffer.byteLength(source, "utf8"),
    0,
  );
  if (sourceBytes > MAX_SOURCE_BYTES) {
    throw new Error(
      `the latest ${format.displayName} message contains ${sourceBytes} bytes and exceeds the ${MAX_SOURCE_BYTES} byte limit`,
    );
  }
  const rendered = format.render(sources);
  const stateRoot = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!stateRoot) throw new Error("HERDR_PLUGIN_STATE_DIR is not available");
  const previewDirectory = path.join(
    stateRoot,
    "previews",
    sourcePaneId.replaceAll(/[^a-zA-Z0-9_-]/g, "_"),
  );
  mkdirSync(previewDirectory, { recursive: true, mode: 0o700 });
  const sourcePath = path.join(previewDirectory, format.sourceFileName);
  const textPath = path.join(
    previewDirectory,
    `${path.basename(format.sourceFileName, path.extname(format.sourceFileName))}.txt`,
  );
  writePrivateFile(textPath, rendered.text);
  writePrivateFile(sourcePath, sources.at(-1));
  const recordPath = path.join(previewDirectory, format.recordFileName);
  const existingPreviewPaneId = reusablePreviewPane(recordPath);
  if (existingPreviewPaneId) {
    runHerdr(["plugin", "pane", "focus", existingPreviewPaneId]);
    console.log(`Updated ${format.displayName} preview in ${existingPreviewPaneId}`);
    return;
  }

  const opened = runHerdr([
    "plugin",
    "pane",
    "open",
    "--plugin",
    PLUGIN_ID,
    "--entrypoint",
    format.viewerEntrypoint,
    "--placement",
    "split",
    "--target-pane",
    sourcePaneId,
    "--direction",
    "right",
    "--cwd",
    cwd,
    "--env",
    `RESPONSE_PREVIEW_FILE=${sourcePath}`,
    "--focus",
  ]);
  const previewPaneId = unwrapPaneId(opened);
  if (!previewPaneId) throw new Error("Herdr did not return the preview pane id");
  writePrivateFile(
    recordPath,
    `${JSON.stringify({ previewPaneId, sourcePaneId })}\n`,
  );
  console.log(`Opened ${format.displayName} preview in ${previewPaneId}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const format = formats.get(process.argv[2] || "mermaid");
  try {
    runHerdr([
      "notification",
      "show",
      `${format?.displayName ?? "Response"} preview failed`,
      "--body",
      message,
    ]);
  } catch {}
  console.error(`response-preview: ${message}`);
  process.exitCode = 1;
}
