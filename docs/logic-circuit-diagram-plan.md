# Logic And Circuit Diagram Editor Plan

## Summary

Add a phased diagramming feature for university-oriented logic-gate overviews first, then expand toward electronics component diagrams. The first useful version should create editable vault documents, simulate basic digital logic, and export a note-embeddable graphic that remains linked to the source editor.

## Progress Tracker

| Phase | Status | Goal |
| --- | --- | --- |
| 0. Product shaping | Complete | Locked document format, source/export intent, and local groundwork. |
| 1. Static logic diagram editor | Complete | Create editable logic-gate diagrams as vault documents. |
| 2. Boolean interaction | Complete | Add toggleable inputs and live gate evaluation. |
| 3. Note insertion/export | Complete | Export editable-source-linked graphics into notes. |
| 4. Diagram polish and reuse | Complete | Add templates, library improvements, and better authoring flow. |
| 5. Electronic component diagrams | Planned | Add static resistor/transistor/etc. schematic symbols. |
| 6. Circuit simulation research | Deferred | Decide whether real electronics simulation is worth integrating. |

## Phase Details

### Phase 0: Product Shaping

- Choose a new document extension, defaulting to `.logic`.
- Store diagrams as JSON documents through the existing `VaultClient` document path.
- Treat `.logic` files as editable source documents, not generated images.
- Keep note insertion as exported SVG snapshots for v1, with source metadata linking back to the editable `.logic` document.
- Avoid analog simulation in the first release.

Acceptance criteria:

- The feature has a settled file extension, document schema, and first-screen workflow.
- The initial gate/component list is fixed before implementation.

Groundwork completed:

- `.logic` is the editable source extension.
- v1 source documents use `kind: "logic-diagram"`, `schemaVersion: 1`, `nodes`, `wires`, and `viewport`.
- `.logic` imports are validated before document creation.
- Local vault file allow-lists and encryption handling include `.logic`.
- Hosted `.logic` support remains a Phase 1 implementation item because hosted document typing currently recognizes note, kanban, and canvas only.

### Phase 1: Static Logic Diagram Editor

- Add a `LogicDiagramView` opened for `.logic` tabs.
- Use React Flow, matching the existing canvas technology stack.
- Support nodes for input, output, AND, OR, NOT, XOR, NAND, NOR, and XNOR.
- Support wires between compatible handles.
- Add a document top bar using the shared `DocumentTopBar` pattern.
- Add toolbar actions for gate insertion, input/output insertion, delete, duplicate, zoom, and fit view.
- Persist diagram JSON with optimistic document writes through `VaultClient.writeDocument`.

Acceptance criteria:

- Users can create, open, edit, save, close, and reopen a `.logic` file.
- The diagram round-trips through local and hosted vault document APIs.
- Invalid or older JSON loads safely with a recoverable empty/default diagram.

Implementation notes:

- `.logic` files open in `LogicDiagramView`.
- The first editor uses React Flow with static input/output and logic-gate nodes.
- Users can add gates, connect wires, delete selected gates/wires, fit view, and save.
- Command bar creation writes an initial v1 `.logic` source document.
- Boolean evaluation, templates, note export, and click-to-reopen exported graphics remain later phases.

### Phase 2: Boolean Interaction

- Add a pure TypeScript logic evaluator.
- Inputs can be toggled between `0` and `1`.
- Gate outputs update live based on connected upstream values.
- Outputs and active wires visually show their current state.
- Detect unresolved, floating, or cyclic circuits and surface non-blocking warnings.

Acceptance criteria:

- Basic circuits such as NOT, AND, OR, XOR, half-adder, and full-adder evaluate correctly.
- Cycles or incomplete wiring do not crash the editor.
- Evaluator logic is covered by focused unit tests.

Implementation notes:

- Inputs toggle between `0` and `1` through mouse, keyboard, and context-menu actions.
- Gate outputs, output nodes, and wires update from the pure evaluator.
- Wires show signal direction and active/off/unknown state.
- Active nodes show accent overlays based on active inputs or active output state.
- Gate input handles enforce the expected arity and one wire per input.
- Focused evaluator and flow round-trip tests cover the core logic behavior.

### Phase 3: Note Insertion, Export, And Reopen

- Add an export action that renders the current diagram to SVG first.
- Save exported graphics into `Pictures/` using existing generated-asset conventions where possible.
- Insert markdown image syntax into the active note, preferring the SVG export:

  ```md
  ![Diagram title](Pictures/example.svg)
  ```

- Preserve the `.logic` source document separately from the exported graphic.
- Include source metadata in the exported SVG, such as the source `.logic` relative path and a diagram export marker.
- Extend rendered-note image handling so clicking a generated diagram SVG opens the source `.logic` editor when source metadata is available.
- Keep normal image behavior for non-diagram images and for legacy exported diagrams that lack source metadata.
- Provide an explicit image-view fallback for exported diagrams whose source `.logic` document is missing or inaccessible.

Acceptance criteria:

- A diagram can be exported and embedded into a note as a visible graphic.
- Clicking the embedded generated diagram in a note opens the editable source diagram, similar to how image assets open the image editor.
- Re-exporting can overwrite the previous graphic by default so the note stays pointed at the latest visual, with unique-name export available when requested.
- Hosted vault behavior respects existing read/write permissions.

Implementation notes:

- Logic diagrams export through a deterministic SVG renderer with embedded source metadata containing a diagram marker and source `.logic` relative path.
- `LogicDiagramView` exposes an `Insert in note` action that saves the SVG into `Pictures/`, appends markdown image syntax to an open note, and switches back to that note.
- Local exports overwrite the stable `Pictures/<diagram>.svg` asset by default so existing note links continue to point at the latest visual.
- Shift-clicking `Insert in note` requests a unique generated SVG path instead of overwriting the stable local export.
- Hosted exports use the hosted asset import capability and remain disabled for read-only hosted viewers.
- Rendered note images inspect exported SVG metadata and open the source `.logic` editor when the source still exists; if the source is missing, the click falls back to opening the exported image asset.

### Phase 4: Diagram Polish And Reuse

- Add starter templates: basic gates, half-adder, full-adder, multiplexer, flip-flop overview.
- Add keyboard shortcuts using layout-independent keys only.
- Add gate labels, wire labels, and compact truth-value badges.
- Add import/export of reusable diagram snippets if there is clear demand.
- Add command-bar and slash-command entry points after the core workflow is stable.

Acceptance criteria:

- Common university examples can be created quickly without manual layout from scratch.
- The editor feels consistent with existing canvas, kanban, image, and PDF document views.

Implementation notes:

- Four starter templates ship in `logicDiagramTemplates.ts`: Half-Adder, Full-Adder, 2:1 Multiplexer, and SR Flip-Flop Overview. (Basic Gates was dropped — individual gates are faster to add via the toolbar.)
- `instantiateLogicDiagramTemplate()` regenerates fresh node/wire IDs on each call so multiple inserts into the same diagram never collide.
- A "Templates" toolbar button (Shapes icon) opens a picker dialog that appends the chosen template at the viewport center and fits the view.
- Gate labels are editable for all node kinds (not just groups) via double-click, `F2`, or context menu. The rename dialog title adapts ("Rename group" / "Label gate" / "Label output" / "Label wire").
- Wire labels render live in the editor via `EdgeLabelRenderer` as a pill badge at the wire midpoint. Labels were already exported in SVG; "Label wire" is added to the edge context menu.
- Keyboard shortcuts added: `Ctrl/Cmd+D` duplicates the selection (gates + internal wires), `r` = OR, `d` = NAND, `e` = NOR (completing the set alongside existing `i`/`o`/`a`/`n`/`x`). All use `event.key.toLowerCase()` for layout independence.
- A "Logic Diagram" slash command is added to `slashCommands.ts` for discoverability. The command-bar `new-logic` entry already existed.
- Truth-value display kept as-is (color wash, wire color, `0`/`1`/`unset` text) — no new badge component.
- Import/export of reusable diagram snippets is deferred pending clear demand.

### Phase 5: Electronic Component Diagrams

- Add a separate schematic mode or new document extension only after logic diagrams are useful.
- Start with static symbols: resistor, capacitor, inductor, diode, LED, transistor, switch, ground, voltage source.
- Reuse the same editor shell where practical, but keep logic evaluation separate from electronics diagrams.
- Export electronic diagrams to notes using the same graphic pipeline.

Acceptance criteria:

- Users can create clean static electronics overviews for notes.
- No UI implies real analog simulation unless simulation has actually been implemented.

### Phase 6: Circuit Simulation Research

- Treat real electronics simulation as a separate research task.
- Evaluate whether to integrate an existing SPICE-like engine rather than hand-rolling simulation.
- Decide supported scope: DC-only, transient analysis, small educational circuits, or no simulation.
- Consider performance, packaging, licensing, wasm/native boundary, and offline support.

Acceptance criteria:

- A written decision exists before implementation starts.
- The app does not commit to analog simulation without a proven engine path.

## Key Implementation Changes

- Add a new tab/document type for `.logic`.
- Add routing in the app shell so `.logic` files open in `LogicDiagramView`.
- Add diagram types and schema helpers in frontend code.
- Add pure evaluator tests for digital logic.
- Add export helpers for SVG/PNG generation and note insertion.
- Add metadata-aware note image click handling so generated diagram graphics can reopen their source editor.
- Keep all frontend file access through `VaultClient` and `tauriCommands`; do not call Tauri filesystem plugins directly from components.

## Test Plan

- Unit-test schema normalization and migration defaults.
- Unit-test boolean evaluator behavior for every supported gate.
- Unit-test cycle, missing input, and disconnected output handling.
- Component-test the editor for add/connect/toggle/save flows.
- Component-test export/note insertion behavior with mocked vault client APIs.
- Component-test clicking an embedded generated diagram image from rendered notes opens the source `.logic` editor.
- Component-test fallback behavior when the embedded diagram source path is missing.
- Run `pnpm test` and `pnpm exec tsc --noEmit`.
- For backend-touching export changes, also run `cd src-tauri && cargo test` and `cargo check`.

## Assumptions

- The first version uses `.logic` as the editable source format.
- The first version is digital logic only, not analog electronics simulation.
- Note embedding uses exported SVG graphics first, but those graphics remain linked to their editable source document.
- React Flow remains the diagram editing foundation.
- Electronics components are a later static-diagram feature unless simulation research proves feasible.
