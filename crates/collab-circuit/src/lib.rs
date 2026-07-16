//! First-party circuit simulation primitives for Collab.
//!
//! The crate has no UI, platform, filesystem, or network dependencies. Its
//! public model is intentionally independent of the matrix backend so later
//! sparse and transient solvers can reuse the same validated circuit boundary.

mod compiler;
mod dc;
mod model;

pub use compiler::{
    compile_schematic, CompilationError, CompiledCircuit, DiagramMode, SchematicComponentKind,
    SchematicDocument, SchematicElectricalParameters, SchematicNode, SchematicSourceMap,
    SchematicWire, TerminalNet, TerminalRef, WireEndpointRole, WireNet,
};
pub use dc::{solve_dc, DcOperatingPoint, SimulationError};
pub use model::{Circuit, Component, ComponentId, NodeId};
