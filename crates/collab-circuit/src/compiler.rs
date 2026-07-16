use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{Circuit, Component, ComponentId, NodeId};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagramMode {
    Logic,
    Schematic,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SchematicComponentKind {
    Resistor,
    Capacitor,
    Inductor,
    Diode,
    Led,
    Transistor,
    Switch,
    Ground,
    VoltageSource,
}

impl fmt::Display for SchematicComponentKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Resistor => "resistor",
            Self::Capacitor => "capacitor",
            Self::Inductor => "inductor",
            Self::Diode => "diode",
            Self::Led => "led",
            Self::Transistor => "transistor",
            Self::Switch => "switch",
            Self::Ground => "ground",
            Self::VoltageSource => "voltage-source",
        };
        formatter.write_str(value)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicElectricalParameters {
    pub resistance_ohms: Option<f64>,
    pub capacitance_farads: Option<f64>,
    pub inductance_henries: Option<f64>,
    pub voltage_volts: Option<f64>,
    pub switch_closed: Option<bool>,
    pub model_ref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicNode {
    pub id: String,
    pub kind: SchematicComponentKind,
    #[serde(default)]
    pub rotation: Option<u16>,
    #[serde(default)]
    pub electrical: Option<SchematicElectricalParameters>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicWire {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub source_handle: Option<String>,
    #[serde(default)]
    pub target_handle: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicDocument {
    pub diagram_mode: DiagramMode,
    pub nodes: Vec<SchematicNode>,
    pub wires: Vec<SchematicWire>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRef {
    pub node_id: String,
    pub handle_id: String,
}

impl TerminalRef {
    fn new(node_id: impl Into<String>, handle_id: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
            handle_id: handle_id.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalNet {
    pub terminal: TerminalRef,
    pub electrical_node: NodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireNet {
    pub wire_id: String,
    pub electrical_node: NodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicSourceMap {
    pub terminals: Vec<TerminalNet>,
    pub wires: Vec<WireNet>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledCircuit {
    pub circuit: Circuit,
    pub source_map: SchematicSourceMap,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WireEndpointRole {
    Source,
    Target,
}

impl fmt::Display for WireEndpointRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Source => "source",
            Self::Target => "target",
        })
    }
}

#[derive(Clone, Debug, Error, PartialEq, Serialize)]
#[serde(tag = "code", content = "context", rename_all = "camelCase")]
pub enum CompilationError {
    #[error("only schematic logic documents can be compiled as circuits")]
    NotSchematic,
    #[error("schematic node id '{node_id}' is duplicated")]
    DuplicateNodeId { node_id: String },
    #[error("schematic wire id '{wire_id}' is duplicated")]
    DuplicateWireId { wire_id: String },
    #[error("the schematic needs exactly one ground component")]
    MissingGround,
    #[error("the schematic has {count} ground components; exactly one is required")]
    MultipleGrounds { count: usize },
    #[error("component '{node_id}' ({kind}) is not supported by the current DC compiler")]
    UnsupportedComponent {
        node_id: String,
        kind: SchematicComponentKind,
    },
    #[error("component '{node_id}' references unsupported model '{model_ref}'")]
    UnsupportedModel { node_id: String, model_ref: String },
    #[error("component '{node_id}' is missing its {field} electrical value")]
    MissingElectricalValue {
        node_id: String,
        field: &'static str,
    },
    #[error("wire '{wire_id}' has no {role} terminal handle")]
    MissingWireHandle {
        wire_id: String,
        role: WireEndpointRole,
    },
    #[error("wire '{wire_id}' references unknown {role} node '{node_id}'")]
    UnknownWireNode {
        wire_id: String,
        role: WireEndpointRole,
        node_id: String,
    },
    #[error("wire '{wire_id}' references unknown terminal '{handle_id}' on node '{node_id}'")]
    UnknownTerminal {
        wire_id: String,
        node_id: String,
        handle_id: String,
    },
}

/// Compile a persisted schematic into a deterministic solver circuit.
///
/// Connectivity is derived only from stable terminal handles and wires. Node
/// position and rotation are intentionally ignored.
pub fn compile_schematic(
    document: &SchematicDocument,
) -> Result<CompiledCircuit, CompilationError> {
    if document.diagram_mode != DiagramMode::Schematic {
        return Err(CompilationError::NotSchematic);
    }

    let mut nodes: Vec<_> = document.nodes.iter().collect();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    ensure_unique_node_ids(&nodes)?;

    let grounds = nodes
        .iter()
        .filter(|node| node.kind == SchematicComponentKind::Ground)
        .count();
    match grounds {
        0 => return Err(CompilationError::MissingGround),
        1 => {}
        count => return Err(CompilationError::MultipleGrounds { count }),
    }

    for node in &nodes {
        validate_supported_node(node)?;
    }

    let mut terminals = BTreeSet::new();
    for node in &nodes {
        for handle_id in terminals_for(node.kind) {
            terminals.insert(TerminalRef::new(&node.id, *handle_id));
        }
    }
    let mut nets = DisjointSet::new(terminals.iter().cloned());

    let nodes_by_id: BTreeMap<_, _> = nodes.iter().map(|node| (node.id.as_str(), *node)).collect();
    let mut wires: Vec<_> = document.wires.iter().collect();
    wires.sort_by(|left, right| left.id.cmp(&right.id));
    ensure_unique_wire_ids(&wires)?;

    let mut wire_terminals = Vec::with_capacity(wires.len());
    for wire in &wires {
        let source =
            resolve_wire_terminal(wire, WireEndpointRole::Source, &nodes_by_id, &terminals)?;
        let target =
            resolve_wire_terminal(wire, WireEndpointRole::Target, &nodes_by_id, &terminals)?;
        nets.union(&source, &target);
        wire_terminals.push((wire.id.clone(), source));
    }

    let ground = nodes
        .iter()
        .find(|node| node.kind == SchematicComponentKind::Ground)
        .expect("ground count was validated");
    let ground_terminal = TerminalRef::new(&ground.id, "terminal");
    let reference_root = nets.find(&ground_terminal);

    let mut root_nodes = BTreeMap::new();
    for terminal in &terminals {
        let root = nets.find(terminal);
        root_nodes.entry(root.clone()).or_insert_with(|| {
            if root == reference_root {
                NodeId::new("0")
            } else {
                NodeId::new(electrical_node_id(&root))
            }
        });
    }

    let node_for_terminal = |nets: &mut DisjointSet, terminal: &TerminalRef| {
        let root = nets.find(terminal);
        root_nodes[&root].clone()
    };

    let mut components = Vec::new();
    for node in &nodes {
        let component = match node.kind {
            SchematicComponentKind::Resistor => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                Component::Resistor {
                    id: ComponentId::new(&node.id),
                    positive: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-a"),
                    ),
                    negative: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-b"),
                    ),
                    resistance_ohms: electrical.resistance_ohms.expect("validated resistance"),
                }
            }
            SchematicComponentKind::Capacitor => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                Component::Capacitor {
                    id: ComponentId::new(&node.id),
                    positive: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-a"),
                    ),
                    negative: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-b"),
                    ),
                    capacitance_farads: electrical
                        .capacitance_farads
                        .expect("validated capacitance"),
                }
            }
            SchematicComponentKind::Inductor => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                Component::Inductor {
                    id: ComponentId::new(&node.id),
                    positive: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-a"),
                    ),
                    negative: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-b"),
                    ),
                    inductance_henries: electrical
                        .inductance_henries
                        .expect("validated inductance"),
                }
            }
            SchematicComponentKind::Switch => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                Component::Switch {
                    id: ComponentId::new(&node.id),
                    positive: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-a"),
                    ),
                    negative: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "terminal-b"),
                    ),
                    closed: electrical.switch_closed.expect("validated switch state"),
                    closed_resistance_ohms: 1.0e-3,
                    open_resistance_ohms: 1.0e12,
                }
            }
            SchematicComponentKind::Diode | SchematicComponentKind::Led => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                let model_ref = electrical.model_ref.as_deref().expect("validated model");
                let (saturation_current_amps, emission_coefficient) = match model_ref {
                    "builtin:diode" => (1.0e-12, 1.0),
                    "builtin:led" => (1.0e-18, 2.0),
                    _ => unreachable!("supported model references were validated"),
                };
                Component::Diode {
                    id: ComponentId::new(&node.id),
                    anode: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "anode")),
                    cathode: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "cathode")),
                    saturation_current_amps,
                    emission_coefficient,
                    thermal_voltage_volts: 0.025_852,
                }
            }
            SchematicComponentKind::Transistor => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                debug_assert_eq!(electrical.model_ref.as_deref(), Some("builtin:npn"));
                Component::BipolarNpn {
                    id: ComponentId::new(&node.id),
                    base: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "base")),
                    collector: node_for_terminal(
                        &mut nets,
                        &TerminalRef::new(&node.id, "collector"),
                    ),
                    emitter: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "emitter")),
                    saturation_current_amps: 1.0e-15,
                    forward_beta: 100.0,
                    emission_coefficient: 1.0,
                    thermal_voltage_volts: 0.025_852,
                }
            }
            SchematicComponentKind::VoltageSource => {
                let electrical = node
                    .electrical
                    .as_ref()
                    .expect("validated electrical values");
                Component::VoltageSource {
                    id: ComponentId::new(&node.id),
                    positive: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "positive")),
                    negative: node_for_terminal(&mut nets, &TerminalRef::new(&node.id, "negative")),
                    voltage_volts: electrical.voltage_volts.expect("validated voltage"),
                }
            }
            SchematicComponentKind::Ground => continue,
        };
        components.push(component);
    }

    let terminal_nets = terminals
        .iter()
        .map(|terminal| TerminalNet {
            terminal: terminal.clone(),
            electrical_node: node_for_terminal(&mut nets, terminal),
        })
        .collect();
    let wire_nets = wire_terminals
        .into_iter()
        .map(|(wire_id, terminal)| WireNet {
            wire_id,
            electrical_node: node_for_terminal(&mut nets, &terminal),
        })
        .collect();

    Ok(CompiledCircuit {
        circuit: Circuit {
            reference: NodeId::new("0"),
            components,
        },
        source_map: SchematicSourceMap {
            terminals: terminal_nets,
            wires: wire_nets,
        },
    })
}

fn ensure_unique_node_ids(nodes: &[&SchematicNode]) -> Result<(), CompilationError> {
    for pair in nodes.windows(2) {
        if pair[0].id == pair[1].id {
            return Err(CompilationError::DuplicateNodeId {
                node_id: pair[0].id.clone(),
            });
        }
    }
    Ok(())
}

fn ensure_unique_wire_ids(wires: &[&SchematicWire]) -> Result<(), CompilationError> {
    for pair in wires.windows(2) {
        if pair[0].id == pair[1].id {
            return Err(CompilationError::DuplicateWireId {
                wire_id: pair[0].id.clone(),
            });
        }
    }
    Ok(())
}

fn validate_supported_node(node: &SchematicNode) -> Result<(), CompilationError> {
    match node.kind {
        SchematicComponentKind::Ground => Ok(()),
        SchematicComponentKind::Resistor => require_value(node, "resistanceOhms", |value| {
            value.resistance_ohms.is_some()
        }),
        SchematicComponentKind::Capacitor => require_value(node, "capacitanceFarads", |value| {
            value.capacitance_farads.is_some()
        }),
        SchematicComponentKind::Inductor => require_value(node, "inductanceHenries", |value| {
            value.inductance_henries.is_some()
        }),
        SchematicComponentKind::Switch => {
            require_value(node, "switchClosed", |value| value.switch_closed.is_some())
        }
        SchematicComponentKind::VoltageSource => {
            require_value(node, "voltageVolts", |value| value.voltage_volts.is_some())
        }
        SchematicComponentKind::Diode
        | SchematicComponentKind::Led
        | SchematicComponentKind::Transistor => {
            let model_ref = node
                .electrical
                .as_ref()
                .and_then(|value| value.model_ref.as_deref())
                .ok_or_else(|| CompilationError::MissingElectricalValue {
                    node_id: node.id.clone(),
                    field: "modelRef",
                })?;
            let expected = match node.kind {
                SchematicComponentKind::Diode => "builtin:diode",
                SchematicComponentKind::Led => "builtin:led",
                SchematicComponentKind::Transistor => "builtin:npn",
                _ => unreachable!(),
            };
            if model_ref == expected {
                Ok(())
            } else {
                Err(CompilationError::UnsupportedModel {
                    node_id: node.id.clone(),
                    model_ref: model_ref.to_string(),
                })
            }
        }
    }
}

fn require_value(
    node: &SchematicNode,
    field: &'static str,
    is_present: impl FnOnce(&SchematicElectricalParameters) -> bool,
) -> Result<(), CompilationError> {
    if node.electrical.as_ref().is_some_and(is_present) {
        Ok(())
    } else {
        Err(CompilationError::MissingElectricalValue {
            node_id: node.id.clone(),
            field,
        })
    }
}

fn terminals_for(kind: SchematicComponentKind) -> &'static [&'static str] {
    match kind {
        SchematicComponentKind::Resistor
        | SchematicComponentKind::Capacitor
        | SchematicComponentKind::Inductor
        | SchematicComponentKind::Switch => &["terminal-a", "terminal-b"],
        SchematicComponentKind::Diode | SchematicComponentKind::Led => &["anode", "cathode"],
        SchematicComponentKind::Transistor => &["base", "collector", "emitter"],
        SchematicComponentKind::Ground => &["terminal"],
        SchematicComponentKind::VoltageSource => &["negative", "positive"],
    }
}

fn resolve_wire_terminal(
    wire: &SchematicWire,
    role: WireEndpointRole,
    nodes: &BTreeMap<&str, &SchematicNode>,
    terminals: &BTreeSet<TerminalRef>,
) -> Result<TerminalRef, CompilationError> {
    let (node_id, handle_id) = match role {
        WireEndpointRole::Source => (&wire.source, wire.source_handle.as_ref()),
        WireEndpointRole::Target => (&wire.target, wire.target_handle.as_ref()),
    };
    if !nodes.contains_key(node_id.as_str()) {
        return Err(CompilationError::UnknownWireNode {
            wire_id: wire.id.clone(),
            role,
            node_id: node_id.clone(),
        });
    }
    let handle_id = handle_id.ok_or_else(|| CompilationError::MissingWireHandle {
        wire_id: wire.id.clone(),
        role,
    })?;
    let terminal = TerminalRef::new(node_id, handle_id);
    if !terminals.contains(&terminal) {
        return Err(CompilationError::UnknownTerminal {
            wire_id: wire.id.clone(),
            node_id: node_id.clone(),
            handle_id: handle_id.clone(),
        });
    }
    Ok(terminal)
}

fn electrical_node_id(root: &TerminalRef) -> String {
    format!(
        "net:{}:{}:{}",
        root.node_id.len(),
        root.node_id,
        root.handle_id
    )
}

struct DisjointSet {
    parents: BTreeMap<TerminalRef, TerminalRef>,
}

impl DisjointSet {
    fn new(items: impl IntoIterator<Item = TerminalRef>) -> Self {
        Self {
            parents: items.into_iter().map(|item| (item.clone(), item)).collect(),
        }
    }

    fn find(&mut self, item: &TerminalRef) -> TerminalRef {
        let parent = self.parents[item].clone();
        if parent == *item {
            return parent;
        }
        let root = self.find(&parent);
        self.parents.insert(item.clone(), root.clone());
        root
    }

    fn union(&mut self, left: &TerminalRef, right: &TerminalRef) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root == right_root {
            return;
        }
        let (root, child) = if left_root < right_root {
            (left_root, right_root)
        } else {
            (right_root, left_root)
        };
        self.parents.insert(child, root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solve_dc;

    fn electrical(
        resistance_ohms: Option<f64>,
        voltage_volts: Option<f64>,
    ) -> SchematicElectricalParameters {
        SchematicElectricalParameters {
            resistance_ohms,
            voltage_volts,
            ..Default::default()
        }
    }

    fn node(
        id: &str,
        kind: SchematicComponentKind,
        electrical: Option<SchematicElectricalParameters>,
    ) -> SchematicNode {
        SchematicNode {
            id: id.to_string(),
            kind,
            rotation: None,
            electrical,
        }
    }

    fn wire(
        id: &str,
        source: &str,
        source_handle: &str,
        target: &str,
        target_handle: &str,
    ) -> SchematicWire {
        SchematicWire {
            id: id.to_string(),
            source: source.to_string(),
            target: target.to_string(),
            source_handle: Some(source_handle.to_string()),
            target_handle: Some(target_handle.to_string()),
        }
    }

    fn divider() -> SchematicDocument {
        SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node(
                    "source",
                    SchematicComponentKind::VoltageSource,
                    Some(electrical(None, Some(10.0))),
                ),
                node(
                    "r1",
                    SchematicComponentKind::Resistor,
                    Some(electrical(Some(1_000.0), None)),
                ),
                node(
                    "r2",
                    SchematicComponentKind::Resistor,
                    Some(electrical(Some(1_000.0), None)),
                ),
                node("ground", SchematicComponentKind::Ground, None),
            ],
            wires: vec![
                wire("w1", "source", "positive", "r1", "terminal-a"),
                wire("w2", "r1", "terminal-b", "r2", "terminal-a"),
                wire("w3", "r2", "terminal-b", "ground", "terminal"),
                wire("w4", "source", "negative", "ground", "terminal"),
            ],
        }
    }

    #[test]
    fn compiles_and_solves_a_voltage_divider() {
        let compiled = compile_schematic(&divider()).unwrap();
        let operating_point = solve_dc(&compiled.circuit).unwrap();
        let output_terminal = compiled
            .source_map
            .terminals
            .iter()
            .find(|mapping| mapping.terminal == TerminalRef::new("r2", "terminal-a"))
            .unwrap();

        assert_eq!(
            operating_point.node_voltages[&output_terminal.electrical_node],
            5.0
        );
        assert_eq!(compiled.source_map.wires.len(), 4);
    }

    #[test]
    fn shared_terminals_support_wire_fan_out() {
        let document = SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node(
                    "source",
                    SchematicComponentKind::VoltageSource,
                    Some(electrical(None, Some(5.0))),
                ),
                node(
                    "r1",
                    SchematicComponentKind::Resistor,
                    Some(electrical(Some(1_000.0), None)),
                ),
                node(
                    "r2",
                    SchematicComponentKind::Resistor,
                    Some(electrical(Some(2_000.0), None)),
                ),
                node("ground", SchematicComponentKind::Ground, None),
            ],
            wires: vec![
                wire("positive-r1", "source", "positive", "r1", "terminal-a"),
                wire("positive-r2", "source", "positive", "r2", "terminal-a"),
                wire(
                    "negative-ground",
                    "source",
                    "negative",
                    "ground",
                    "terminal",
                ),
                wire("r1-ground", "r1", "terminal-b", "ground", "terminal"),
                wire("r2-ground", "r2", "terminal-b", "ground", "terminal"),
            ],
        };

        let compiled = compile_schematic(&document).unwrap();
        let result = solve_dc(&compiled.circuit).unwrap();
        assert_eq!(result.component_currents[&ComponentId::new("r1")], 0.005);
        assert_eq!(result.component_currents[&ComponentId::new("r2")], 0.0025);

        let positive_wire_nodes: BTreeSet<_> = compiled
            .source_map
            .wires
            .iter()
            .filter(|mapping| mapping.wire_id.starts_with("positive"))
            .map(|mapping| mapping.electrical_node.clone())
            .collect();
        assert_eq!(positive_wire_nodes.len(), 1);
    }

    #[test]
    fn compilation_is_independent_of_order_and_rotation() {
        let first = divider();
        let mut second = first.clone();
        second.nodes.reverse();
        second.wires.reverse();
        for node in &mut second.nodes {
            node.rotation = Some(270);
        }

        assert_eq!(compile_schematic(&first), compile_schematic(&second));
    }

    #[test]
    fn reports_missing_values_and_invalid_wire_handles() {
        let missing_value = SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node("r1", SchematicComponentKind::Resistor, None),
                node("ground", SchematicComponentKind::Ground, None),
            ],
            wires: vec![],
        };
        assert_eq!(
            compile_schematic(&missing_value),
            Err(CompilationError::MissingElectricalValue {
                node_id: "r1".to_string(),
                field: "resistanceOhms",
            })
        );

        let mut invalid_wire = divider();
        invalid_wire.wires[0].source_handle = Some("not-a-terminal".to_string());
        assert!(matches!(
            compile_schematic(&invalid_wire),
            Err(CompilationError::UnknownTerminal { .. })
        ));
    }

    #[test]
    fn compiles_supported_reactive_switch_and_diode_components() {
        let document = SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node(
                    "c1",
                    SchematicComponentKind::Capacitor,
                    Some(SchematicElectricalParameters {
                        capacitance_farads: Some(1e-6),
                        ..Default::default()
                    }),
                ),
                node(
                    "l1",
                    SchematicComponentKind::Inductor,
                    Some(SchematicElectricalParameters {
                        inductance_henries: Some(1e-3),
                        ..Default::default()
                    }),
                ),
                node(
                    "s1",
                    SchematicComponentKind::Switch,
                    Some(SchematicElectricalParameters {
                        switch_closed: Some(true),
                        ..Default::default()
                    }),
                ),
                node(
                    "d1",
                    SchematicComponentKind::Diode,
                    Some(SchematicElectricalParameters {
                        model_ref: Some("builtin:diode".to_string()),
                        ..Default::default()
                    }),
                ),
                node(
                    "led1",
                    SchematicComponentKind::Led,
                    Some(SchematicElectricalParameters {
                        model_ref: Some("builtin:led".to_string()),
                        ..Default::default()
                    }),
                ),
                node(
                    "q1",
                    SchematicComponentKind::Transistor,
                    Some(SchematicElectricalParameters {
                        model_ref: Some("builtin:npn".to_string()),
                        ..Default::default()
                    }),
                ),
                node("ground", SchematicComponentKind::Ground, None),
            ],
            wires: vec![],
        };

        let compiled = compile_schematic(&document).unwrap();
        assert!(matches!(
            compiled.circuit.components[0],
            Component::Capacitor { .. }
        ));
        assert!(matches!(
            compiled.circuit.components[1],
            Component::Diode { .. }
        ));
        assert!(matches!(
            compiled.circuit.components[2],
            Component::Inductor { .. }
        ));
        assert!(matches!(
            compiled.circuit.components[3],
            Component::Diode { .. }
        ));
        assert!(matches!(
            compiled.circuit.components[4],
            Component::BipolarNpn { .. }
        ));
        assert!(matches!(
            compiled.circuit.components[5],
            Component::Switch { .. }
        ));
    }

    #[test]
    fn rejects_unsupported_models_and_multiple_grounds() {
        let unsupported_model = SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node(
                    "q1",
                    SchematicComponentKind::Transistor,
                    Some(SchematicElectricalParameters {
                        model_ref: Some("custom:npn".to_string()),
                        ..Default::default()
                    }),
                ),
                node("ground", SchematicComponentKind::Ground, None),
            ],
            wires: vec![],
        };
        assert!(matches!(
            compile_schematic(&unsupported_model),
            Err(CompilationError::UnsupportedModel { .. })
        ));

        let multiple_grounds = SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                node("ground-a", SchematicComponentKind::Ground, None),
                node("ground-b", SchematicComponentKind::Ground, None),
            ],
            wires: vec![],
        };
        assert_eq!(
            compile_schematic(&multiple_grounds),
            Err(CompilationError::MultipleGrounds { count: 2 })
        );
    }
}
