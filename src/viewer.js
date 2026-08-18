import { readFileSync, watch } from "node:fs";
import path from "node:path";

const ESC = "\u001b";
const sourcePath = process.env.MERMAID_PREVIEW_FILE;

if (!sourcePath) {
  console.error("mermaid-preview: MERMAID_PREVIEW_FILE is not available");
  process.exit(1);
}

const directory = path.dirname(sourcePath);
const textPath = path.join(directory, "diagram.txt");
let redrawTimer;

function redraw() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(readFileSync(textPath, "utf8"));
  process.stdout.write(`\n${ESC}[2mr: reload · q: close${ESC}[0m\n`);
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redraw, 50);
}

redraw();

if (process.env.MERMAID_PREVIEW_ONCE === "1") process.exit(0);

const watcher = watch(directory, (_event, filename) => {
  if (filename === "diagram.mmd") scheduleRedraw();
});

process.on("SIGWINCH", scheduleRedraw);
process.on("exit", () => watcher.close());

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (input) => {
    const key = input.toString("utf8");
    if (key === "q" || key === "\u0003") process.exit(0);
    if (key === "r") redraw();
  });
}
