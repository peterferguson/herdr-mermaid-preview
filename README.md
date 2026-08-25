# Herdr Response Preview

Preview Mermaid diagrams and display LaTeX from a Claude Code or Codex pane in dedicated Herdr
splits.

The plugin reads the invoking pane's recent unwrapped output, selects every matching block from the
latest matching message, renders it as Unicode, and opens a preview to the right. Repeating an action
updates and focuses the existing preview for that source pane and format. Mermaid and LaTeX previews
are managed independently.

The technical plugin ID remains `local.mermaid-preview` so existing installations and `prefix+m`
bindings continue to work while the plugin broadens beyond Mermaid.

## Install

Link this checkout and reload Herdr:

```sh
herdr plugin link /Users/peterferguson/repos/herdr-plugins/herdr-mermaid-preview --enabled
herdr server reload-config
```

Add shortcuts:

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "local.mermaid-preview.open"
description = "Preview Mermaid from the latest response"

[[keys.command]]
key = "prefix+l"
type = "plugin_action"
command = "local.mermaid-preview.latex"
description = "Preview LaTeX from the latest response"
```

Reload Herdr after editing the config:

```sh
herdr server reload-config
```

## Use

Focus a Claude Code or Codex pane containing the format you want to preview, then invoke its action.
The preview pane supports `r` to redraw and `q` to close.

The actions are also available without shortcuts:

```sh
herdr plugin action invoke local.mermaid-preview.open
herdr plugin action invoke local.mermaid-preview.latex
```

## Extraction and rendering

The shared extraction pipeline owns ANSI cleanup, Claude/Codex message boundaries, latest-message
selection, delimiter scanning, aggregate size checks, pane reuse, and file handling. Each format
adapter injects its opening-delimiter matcher, block parser, renderer, source filename, and pane
entrypoint. Adding another format does not require copying the Herdr lifecycle.

Mermaid accepts literal `mermaid` fences, Claude Code's rendered standalone `mermaid` label, and
bare syntax when an agent TUI omits both delimiters. Bare syntax must begin with an exact supported
diagram declaration such as `flowchart LR` or `sequenceDiagram`. Rendered-label and bare-syntax
blocks end at the first blank line; fenced blocks end at their closing fence. Rendering uses
`beautiful-mermaid`.

LaTeX accepts:

- display math delimited by `$$ ... $$` or `\[ ... \]`, on one or several lines;
- literal `latex`, `tex`, or `math` fences;
- Claude/Codex rendered standalone `latex` or `tex` code-block labels.

KaTeX validates each formula before `latex2unicode` produces the terminal preview. Inline `$...$` and
`\(...\)` expressions are intentionally excluded to avoid treating prose, shell variables, or currency
as preview blocks.

Each selected message is limited to 64 KiB of source before rendering. Generated sources, Unicode
previews, and source-to-preview records stay in Herdr's plugin state directory with private file
permissions.

## Verify

```sh
npm test
npm run check
```
