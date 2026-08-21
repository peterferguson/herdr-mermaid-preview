import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { renderDiagram } from "../src/render.js";

test("renders a generated Unicode preview", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mermaid-viewer-"));
  const source = "flowchart LR\n  A --> B\n";
  const rendered = renderDiagram(source);
  await writeFile(path.join(directory, "diagram.mmd"), source);
  await writeFile(path.join(directory, "diagram.txt"), rendered.text);

  const result = spawnSync(process.execPath, ["src/viewer.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      RESPONSE_PREVIEW_FILE: path.join(directory, "diagram.mmd"),
      RESPONSE_PREVIEW_ONCE: "1",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith("\u001b[2J\u001b[H"));
  assert.match(result.stdout, /A/);
  assert.match(result.stdout, /B/);
  assert.match(result.stdout, /r: reload/);
  assert.doesNotMatch(result.stdout, /\u001b_G/);
});
