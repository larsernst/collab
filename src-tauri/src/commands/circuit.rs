use collab_circuit::{
    compile_schematic, solve_dc, CompilationError, DcOperatingPoint, SchematicDocument,
    SchematicSourceMap, SimulationError,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CircuitDcResult {
    pub operating_point: DcOperatingPoint,
    pub source_map: SchematicSourceMap,
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
    Ok(CircuitDcResult {
        operating_point,
        source_map: compiled.source_map,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use collab_circuit::{DiagramMode, SchematicComponentKind, SchematicNode, SchematicWire};

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
        })
        .unwrap();
        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["operatingPoint"]["nodeVoltages"]["0"], 0.0);
        assert_eq!(serialized["operatingPoint"]["iterations"], 1);
        assert_eq!(
            serialized["sourceMap"]["terminals"][0]["terminal"]["handleId"],
            "terminal"
        );

        let error = CircuitCommandError::Compilation(CompilationError::MissingGround);
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["stage"], "compilation");
        assert_eq!(serialized["detail"]["code"], "missingGround");
    }
}
