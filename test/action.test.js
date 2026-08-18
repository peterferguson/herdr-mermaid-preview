import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scrollback = `
  The read and write live in different timelines.

  \u001b[0m\u001b[2mmermaid\u001b[0m
  sequenceDiagram
      participant A as Request A
      participant B as Request B
      A->>B: debit

  Each caller hits a different flavour of it.
`;

async function runAction({ existingPreviewPaneId, scrollbackText = scrollback } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "herdr-mermaid-preview-"));
  const state = path.join(temp, "state");
  const calls = path.join(temp, "calls.jsonl");
  const fakeHerdr = path.join(temp, "herdr");
  await writeFile(
    fakeHerdr,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS_PATH"
if [ "$1 $2" = "pane read" ]; then
  printf '%s' "$SCROLLBACK"
elif [ "$1 $2" = "pane get" ] && [ -n "$EXISTING_PREVIEW_PANE_ID" ]; then
  printf '{"result":{"pane":{"pane_id":"%s"}}}\n' "$EXISTING_PREVIEW_PANE_ID"
elif [ "$1 $2" = "pane get" ]; then
  exit 1
elif [ "$1 $2 $3" = "plugin pane open" ]; then
  printf '%s\\n' '{"result":{"plugin_pane":{"pane":{"pane_id":"w1:p9"}}}}'
else
  printf '%s\\n' '{}'
fi
`,
  );
  await chmod(fakeHerdr, 0o755);

  const previewDirectory = path.join(state, "previews", "w42_p3K");
  if (existingPreviewPaneId) {
    await mkdir(previewDirectory, { recursive: true });
    await writeFile(
      path.join(previewDirectory, "preview.json"),
      `${JSON.stringify({ previewPaneId: existingPreviewPaneId, sourcePaneId: "w42:p3K" })}\n`,
    );
  }

  const result = spawnSync(process.execPath, ["src/action.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      CALLS_PATH: calls,
      SCROLLBACK: scrollbackText,
      EXISTING_PREVIEW_PANE_ID: existingPreviewPaneId || "",
      HERDR_BIN_PATH: fakeHerdr,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
        focused_pane_id: "w42:p3K",
        focused_pane_cwd: "/worktree",
      }),
      HERDR_PLUGIN_STATE_DIR: state,
      HERDR_PLUGIN_ROOT: path.resolve(import.meta.dirname, ".."),
    },
  });

  return { calls, previewDirectory, result };
}

test("opens a targeted preview for the latest rendered Mermaid block", async () => {
  const { calls, previewDirectory, result } = await runAction();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "diagram.mmd"), "utf8"),
    "sequenceDiagram\n    participant A as Request A\n    participant B as Request B\n    A->>B: debit\n",
  );
  assert.ok((await stat(path.join(previewDirectory, "diagram.txt"))).size > 0);
  const invocations = await readFile(calls, "utf8");
  assert.match(invocations, /pane read w42:p3K --source recent-unwrapped/);
  assert.match(invocations, /plugin pane open .*--target-pane w42:p3K/);
  assert.match(invocations, /--direction right/);
});

test("updates and focuses the existing preview for the source pane", async () => {
  const { calls, previewDirectory, result } = await runAction({
    existingPreviewPaneId: "w42:p8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "diagram.mmd"), "utf8"),
    "sequenceDiagram\n    participant A as Request A\n    participant B as Request B\n    A->>B: debit\n",
  );
  const invocations = await readFile(calls, "utf8");
  assert.match(invocations, /pane get w42:p8/);
  assert.match(invocations, /plugin pane focus w42:p8/);
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("rejects an oversized Mermaid block before opening a pane", async () => {
  const { calls, result } = await runAction({
    scrollbackText: `  mermaid\n  flowchart TD\n    A["${"x".repeat(70_000)}"]\n\n`,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds the 65536 byte limit/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("extracts a Mermaid fence when the agent TUI preserves fence markers", async () => {
  const { previewDirectory, result } = await runAction({
    scrollbackText: `  \`\`\`mermaid\n  flowchart LR\n    A --> B\n\n    B --> C\n  \`\`\`\n`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "diagram.mmd"), "utf8"),
    "flowchart LR\n  A --> B\n\n  B --> C\n",
  );
});

test("does not preview an incomplete block that is still streaming", async () => {
  const { calls, result } = await runAction({
    scrollbackText: "  ```mermaid\n  sequenceDiagram\n    participant A as Request A\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latest Mermaid block is empty or incomplete/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("reports malformed Mermaid before opening a preview pane", async () => {
  const { calls, result } = await runAction({
    scrollbackText: "  mermaid\n  not-a-diagram\n\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid mermaid header/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
  assert.match(invocations, /notification show Mermaid preview failed --body/);
});
