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
    Capacitor {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        capacitance_farads: f64,
    },
    Inductor {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        inductance_henries: f64,
    },
    Switch {
        id: ComponentId,
        positive: NodeId,
        negative: NodeId,
        closed: bool,
        closed_resistance_ohms: f64,
        open_resistance_ohms: f64,
    },
    Diode {
        id: ComponentId,
        anode: NodeId,
        cathode: NodeId,
        saturation_current_amps: f64,
        emission_coefficient: f64,
        thermal_voltage_volts: f64,
    },
    BipolarNpn {
        id: ComponentId,
        base: NodeId,
        collector: NodeId,
        emitter: NodeId,
        saturation_current_amps: f64,
        forward_beta: f64,
        emission_coefficient: f64,
        thermal_voltage_volts: f64,
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
            | Self::Capacitor { id, .. }
            | Self::Inductor { id, .. }
            | Self::Switch { id, .. }
            | Self::Diode { id, .. }
            | Self::BipolarNpn { id, .. }
            | Self::CurrentSource { id, .. }
            | Self::VoltageSource { id, .. } => id,
        }
    }

    pub(crate) fn nodes(&self) -> Vec<&NodeId> {
        match self {
            Self::Resistor {
                positive, negative, ..
            }
            | Self::Capacitor {
                positive, negative, ..
            }
            | Self::Inductor {
                positive, negative, ..
            }
            | Self::Switch {
                positive, negative, ..
            }
            | Self::CurrentSource {
                positive, negative, ..
            }
            | Self::VoltageSource {
                positive, negative, ..
            } => vec![positive, negative],
            Self::Diode { anode, cathode, .. } => vec![anode, cathode],
            Self::BipolarNpn {
                base,
                collector,
                emitter,
                ..
            } => vec![base, collector, emitter],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Circuit {
    pub reference: NodeId,
    pub components: Vec<Component>,
}
