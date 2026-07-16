use collab_circuit::{
    compile_schematic, solve_dc, CompilationError, DcOperatingPoint, ProbeTarget,
    SchematicDocument, SchematicSourceMap, SimulationError,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CircuitDcResult {
    pub operating_point: DcOperatingPoint,
    pub source_map: SchematicSourceMap,
    pub probe_values: Vec<CircuitProbeValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CircuitProbeValue {
    NodeVoltage {
        probe_id: String,
        label: Option<String>,
        value_volts: f64,
    },
    BranchCurrent {
        probe_id: String,
        label: Option<String>,
        value_amps: f64,
    },
}

#[derive(Clone, Debug, Error, PartialEq, Serialize)]
#[serde(tag = "stage", content = "detail", rename_all = "camelCase")]
pub enum CircuitCommandError {
    #[error(transparent)]
    Compilation(#[from] CompilationError),
    #[error(transparent)]
    Simulation(#[from] SimulationError),
}

/// Compile and solve a bounded DC schematic using the shared first-party
/// simulation crate. The command is synchronous for the current small-circuit
/// baseline; larger analyses will use cancellable workers.
#[tauri::command]
pub fn circuit_solve_dc(
    document: SchematicDocument,
) -> Result<CircuitDcResult, CircuitCommandError> {
    let compiled = compile_schematic(&document)?;
    let operating_point = solve_dc(&compiled.circuit)?;
    let probe_values = compiled
        .source_map
        .probes
        .iter()
        .map(|probe| match &probe.target {
            ProbeTarget::NodeVoltage { electrical_node } => CircuitProbeValue::NodeVoltage {
                probe_id: probe.probe_id.clone(),
                label: probe.label.clone(),
                value_volts: operating_point.node_voltages[electrical_node],
            },
            ProbeTarget::BranchCurrent { component } => CircuitProbeValue::BranchCurrent {
                probe_id: probe.probe_id.clone(),
                label: probe.label.clone(),
                value_amps: operating_point.component_currents[component],
            },
        })
        .collect();
    Ok(CircuitDcResult {
        operating_point,
        source_map: compiled.source_map,
        probe_values,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use collab_circuit::{
        ComponentId, DcDiagnostic, DiagramMode, SchematicComponentKind,
        SchematicElectricalParameters, SchematicNode, SchematicProbe, SchematicProbeKind,
        SchematicSimulationConfig, SchematicWire,
    };

    #[test]
    fn command_result_and_errors_have_stable_typed_json_shapes() {
        let result = circuit_solve_dc(SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![SchematicNode {
                id: "ground".to_string(),
                kind: SchematicComponentKind::Ground,
                rotation: Some(90),
                electrical: None,
            }],
            wires: Vec::<SchematicWire>::new(),
            simulation: None,
        })
        .unwrap();
        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["operatingPoint"]["nodeVoltages"]["0"], 0.0);
        assert_eq!(
            serialized["operatingPoint"]["componentPowers"],
            serde_json::json!({})
        );
        assert_eq!(
            serialized["operatingPoint"]["diagnostics"],
            serde_json::json!([])
        );
        assert_eq!(serialized["probeValues"], serde_json::json!([]));
        assert_eq!(serialized["operatingPoint"]["iterations"], 1);
        assert_eq!(
            serialized["sourceMap"]["terminals"][0]["terminal"]["handleId"],
            "terminal"
        );

        let error = CircuitCommandError::Compilation(CompilationError::MissingGround);
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["stage"], "compilation");
        assert_eq!(serialized["detail"]["code"], "missingGround");

        let diagnostic = serde_json::to_value(DcDiagnostic::NpnOutsideForwardActive {
            component: ComponentId::new("q1"),
            base_emitter_voltage: 0.7,
            collector_emitter_voltage: 0.2,
        })
        .unwrap();
        assert_eq!(diagnostic["context"]["baseEmitterVoltage"], 0.7);
        assert_eq!(diagnostic["context"]["collectorEmitterVoltage"], 0.2);

        let error = CircuitCommandError::Compilation(CompilationError::UnknownProbeNode {
            probe_id: "p1".to_string(),
            node_id: "removed".to_string(),
        });
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["detail"]["context"]["probeId"], "p1");
        assert_eq!(serialized["detail"]["context"]["nodeId"], "removed");

        let error = CircuitCommandError::Compilation(CompilationError::DisconnectedTerminal {
            node_id: "r1".to_string(),
            handle_id: "terminal-b".to_string(),
        });
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["detail"]["context"]["nodeId"], "r1");
        assert_eq!(serialized["detail"]["context"]["handleId"], "terminal-b");
    }

    #[test]
    fn command_returns_typed_probe_values() {
        let result = circuit_solve_dc(SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![
                SchematicNode {
                    id: "r1".to_string(),
                    kind: SchematicComponentKind::Resistor,
                    rotation: None,
                    electrical: Some(SchematicElectricalParameters {
                        resistance_ohms: Some(1_000.0),
                        ..Default::default()
                    }),
                },
                SchematicNode {
                    id: "ground".to_string(),
                    kind: SchematicComponentKind::Ground,
                    rotation: None,
                    electrical: None,
                },
            ],
            wires: vec![
                SchematicWire {
                    id: "a-ground".to_string(),
                    source: "r1".to_string(),
                    target: "ground".to_string(),
                    source_handle: Some("terminal-a".to_string()),
                    target_handle: Some("terminal".to_string()),
                },
                SchematicWire {
                    id: "b-ground".to_string(),
                    source: "r1".to_string(),
                    target: "ground".to_string(),
                    source_handle: Some("terminal-b".to_string()),
                    target_handle: Some("terminal".to_string()),
                },
            ],
            simulation: Some(SchematicSimulationConfig {
                probes: vec![SchematicProbe {
                    id: "load-current".to_string(),
                    kind: SchematicProbeKind::BranchCurrent,
                    node_id: "r1".to_string(),
                    handle_id: None,
                    label: Some("Load current".to_string()),
                }],
            }),
        })
        .unwrap();

        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["probeValues"][0]["kind"], "branch-current");
        assert_eq!(serialized["probeValues"][0]["probeId"], "load-current");
        assert_eq!(serialized["probeValues"][0]["valueAmps"], 0.0);
        assert_eq!(
            serialized["sourceMap"]["probes"][0]["kind"],
            "branch-current"
        );
        assert_eq!(serialized["sourceMap"]["probes"][0]["component"], "r1");
    }
}
