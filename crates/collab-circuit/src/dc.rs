use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{Circuit, Component, ComponentId, NodeId};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcOperatingPoint {
    pub node_voltages: BTreeMap<NodeId, f64>,
    /// Conventional current from each component's positive terminal to its
    /// negative terminal.
    pub component_currents: BTreeMap<ComponentId, f64>,
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum SimulationError {
    #[error("the circuit reference node is empty")]
    EmptyReference,
    #[error("component id '{0}' is empty")]
    EmptyComponentId(ComponentId),
    #[error("component id '{0}' is duplicated")]
    DuplicateComponentId(ComponentId),
    #[error("component '{component}' uses an empty node id")]
    EmptyNodeId { component: ComponentId },
    #[error("component '{component}' has a non-finite {field}")]
    NonFiniteValue {
        component: ComponentId,
        field: &'static str,
    },
    #[error("resistor '{component}' must have resistance greater than zero")]
    InvalidResistance { component: ComponentId },
    #[error("the DC system is singular or underconstrained near unknown {index}")]
    SingularSystem { index: usize },
}

/// Solve the linear DC operating point using modified nodal analysis.
///
/// This baseline uses a pivoted dense matrix. The circuit and result boundary
/// is backend-independent so a sparse solver can replace it without changing
/// callers.
pub fn solve_dc(circuit: &Circuit) -> Result<DcOperatingPoint, SimulationError> {
    validate(circuit)?;

    let mut components: Vec<_> = circuit.components.iter().collect();
    components.sort_by(|left, right| left.id().cmp(right.id()));

    let mut nodes = BTreeSet::new();
    for component in &components {
        let (positive, negative) = component.nodes();
        if positive != &circuit.reference {
            nodes.insert(positive.clone());
        }
        if negative != &circuit.reference {
            nodes.insert(negative.clone());
        }
    }
    let nodes: Vec<_> = nodes.into_iter().collect();
    let node_indices: BTreeMap<_, _> = nodes
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, node)| (node, index))
        .collect();

    let mut voltage_sources: Vec<_> = circuit
        .components
        .iter()
        .filter_map(|component| match component {
            Component::VoltageSource { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect();
    voltage_sources.sort();
    let source_indices: BTreeMap<_, _> = voltage_sources
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, id)| (id, nodes.len() + index))
        .collect();

    let unknown_count = nodes.len() + voltage_sources.len();
    let mut matrix = vec![vec![0.0; unknown_count]; unknown_count];
    let mut rhs = vec![0.0; unknown_count];

    for component in &components {
        match component {
            Component::Resistor {
                positive,
                negative,
                resistance_ohms,
                ..
            } => {
                let conductance = 1.0 / resistance_ohms;
                stamp_conductance(
                    &mut matrix,
                    node_indices.get(positive).copied(),
                    node_indices.get(negative).copied(),
                    conductance,
                );
            }
            Component::CurrentSource {
                positive,
                negative,
                current_amps,
                ..
            } => {
                if let Some(index) = node_indices.get(positive) {
                    rhs[*index] -= current_amps;
                }
                if let Some(index) = node_indices.get(negative) {
                    rhs[*index] += current_amps;
                }
            }
            Component::VoltageSource {
                id,
                positive,
                negative,
                voltage_volts,
            } => {
                let source_index = source_indices[id];
                stamp_voltage_source(
                    &mut matrix,
                    &mut rhs,
                    node_indices.get(positive).copied(),
                    node_indices.get(negative).copied(),
                    source_index,
                    *voltage_volts,
                );
            }
        }
    }

    let solution = if unknown_count == 0 {
        Vec::new()
    } else {
        solve_linear_system(matrix, rhs)?
    };

    let mut node_voltages = BTreeMap::from([(circuit.reference.clone(), 0.0)]);
    for (node, index) in &node_indices {
        node_voltages.insert(node.clone(), solution[*index]);
    }

    let voltage_at = |node: &NodeId| node_voltages.get(node).copied().unwrap_or(0.0);
    let mut component_currents = BTreeMap::new();
    for component in &components {
        let current = match component {
            Component::Resistor {
                positive,
                negative,
                resistance_ohms,
                ..
            } => (voltage_at(positive) - voltage_at(negative)) / resistance_ohms,
            Component::CurrentSource { current_amps, .. } => *current_amps,
            Component::VoltageSource { id, .. } => solution[source_indices[id]],
        };
        component_currents.insert(component.id().clone(), current);
    }

    Ok(DcOperatingPoint {
        node_voltages,
        component_currents,
    })
}

fn validate(circuit: &Circuit) -> Result<(), SimulationError> {
    if circuit.reference.0.is_empty() {
        return Err(SimulationError::EmptyReference);
    }

    let mut component_ids = BTreeSet::new();
    for component in &circuit.components {
        let id = component.id();
        if id.0.is_empty() {
            return Err(SimulationError::EmptyComponentId(id.clone()));
        }
        if !component_ids.insert(id.clone()) {
            return Err(SimulationError::DuplicateComponentId(id.clone()));
        }
        let (positive, negative) = component.nodes();
        if positive.0.is_empty() || negative.0.is_empty() {
            return Err(SimulationError::EmptyNodeId {
                component: id.clone(),
            });
        }
        match component {
            Component::Resistor {
                resistance_ohms, ..
            } => {
                ensure_finite(id, "resistance", *resistance_ohms)?;
                if *resistance_ohms <= 0.0 {
                    return Err(SimulationError::InvalidResistance {
                        component: id.clone(),
                    });
                }
            }
            Component::CurrentSource { current_amps, .. } => {
                ensure_finite(id, "current", *current_amps)?;
            }
            Component::VoltageSource { voltage_volts, .. } => {
                ensure_finite(id, "voltage", *voltage_volts)?;
            }
        }
    }
    Ok(())
}

fn ensure_finite(
    component: &ComponentId,
    field: &'static str,
    value: f64,
) -> Result<(), SimulationError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(SimulationError::NonFiniteValue {
            component: component.clone(),
            field,
        })
    }
}

fn stamp_conductance(
    matrix: &mut [Vec<f64>],
    positive: Option<usize>,
    negative: Option<usize>,
    conductance: f64,
) {
    if let Some(index) = positive {
        matrix[index][index] += conductance;
    }
    if let Some(index) = negative {
        matrix[index][index] += conductance;
    }
    if let (Some(positive), Some(negative)) = (positive, negative) {
        matrix[positive][negative] -= conductance;
        matrix[negative][positive] -= conductance;
    }
}

fn stamp_voltage_source(
    matrix: &mut [Vec<f64>],
    rhs: &mut [f64],
    positive: Option<usize>,
    negative: Option<usize>,
    source_index: usize,
    voltage: f64,
) {
    if let Some(index) = positive {
        matrix[index][source_index] += 1.0;
        matrix[source_index][index] += 1.0;
    }
    if let Some(index) = negative {
        matrix[index][source_index] -= 1.0;
        matrix[source_index][index] -= 1.0;
    }
    rhs[source_index] += voltage;
}

fn solve_linear_system(
    mut matrix: Vec<Vec<f64>>,
    mut rhs: Vec<f64>,
) -> Result<Vec<f64>, SimulationError> {
    let size = rhs.len();
    for column in 0..size {
        let pivot = (column..size)
            .max_by(|left, right| {
                matrix[*left][column]
                    .abs()
                    .total_cmp(&matrix[*right][column].abs())
            })
            .expect("a non-empty pivot range");
        if matrix[pivot][column] == 0.0 || !matrix[pivot][column].is_finite() {
            return Err(SimulationError::SingularSystem { index: column });
        }
        matrix.swap(column, pivot);
        rhs.swap(column, pivot);

        for row in (column + 1)..size {
            let factor = matrix[row][column] / matrix[column][column];
            matrix[row][column] = 0.0;
            for next_column in (column + 1)..size {
                matrix[row][next_column] -= factor * matrix[column][next_column];
            }
            rhs[row] -= factor * rhs[column];
        }
    }

    let mut solution = vec![0.0; size];
    for row in (0..size).rev() {
        let remainder: f64 = ((row + 1)..size)
            .map(|column| matrix[row][column] * solution[column])
            .sum();
        solution[row] = (rhs[row] - remainder) / matrix[row][row];
    }
    Ok(solution)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str) -> NodeId {
        NodeId::new(id)
    }

    fn component(id: &str) -> ComponentId {
        ComponentId::new(id)
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1.0e-9, "{actual} != {expected}");
    }

    #[test]
    fn solves_a_voltage_divider_and_branch_currents() {
        let circuit = Circuit {
            reference: node("0"),
            components: vec![
                Component::VoltageSource {
                    id: component("V1"),
                    positive: node("vin"),
                    negative: node("0"),
                    voltage_volts: 10.0,
                },
                Component::Resistor {
                    id: component("R1"),
                    positive: node("vin"),
                    negative: node("vout"),
                    resistance_ohms: 1_000.0,
                },
                Component::Resistor {
                    id: component("R2"),
                    positive: node("vout"),
                    negative: node("0"),
                    resistance_ohms: 1_000.0,
                },
            ],
        };

        let result = solve_dc(&circuit).unwrap();
        assert_close(result.node_voltages[&node("vin")], 10.0);
        assert_close(result.node_voltages[&node("vout")], 5.0);
        assert_close(result.component_currents[&component("R1")], 0.005);
        assert_close(result.component_currents[&component("R2")], 0.005);
        assert_close(result.component_currents[&component("V1")], -0.005);
    }

    #[test]
    fn solves_a_current_source() {
        let circuit = Circuit {
            reference: node("ground"),
            components: vec![
                Component::CurrentSource {
                    id: component("I1"),
                    positive: node("ground"),
                    negative: node("out"),
                    current_amps: 0.002,
                },
                Component::Resistor {
                    id: component("R1"),
                    positive: node("out"),
                    negative: node("ground"),
                    resistance_ohms: 2_000.0,
                },
            ],
        };

        let result = solve_dc(&circuit).unwrap();
        assert_close(result.node_voltages[&node("out")], 4.0);
        assert_close(result.component_currents[&component("I1")], 0.002);
        assert_close(result.component_currents[&component("R1")], 0.002);
    }

    #[test]
    fn results_are_stable_when_components_are_reordered() {
        let components = vec![
            Component::VoltageSource {
                id: component("source"),
                positive: node("z"),
                negative: node("0"),
                voltage_volts: 6.0,
            },
            Component::Resistor {
                id: component("first"),
                positive: node("z"),
                negative: node("a"),
                resistance_ohms: 2_000.0,
            },
            Component::Resistor {
                id: component("second"),
                positive: node("a"),
                negative: node("0"),
                resistance_ohms: 1_000.0,
            },
        ];
        let mut reversed = components.clone();
        reversed.reverse();

        let first = solve_dc(&Circuit {
            reference: node("0"),
            components,
        })
        .unwrap();
        let second = solve_dc(&Circuit {
            reference: node("0"),
            components: reversed,
        })
        .unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn rejects_duplicate_and_invalid_components() {
        let duplicate = Circuit {
            reference: node("0"),
            components: vec![
                Component::Resistor {
                    id: component("R1"),
                    positive: node("a"),
                    negative: node("0"),
                    resistance_ohms: 100.0,
                },
                Component::CurrentSource {
                    id: component("R1"),
                    positive: node("0"),
                    negative: node("a"),
                    current_amps: 1.0,
                },
            ],
        };
        assert_eq!(
            solve_dc(&duplicate),
            Err(SimulationError::DuplicateComponentId(component("R1")))
        );

        let invalid = Circuit {
            reference: node("0"),
            components: vec![Component::Resistor {
                id: component("R1"),
                positive: node("a"),
                negative: node("0"),
                resistance_ohms: 0.0,
            }],
        };
        assert_eq!(
            solve_dc(&invalid),
            Err(SimulationError::InvalidResistance {
                component: component("R1")
            })
        );
    }

    #[test]
    fn reports_a_floating_system() {
        let circuit = Circuit {
            reference: node("0"),
            components: vec![Component::Resistor {
                id: component("R1"),
                positive: node("a"),
                negative: node("b"),
                resistance_ohms: 100.0,
            }],
        };

        assert!(matches!(
            solve_dc(&circuit),
            Err(SimulationError::SingularSystem { .. })
        ));
    }

    #[test]
    fn does_not_treat_a_high_resistance_as_a_singular_circuit() {
        let circuit = Circuit {
            reference: node("0"),
            components: vec![
                Component::VoltageSource {
                    id: component("V1"),
                    positive: node("out"),
                    negative: node("0"),
                    voltage_volts: 1.0,
                },
                Component::Resistor {
                    id: component("R1"),
                    positive: node("out"),
                    negative: node("0"),
                    resistance_ohms: 1.0e15,
                },
            ],
        };

        let result = solve_dc(&circuit).unwrap();
        assert_close(result.node_voltages[&node("out")], 1.0);
        assert_close(result.component_currents[&component("R1")], 1.0e-15);
    }
}
