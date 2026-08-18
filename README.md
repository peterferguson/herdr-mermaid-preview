# Herdr Mermaid Preview

Preview the latest Mermaid diagram from a Claude Code or Codex pane in a dedicated Herdr split.

The action reads the invoking pane's recent unwrapped output, extracts the latest complete Mermaid
block, renders it as Unicode, and opens a preview to the right. Repeating the action
updates and focuses the existing preview for that source pane. Different source panes own independent
previews.

## Install

Link this checkout and reload Herdr:

```sh
herdr plugin link /Users/peterferguson/repos/herdr-plugins/herdr-mermaid-preview --enabled
herdr server reload-config
```

Add the shortcut:

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "local.mermaid-preview.open"
description = "Preview the latest Mermaid diagram"
```

Reload Herdr after editing the config:

```sh
herdr server reload-config
```

## Use

Focus a Claude Code or Codex pane that contains a Mermaid response and press `prefix+m`.

The preview pane supports `r` to redraw and `q` to close.

The action is also available without a shortcut:

```sh
herdr plugin action invoke local.mermaid-preview.open
```

## Extraction and rendering

Claude Code currently renders a Mermaid fence as a standalone `mermaid` label followed by its source.
Codex can preserve the literal fence marker in some output paths. The plugin accepts both shapes and
selects the most recent complete block in the last 2,000 unwrapped lines.

Rendered-label blocks end at the first blank line. Literal fenced blocks may contain blank lines and end
at their closing fence. Diagrams larger than 64 KiB are rejected before rendering.

Rendering uses `beautiful-mermaid` and supports flowchart, sequence, class, state, entity-relationship,
and XY diagrams. The generated Mermaid and Unicode preview stay in Herdr's plugin state directory with
private file permissions.

## Verify

```sh
npm test
```
