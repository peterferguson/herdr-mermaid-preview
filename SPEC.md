# Response preview plugin specification

## Outcome

A Herdr user can focus a Claude Code or Codex pane and preview every Mermaid diagram or display-LaTeX
formula from the latest matching response in a Unicode split to the right.

## Shared architecture

- Normalize recent pane output and split it into Claude Code (`❯`) and Codex (`›`) message ranges once.
- Select the latest message containing a delimiter recognized by the requested format.
- Collect blocks through an injected format adapter with `findOpeningDelimiter`, `parseBlock`, and
  `render` responsibilities.
- Keep Herdr reads, the 64-KiB aggregate limit, private file writes, pane opening, and pane reuse
  independent of the selected format.
- Keep one source-to-preview association per source pane and format.

## Mermaid behaviour

- Accept literal fenced Mermaid blocks and rendered standalone `mermaid` labels.
- Select every complete block from the latest matching message without including older-message blocks.
- Render locally as Unicode with `beautiful-mermaid`.
- Preserve `local.mermaid-preview.open` and its existing state filenames for compatibility.

## LaTeX behaviour

- Accept display blocks delimited by `$$ ... $$` and `\[ ... \]`, including one-line blocks.
- Accept literal `latex`, `tex`, and `math` fences plus rendered standalone `latex` and `tex` labels.
- Select every complete block from the latest matching message without including older-message blocks.
- Validate each formula with KaTeX and reject malformed or unsupported input before opening a pane.
- Render locally as readable Unicode with `latex2unicode`.
- Manage LaTeX source, output, and pane records independently from Mermaid for the same source pane.

## Interaction

- `prefix+m`: invoke `local.mermaid-preview.open`.
- `prefix+l`: invoke `local.mermaid-preview.latex` when configured.
- `r`: redraw the current preview.
- `q`: close the current preview.

Mermaid extraction accepts fenced blocks, rendered `mermaid` labels, and exact bare diagram headers
when the agent TUI omits code-block delimiters. Undelimited diagrams end at the first blank line.

## Verification

- Cover parser injection and Claude/Codex message boundaries through the shared extractor.
- Cover first open, reuse, multiple blocks, missing/incomplete/oversized/malformed input, literal fences,
  display delimiters, format-independent pane records, and Unicode rendering.
- Run `npm test`, `npm run check`, and `git diff --check`.

## Out of scope

- Inline `$...$` and `\(...\)` extraction.
- Inline rendering inside the agent TUI's own scrollback.
- Browser, terminal-image-protocol, or pixel-perfect TeX rendering.
- Full LaTeX document compilation or editing source inside the preview pane.
