//! First-party circuit simulation primitives for Collab.
//!
//! The crate has no UI, platform, filesystem, or network dependencies. Its
//! public model is intentionally independent of the matrix backend so later
//! sparse and transient solvers can reuse the same validated circuit boundary.

mod dc;
mod model;

pub use dc::{solve_dc, DcOperatingPoint, SimulationError};
pub use model::{Circuit, Component, ComponentId, NodeId};
