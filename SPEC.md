# Mermaid preview plugin specification

## Outcome

A Herdr user can focus a Claude Code or Codex pane, press `prefix+m`, and see the latest complete
Mermaid response as a Unicode diagram in a split to the right.

## Behaviour

- Read up to 2,000 recent unwrapped lines from the invoking pane.
- Accept both a literal fenced Mermaid block and Claude Code's rendered `mermaid` label followed by
  indented source.
- Select the latest complete block and reject missing, incomplete, malformed, or larger-than-64-KiB
  input without opening a pane.
- Render locally without a browser and keep generated artifacts private in the plugin state directory.
- Open one managed preview pane per source pane. Repeated invocation updates and focuses that pane;
  invocation from a different source pane opens an independent preview.
- Display the diagram as Unicode without relying on terminal image protocols.
- Lazily discard a stale source-to-preview association when its preview pane has been closed.

## Interaction

- `prefix+m`: invoke the preview action from the focused source pane.
- `r`: redraw.
- `q`: close the preview.

## Verification

- Use a sanitized fixture matching the Mermaid output captured from the `rust-panda` Claude pane.
- Cover first open, reuse, missing/incomplete/oversized/malformed input, literal fences, and Unicode
  rendering.
- Link and reload the plugin, then prove a real `prefix+m` invocation against `rust-panda`.

## Out of scope

- Inline rendering inside the agent TUI's own scrollback.
- Browser-based Mermaid rendering or full compatibility with every Mermaid diagram type.
- Editing Mermaid source inside the preview pane.
