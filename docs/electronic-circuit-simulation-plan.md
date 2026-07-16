# Electronic Circuit Simulation Integration Plan

## Goal

Turn schematic-mode `.logic` files into offline-capable circuit simulations powered by a first-party Rust engine owned and maintained with Collab. The simulator is intentionally scoped to the components and analyses exposed by Collab rather than attempting full SPICE or vendor-model compatibility.

The completed subsystem should support DC operating point, transient, DC sweep, AC analysis, probes and plots, mixed analog/digital circuits, reusable Collab component models, and solver-driven voltage/current overlays on desktop and Android.

This remains a large numerical subsystem. A reliable initial release is approximately 17-27 engineering weeks for one experienced engineer. Advanced semiconductor models and broad SPICE compatibility are explicitly outside the first release.

## Engine Decision

Build an MIT-licensed, pure-Rust simulation engine in `crates/collab-circuit`.

- Collab owns the simulation architecture, component models, numerical behavior, diagnostics, and platform integration.
- No ngspice, XSPICE, or other external simulator is linked, bundled, downloaded, or required at runtime.
- Published circuit-analysis methods may be implemented independently, but external simulator source code must not be copied or translated.
- Permissively licensed numerical crates may be adopted after an explicit dependency and license review. The baseline starts with an internal dense solver so the API and reference fixtures do not depend on that decision.
- External simulators may be used by developers as unbundled numerical comparison tools. They are never a production dependency or source of copied implementation code.

The first release is a focused Collab simulator, not a general SPICE replacement. It will not accept arbitrary SPICE decks, control scripts, vendor binary models, filesystem directives, or shell commands.

## Supported Scope

Initial target:

- Resistors, capacitors, inductors, independent voltage/current sources, switches, clocks, ground, junctions, probes, diodes, and LEDs.
- Existing digital gates and reusable digital components.
- DC operating point, transient analysis, DC sweep, and basic small-signal AC analysis.
- Explicit analog-to-digital and digital-to-analog bridges for mixed circuits.

Deferred until the core is stable:

- BJT and MOSFET model families beyond a deliberately documented basic model.
- Op-amp macro-model import, transmission lines, RF/noise/process simulation, arbitrary behavioral expressions, and vendor SPICE model compatibility.
- A raw simulation console or user-supplied executable code.

## Progress Tracker

| Phase | Status | Goal |
| --- | --- | --- |
| 6.0 First-party foundation | In progress | Establish the Rust crate, typed model, deterministic behavior, and linear DC baseline. |
| 6.1 Simulation document model | Planned | Add electrical values, probes, analyses, junctions, and source waveforms to `.logic`. |
| 6.2 Schematic compiler | Planned | Compile validated `.logic` connectivity into deterministic electrical nets and solver systems. |
| 6.3 DC operating point | Planned | Expand the baseline solver with diagnostics, nonlinear devices, and live overlays. |
| 6.4 Runtime integration | Planned | Run, cancel, and stream simulations through typed Tauri commands on desktop and Android. |
| 6.5 Transient and DC sweep | Planned | Add dynamic elements, time integration, sweeps, and plot inspection. |
| 6.6 AC analysis | Planned | Add small-signal magnitude/phase analysis and Bode plots. |
| 6.7 Mixed-signal simulation | Planned | Coordinate the existing digital evaluator with analog timesteps through explicit bridges. |
| 6.8 Offline, cache, and collaboration | Planned | Cache derived results locally while synchronizing source and configuration only. |
| 6.9 Numerical hardening and release | Planned | Add sparse solving, convergence controls, platform stress tests, and reproducible validation. |

## Phase 6.0: First-Party Foundation

Create `crates/collab-circuit` as a pure Rust workspace crate with no Tauri, webview, filesystem, or network dependency.

Baseline deliverables:

- Stable IDs and typed definitions for nodes and linear DC components.
- Numeric validation rejecting non-finite values, invalid resistance, duplicate IDs, missing references, and unsolvable systems.
- Deterministic unknown ordering and result maps independent of insertion order.
- Modified nodal analysis stamping for resistors, independent current sources, and independent voltage sources.
- A pivoted dense linear solver suitable for small baseline fixtures.
- Node-voltage and per-component branch-current results with typed diagnostics.
- Divider, source, current-source, invalid-value, singular-circuit, and ordering tests.

The dense solver is a correctness baseline, not the final large-circuit implementation. Its public model and result types must remain usable when the matrix backend is replaced with a sparse implementation.

Gate:

- Do not connect simulation controls to the editor until reference fixtures pass deterministically and the `.logic` compiler can report source-mapped diagnostics.

## Phase 6.1: Simulation Document Model

Advance `.logic` to schema v6 with validated optional simulation data:

- Numeric SI component parameters plus display-unit preferences.
- Stable built-in `modelRef` values for nonlinear components.
- Analysis configuration containing tolerances, temperature, time/frequency ranges, and output limits.
- Voltage, differential-voltage, branch-current, and digital probes.
- Explicit junction nodes for branches at arbitrary wire positions. Existing shared terminals remain valid net junctions.
- DC, sine, pulse, piecewise-linear, and clock-derived sources.

Rules:

- Store numeric SI values, not only display strings such as `1k`.
- Rotation is visual and never changes terminal identity or electrical meaning.
- Existing v1-v5 files continue to open as static schematics with safe defaults.
- Unsupported components remain visible but block simulation with a source-mapped diagnostic.

## Phase 6.2: Deterministic Schematic Compiler

- Convert schematic terminals, wires, and explicit junctions into electrical nets using union-find.
- Support any number of wires joining the same terminal or junction.
- Require exactly one reference ground for analog simulation.
- Assign stable node and device ordering from document IDs, independent of visual position and JSON order.
- Produce typed `collab-circuit` inputs rather than generating text netlists.
- Return source maps from solver nodes/components to Collab node, terminal, wire, and probe IDs.
- Detect floating islands, conflicting ideal sources, disconnected pins, invalid values, unsupported models, and oversized jobs before execution.

Testing:

- Golden compiled-circuit tests for every supported component.
- Permutation tests proving insertion order and rotation do not affect results.
- Property tests for net union, junction branching, and stable source mapping.
- Regression fixtures for terminal fan-out and crossing wires that are not junctions.

## Phase 6.3: DC Operating Point

- Replace the baseline dense backend with or supplement it by a reviewed sparse matrix backend before large diagrams are enabled.
- Add conductance/current/voltage stamping abstractions shared by all analyses.
- Implement nonlinear Newton-Raphson iteration with damping, iteration limits, absolute/relative tolerances, and actionable convergence diagnostics.
- Add diode and LED models first; add deliberately scoped BJT/MOSFET models only after diode convergence is stable.
- Calculate node voltages, component currents, power, and digital bridge states.
- Drive wire glow, polarity, direction, and probe readouts from actual solver values.
- Mark successful results stale immediately after an electrically relevant edit.

Acceptance fixtures must cover dividers, bridges, open/floating circuits, shorts, diode bias, LED current limiting, and deliberately difficult convergence cases against independently calculated or published reference values.

## Phase 6.4: Runtime Integration

- Add typed Tauri wrappers for validate, start, cancel, status, and bounded result reads.
- Run simulation on dedicated Rust workers so the UI thread and async runtime remain responsive.
- Use cancellation tokens plus wall-clock, iteration, matrix-size, sample-count, and memory limits.
- Stream progress and result chunks through Tauri channels rather than large JSON responses.
- Use the same Rust crate on desktop and Android; platform code should only provide scheduling and IPC.
- A panic or failed solve must become a diagnostic and must never dirty or corrupt the document.

## Phase 6.5: Transient And DC Sweep

- Add capacitor and inductor companion models.
- Begin with backward Euler for stability, then add trapezoidal integration with oscillation detection and method fallback.
- Add adaptive timesteps with explicit minimum/maximum bounds and rejection limits.
- Add source sweeps and bounded typed-array result buffers.
- Add a plot drawer with synchronized cursors, units, trace visibility, pan/zoom, and CSV/SVG export.
- Downsample only for rendering and retain the bounded source result for inspection/export.

## Phase 6.6: AC Analysis

- Add complex-valued matrix stamping and small-signal component linearization.
- Support logarithmic and linear frequency sweeps.
- Plot magnitude and phase and support transfer-function probes.
- Keep DC, transient, and frequency-domain result types explicit rather than sharing ambiguous arrays.

## Phase 6.7: Mixed-Signal Simulation

- Keep the existing deterministic digital evaluator for digital-only circuits.
- Introduce one Rust-owned mixed-signal scheduler for combined runs.
- Define explicit digital-to-analog output voltage, impedance, rise/fall time, and current limits.
- Define analog-to-digital low/high thresholds, hysteresis, propagation delay, and unknown state.
- Advance analog time to the next digital event or accepted analog timestep; bridges enqueue deterministic events at converged boundaries.
- Detect zero-time oscillation and cap event iterations with a source-mapped diagnostic.
- Reusable digital components compile to the existing digital graph rather than foreign code models.

## Phase 6.8: Offline, Cache, And Collaboration

- Simulation is entirely local and works without a server connection.
- Synchronize `.logic` source, values, probes, and analysis configuration through existing document sessions.
- Treat numerical results as derived local data, not CRDT state.
- Cache results under `.collab/simulations/` using source schema/hash, simulator version, model version, and normalized analysis configuration.
- Do not upload cached results automatically. Explicit exports may create normal vault CSV/SVG/note assets.
- Keep required source/model data in the hosted offline replica.

## Phase 6.9: Numerical Hardening And Release

- Establish published reference fixtures and independently calculated analytic fixtures; optional developer-only comparisons may use external simulators without bundling them.
- Add matrix conditioning estimates, scaling, convergence tracing, and compact user diagnostics.
- Fuzz document compilation and component validation.
- Stress cancellation, singular matrices, extreme scales, repeated runs, zero-time event loops, and bounded output behavior.
- Benchmark representative circuits on desktop and Android and enforce regression budgets.
- Inventory every numerical dependency and retain its required notices in release packaging.
- Publish the supported component equations, model limitations, tolerances, and simulator version in user documentation.

Release gate:

- All supported platforms pass identical numerical fixtures within declared tolerances.
- Offline and online runs are identical for the same source and simulator versions.
- Failed and cancelled runs cannot freeze the UI or alter source documents.
- The UI never describes unsupported models or analyses as SPICE-compatible.

## Recommended Delivery Order

1. Complete the Phase 6.0 linear DC baseline and deterministic API.
2. Land schema v6 and the schematic-to-circuit compiler together.
3. Expose validation and DC operating point as the first user-testable slice.
4. Add nonlinear diode/LED solving before transient analysis.
5. Add runtime cancellation and Android parity before enabling larger jobs.
6. Add transient/DC sweep, then AC analysis.
7. Add mixed-signal scheduling only after both analog and digital boundaries are deterministic.
