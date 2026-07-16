# collab-circuit

`collab-circuit` is Collab's first-party, MIT-licensed circuit simulation core.
It intentionally has no Tauri, filesystem, network, or external simulator
dependency so the same deterministic implementation can run on desktop and
Android.

The current Phase 6.0/6.3 implementation provides:

- typed node and component identifiers;
- resistors, capacitors, inductors, resistive switches, independent
  current/voltage sources, built-in diode/LED models, and a deliberately scoped
  forward-active NPN model;
- numeric and identity validation;
- deterministic modified nodal analysis ordering;
- a pivoted dense DC solver with damped Newton-Raphson iteration; and
- node-voltage and component-current operating-point results.
- deterministic schematic terminal/wire net compilation with fan-out;
- source maps from terminals and wires to electrical nodes; and
- a Tauri `circuit_solve_dc` boundary shared by desktop and Android builds.

Capacitors are open circuits and inductors are ideal shorts for DC operating
point analysis. The built-in NPN model includes exponential base-emitter
current and fixed forward gain; it does not model saturation, reverse-active
operation, breakdown, capacitances, Early effect, or temperature variation.
Transient companion models are not yet implemented.

The dense matrix implementation is a small-circuit correctness baseline. The
public circuit and result types are kept independent of that backend so later
sparse, transient, AC, and mixed-signal solvers can replace or extend
it without changing callers.

See `docs/electronic-circuit-simulation-plan.md` for scope and sequencing.
