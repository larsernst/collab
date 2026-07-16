# collab-circuit

`collab-circuit` is Collab's first-party, MIT-licensed circuit simulation core.
It intentionally has no Tauri, filesystem, network, or external simulator
dependency so the same deterministic implementation can run on desktop and
Android.

The current Phase 6.0 baseline provides:

- typed node and component identifiers;
- resistors and independent current/voltage sources;
- numeric and identity validation;
- deterministic modified nodal analysis ordering;
- a pivoted dense linear DC solver; and
- node-voltage and component-current operating-point results.

The dense matrix implementation is a small-circuit correctness baseline. The
public circuit and result types are kept independent of that backend so later
sparse, nonlinear, transient, AC, and mixed-signal solvers can replace or extend
it without changing callers.

See `docs/electronic-circuit-simulation-plan.md` for scope and sequencing.
