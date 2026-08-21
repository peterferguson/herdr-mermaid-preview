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

async function runAction({
  existingPreviewPaneId,
  format = "mermaid",
  scrollbackText = scrollback,
} = {}) {
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
      path.join(previewDirectory, format === "mermaid" ? "preview.json" : `${format}-preview.json`),
      `${JSON.stringify({ previewPaneId: existingPreviewPaneId, sourcePaneId: "w42:p3K" })}\n`,
    );
  }

  const result = spawnSync(process.execPath, ["src/action.js", format], {
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

test("renders display LaTeX from the latest matching message", async () => {
  const { calls, previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: `
› explain the equation

  $$
  E = mc^2
  $$

› next task
`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "formula.tex"), "utf8"),
    "E = mc^2\n",
  );
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.match(preview, /²/);
  assert.doesNotMatch(preview, /mc\^2/);
  const invocations = await readFile(calls, "utf8");
  assert.match(invocations, /plugin pane open .*--entrypoint latex-viewer/);
  assert.match(invocations, /RESPONSE_PREVIEW_FILE=.*formula\.tex/);
});

test("renders every LaTeX block from the latest matching message", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: `
❯ old equation
$$ E = old^2 $$

› current equations
\\[
\\alpha + \\beta
\\]

$$ \\sum_{i=1}^{n} x_i $$

❯ next task
`,
  });

  assert.equal(result.status, 0, result.stderr);
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.match(preview, /^Formula 1 of 2$/m);
  assert.match(preview, /^Formula 2 of 2$/m);
  assert.match(preview, /α \+ β/);
  assert.match(preview, /∑/);
  assert.doesNotMatch(preview, /old/);
});

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

test("renders every Mermaid block from the latest message", async () => {
  const { previewDirectory, result } = await runAction({
    scrollbackText: `
❯ explain the old path

  mermaid
  flowchart LR
      Old["Older message"] --> Stale["Do not preview"]

❯ explain both current paths

  The write path is asynchronous:

  mermaid
  flowchart LR
      Request["Current request"] --> Ledger["Ledger write"]

  A leaked lock amplifies retries:

  mermaid
  flowchart TD
      Lock["Leaked lock"] --> Retry["Provider retry"]

❯ next task
`,
  });

  assert.equal(result.status, 0, result.stderr);
  const preview = await readFile(path.join(previewDirectory, "diagram.txt"), "utf8");
  assert.match(preview, /^Diagram 1 of 2$/m);
  assert.match(preview, /^Diagram 2 of 2$/m);
  assert.match(preview, /Current request/);
  assert.match(preview, /Ledger write/);
  assert.match(preview, /Leaked lock/);
  assert.match(preview, /Provider retry/);
  assert.doesNotMatch(preview, /Older message/);
  assert.doesNotMatch(preview, /Do not preview/);
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

test("reuses LaTeX previews independently from Mermaid previews", async () => {
  const { calls, previewDirectory, result } = await runAction({
    existingPreviewPaneId: "w42:p7",
    format: "latex",
    scrollbackText: "  $$ E = mc^2 $$\n",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "formula.tex"), "utf8"),
    "E = mc^2\n",
  );
  const invocations = await readFile(calls, "utf8");
  assert.match(invocations, /pane get w42:p7/);
  assert.match(invocations, /plugin pane focus w42:p7/);
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

test("extracts a LaTeX fence when the agent TUI preserves fence markers", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: "  ```latex\n  \\frac{x^2 + 1}{x - 1}\n  ```\n",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(previewDirectory, "formula.tex"), "utf8"),
    "\\frac{x^2 + 1}{x - 1}\n",
  );
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.match(preview, /²/);
  assert.doesNotMatch(preview, /\\frac/);
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

test("does not preview an unterminated rendered Mermaid block", async () => {
  const { calls, result } = await runAction({
    scrollbackText: "  mermaid\n  sequenceDiagram\n    participant A as Request A",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latest Mermaid block is empty or incomplete/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("does not preview an incomplete LaTeX block that is still streaming", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$\n  E = mc^2\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latest LaTeX block is empty or incomplete/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("reports when recent output contains no Mermaid block", async () => {
  const { calls, result } = await runAction({
    scrollbackText: "There is no diagram in this response.\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no Mermaid diagram found in recent pane output/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("reports when recent output contains no LaTeX block", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "There is no display math in this response.\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no LaTeX formula found in recent pane output/);
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

test("reports malformed LaTeX before opening a preview pane", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$\n  \\frac{x}{\n  $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /KaTeX parse error/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
  assert.match(invocations, /notification show LaTeX preview failed --body/);
});

test("rejects valid LaTeX that the Unicode renderer cannot represent", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$ \\textcolor{red}{x} $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer does not support \\textcolor/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("renders supported LaTeX commands and matrix row separators", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText:
      "  $$ \\mathrm{x} = \\begin{matrix}a&b\\\\c&d\\end{matrix} $$\n",
  });

  assert.equal(result.status, 0, result.stderr);
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.match(preview, /x/);
  assert.match(preview, /; /);
  assert.doesNotMatch(preview, /\\(?:begin|mathrm)/);
});

test("does not confuse command names with their rendered text content", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$ \\text{context} $$\n",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await readFile(path.join(previewDirectory, "formula.txt"), "utf8"),
    /context/,
  );
});

test("checks each unsupported command without cross-formula masking", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText:
      "  $$ \\textcolor{red}{x} + \\operatorname{textcolor}(y) $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer does not support \\textcolor/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("rejects LaTeX environments the Unicode renderer misrepresents", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText:
      "  $$ \\begin{array}{cc}a&b\\\\c&d\\end{array} $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer does not support environment array/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("rejects LaTeX commands that produce orphaned combining marks", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$ \\widehat{x} $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer produced an orphaned combining mark/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("rejects misplaced combining marks regardless of preceding formula content", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$ y \\widehat{x} $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer produced an orphaned combining mark/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});

test("ignores LaTeX comments during capability checks and Unicode rendering", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: "  $$\n  x % \\textcolor{red}{ignored}\n  + y\n  $$\n",
  });

  assert.equal(result.status, 0, result.stderr);
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.doesNotMatch(preview, /ignored|textcolor|%/);
  assert.match(preview, / \+ /);
});

test("ignores paired closing delimiters inside LaTeX comments", async () => {
  const { previewDirectory, result } = await runAction({
    format: "latex",
    scrollbackText: `
  $$
  x % discussed $$
  + y
  $$

  \\[
  a % discussed \\]
  + b
  \\]
`,
  });

  assert.equal(result.status, 0, result.stderr);
  const preview = await readFile(path.join(previewDirectory, "formula.txt"), "utf8");
  assert.match(preview, /^Formula 1 of 2$/m);
  assert.match(preview, /^Formula 2 of 2$/m);
  assert.doesNotMatch(preview, /discussed/);
  assert.equal((preview.match(/ \+ /g) ?? []).length, 2);
});

test("rejects parameterized alignment environments the renderer misrepresents", async () => {
  const { calls, result } = await runAction({
    format: "latex",
    scrollbackText:
      "  $$ \\begin{alignedat}{2}a&=b&c&=d\\\\e&=f&g&=h\\end{alignedat} $$\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode renderer does not support environment alignedat/);
  const invocations = await readFile(calls, "utf8");
  assert.doesNotMatch(invocations, /plugin pane open/);
});
