use std::fmt;

use serde::{Deserialize, Serialize};

/// Stable electrical node identity. Visual position and component rotation do
/// not affect this value.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

/// Stable component identity used to map results back to a `.logic` document.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ComponentId(pub String);

impl ComponentId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl fmt::Display for ComponentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Component {
    Resistor {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        resistance_ohms: f64,
    },
    /// Conventional current flows from `positive` to `negative`.
    CurrentSource {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        current_amps: f64,
    },
    VoltageSource {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        voltage_volts: f64,
    },
}

impl Component {
    pub fn id(&self) -> &ComponentId {
        match self {
            Self::Resistor { id, .. }
            | Self::CurrentSource { id, .. }
            | Self::VoltageSource { id, .. } => id,
        }
    }

    pub(crate) fn nodes(&self) -> (&NodeId, &NodeId) {
        match self {
            Self::Resistor {
                positive, negative, ..
            }
            | Self::CurrentSource {
                positive, negative, ..
            }
            | Self::VoltageSource {
                positive, negative, ..
            } => (positive, negative),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Circuit {
    pub reference: NodeId,
    pub components: Vec<Component>,
}
