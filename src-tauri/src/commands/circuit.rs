use collab_circuit::{
    compile_schematic, solve_dc, solve_dc_with_control, CompilationError, DcOperatingPoint,
    ProbeTarget, SchematicDocument, SchematicSourceMap, SimulationError,
};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::HashMap,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Instant,
};
use tauri::State;
use thiserror::Error;

use crate::state::AppState;

const MAX_ACTIVE_CIRCUIT_JOBS: usize = 4;
const MAX_RETAINED_CIRCUIT_JOBS: usize = 32;

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
    #[error("circuit worker failed: {message}")]
    Runtime { message: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CircuitJobPhase {
    Queued,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CircuitJobStage {
    Queued,
    Compiling,
    Solving,
    Finalizing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CircuitJobStatus {
    pub phase: CircuitJobPhase,
    pub stage: Option<CircuitJobStage>,
    pub elapsed_millis: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum CircuitJobOutcome {
    Completed { result: CircuitDcResult },
    Failed { error: CircuitCommandError },
    Cancelled,
}

#[derive(Clone, Debug)]
enum CircuitJobState {
    Queued,
    Running(CircuitJobStage),
    Cancelling(CircuitJobStage),
    Terminal {
        outcome: CircuitJobOutcome,
        elapsed_millis: u64,
    },
}

impl CircuitJobState {
    fn phase(&self) -> CircuitJobPhase {
        match self {
            Self::Queued => CircuitJobPhase::Queued,
            Self::Running(_) => CircuitJobPhase::Running,
            Self::Cancelling(_) => CircuitJobPhase::Cancelling,
            Self::Terminal {
                outcome: CircuitJobOutcome::Completed { .. },
                ..
            } => CircuitJobPhase::Completed,
            Self::Terminal {
                outcome: CircuitJobOutcome::Failed { .. },
                ..
            } => CircuitJobPhase::Failed,
            Self::Terminal {
                outcome: CircuitJobOutcome::Cancelled,
                ..
            } => CircuitJobPhase::Cancelled,
        }
    }

    fn stage(&self) -> Option<CircuitJobStage> {
        match self {
            Self::Queued => Some(CircuitJobStage::Queued),
            Self::Running(stage) | Self::Cancelling(stage) => Some(*stage),
            Self::Terminal { .. } => None,
        }
    }

    fn is_terminal(&self) -> bool {
        matches!(self, Self::Terminal { .. })
    }
}

#[derive(Debug)]
struct CircuitJob {
    cancelled: AtomicBool,
    created_at: Instant,
    state: Mutex<CircuitJobState>,
}

#[derive(Debug, Default)]
pub struct CircuitJobRegistry {
    jobs: Mutex<HashMap<String, Arc<CircuitJob>>>,
}

impl CircuitJobRegistry {
    fn start(&self, document: SchematicDocument) -> Result<String, String> {
        let mut jobs = self.jobs.lock();
        if jobs.len() >= MAX_RETAINED_CIRCUIT_JOBS {
            jobs.retain(|_, job| !job.state.lock().is_terminal());
        }
        let active = jobs
            .values()
            .filter(|job| !job.state.lock().is_terminal())
            .count();
        if active >= MAX_ACTIVE_CIRCUIT_JOBS {
            return Err(format!(
                "At most {MAX_ACTIVE_CIRCUIT_JOBS} circuit simulations may run at once."
            ));
        }
        if jobs.len() >= MAX_RETAINED_CIRCUIT_JOBS {
            return Err(
                "Collect an existing circuit result before starting another simulation."
                    .to_string(),
            );
        }

        let job_id = uuid::Uuid::new_v4().to_string();
        let job = Arc::new(CircuitJob {
            cancelled: AtomicBool::new(false),
            created_at: Instant::now(),
            state: Mutex::new(CircuitJobState::Queued),
        });
        jobs.insert(job_id.clone(), Arc::clone(&job));
        drop(jobs);

        let worker_id = job_id.clone();
        let spawn_result = thread::Builder::new()
            .name(format!("collab-circuit-{worker_id}"))
            .spawn(move || {
                if job.cancelled.load(Ordering::Acquire) {
                    set_terminal(&job, CircuitJobOutcome::Cancelled);
                    return;
                }
                {
                    let mut state = job.state.lock();
                    if matches!(*state, CircuitJobState::Cancelling(_)) {
                        drop(state);
                        set_terminal(&job, CircuitJobOutcome::Cancelled);
                        return;
                    }
                    *state = CircuitJobState::Running(CircuitJobStage::Compiling);
                }

                let solved = catch_unwind(AssertUnwindSafe(|| {
                    solve_document_with_control(
                        document,
                        || job.cancelled.load(Ordering::Acquire),
                        |stage| set_job_stage(&job, stage),
                    )
                }));
                let outcome = match solved {
                    Ok(Ok(result)) => CircuitJobOutcome::Completed { result },
                    Ok(Err(CircuitCommandError::Simulation(SimulationError::Cancelled))) => {
                        CircuitJobOutcome::Cancelled
                    }
                    Ok(Err(error)) => CircuitJobOutcome::Failed { error },
                    Err(_) => CircuitJobOutcome::Failed {
                        error: CircuitCommandError::Runtime {
                            message: "the worker panicked".to_string(),
                        },
                    },
                };
                set_terminal(&job, outcome);
            });
        if let Err(error) = spawn_result {
            self.jobs.lock().remove(&job_id);
            return Err(format!("Could not start the circuit worker: {error}"));
        }
        Ok(job_id)
    }

    fn status(&self, job_id: &str) -> Result<CircuitJobStatus, String> {
        let job = self
            .jobs
            .lock()
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("Unknown circuit job '{job_id}'."))?;
        let state = job.state.lock();
        let elapsed_millis = match &*state {
            CircuitJobState::Terminal { elapsed_millis, .. } => *elapsed_millis,
            _ => elapsed_millis(job.created_at),
        };
        Ok(CircuitJobStatus {
            phase: state.phase(),
            stage: state.stage(),
            elapsed_millis,
        })
    }

    fn cancel(&self, job_id: &str) -> Result<CircuitJobPhase, String> {
        let job = self
            .jobs
            .lock()
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("Unknown circuit job '{job_id}'."))?;
        job.cancelled.store(true, Ordering::Release);
        let mut state = job.state.lock();
        *state = match *state {
            CircuitJobState::Queued => CircuitJobState::Cancelling(CircuitJobStage::Queued),
            CircuitJobState::Running(stage) => CircuitJobState::Cancelling(stage),
            _ => return Ok(state.phase()),
        };
        Ok(state.phase())
    }

    fn take_outcome(&self, job_id: &str) -> Result<Option<CircuitJobOutcome>, String> {
        let job = self
            .jobs
            .lock()
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("Unknown circuit job '{job_id}'."))?;
        let outcome = match &*job.state.lock() {
            CircuitJobState::Terminal { outcome, .. } => Some(outcome.clone()),
            _ => None,
        };
        if outcome.is_some() {
            self.jobs.lock().remove(job_id);
        }
        Ok(outcome)
    }
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn set_job_stage(job: &CircuitJob, stage: CircuitJobStage) {
    let mut state = job.state.lock();
    *state = match *state {
        CircuitJobState::Running(_) => CircuitJobState::Running(stage),
        CircuitJobState::Cancelling(_) => CircuitJobState::Cancelling(stage),
        _ => return,
    };
}

fn set_terminal(job: &CircuitJob, outcome: CircuitJobOutcome) {
    *job.state.lock() = CircuitJobState::Terminal {
        outcome,
        elapsed_millis: elapsed_millis(job.created_at),
    };
}

fn solve_document_with_control(
    document: SchematicDocument,
    mut should_cancel: impl FnMut() -> bool,
    mut on_stage: impl FnMut(CircuitJobStage),
) -> Result<CircuitDcResult, CircuitCommandError> {
    let compiled = compile_schematic(&document)?;
    if should_cancel() {
        return Err(SimulationError::Cancelled.into());
    }
    on_stage(CircuitJobStage::Solving);
    let operating_point = solve_dc_with_control(&compiled.circuit, &mut should_cancel)?;
    if should_cancel() {
        return Err(SimulationError::Cancelled.into());
    }
    on_stage(CircuitJobStage::Finalizing);
    let result = build_dc_result(operating_point, compiled.source_map);
    if should_cancel() {
        return Err(SimulationError::Cancelled.into());
    }
    Ok(result)
}

fn build_dc_result(
    operating_point: DcOperatingPoint,
    source_map: SchematicSourceMap,
) -> CircuitDcResult {
    let probe_values = source_map
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
    CircuitDcResult {
        operating_point,
        source_map,
        probe_values,
    }
}

/// Compile and solve a bounded DC schematic using the shared first-party
/// simulation crate. This synchronous command remains for compatibility;
/// interactive callers should use the cancellable job commands below.
#[tauri::command]
pub fn circuit_solve_dc(
    document: SchematicDocument,
) -> Result<CircuitDcResult, CircuitCommandError> {
    let compiled = compile_schematic(&document)?;
    let operating_point = solve_dc(&compiled.circuit)?;
    Ok(build_dc_result(operating_point, compiled.source_map))
}

#[tauri::command]
pub fn circuit_start_dc(
    document: SchematicDocument,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.circuit_jobs.start(document)
}

#[tauri::command]
pub fn circuit_job_status(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<CircuitJobStatus, String> {
    state.circuit_jobs.status(&job_id)
}

#[tauri::command]
pub fn circuit_cancel_job(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<CircuitJobPhase, String> {
    state.circuit_jobs.cancel(&job_id)
}

#[tauri::command]
pub fn circuit_take_job_result(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CircuitJobOutcome>, String> {
    state.circuit_jobs.take_outcome(&job_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use collab_circuit::{
        ComponentId, DcDiagnostic, DiagramMode, SchematicComponentKind,
        SchematicElectricalParameters, SchematicNode, SchematicProbe, SchematicProbeKind,
        SchematicSimulationConfig, SchematicWire,
    };
    use std::time::Duration;

    fn ground_document() -> SchematicDocument {
        SchematicDocument {
            diagram_mode: DiagramMode::Schematic,
            nodes: vec![SchematicNode {
                id: "ground".to_string(),
                kind: SchematicComponentKind::Ground,
                rotation: None,
                electrical: None,
            }],
            wires: vec![],
            simulation: None,
        }
    }

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
            collector_emitter_voltage: -0.2,
        })
        .unwrap();
        assert_eq!(diagnostic["context"]["baseEmitterVoltage"], 0.7);
        assert_eq!(diagnostic["context"]["collectorEmitterVoltage"], -0.2);

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

        let error = CircuitCommandError::Simulation(SimulationError::TimeLimitExceeded {
            limit_millis: 10_000,
        });
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["stage"], "simulation");
        assert_eq!(serialized["detail"]["code"], "timeLimitExceeded");
        assert_eq!(serialized["detail"]["context"]["limitMillis"], 10_000);

        let error =
            CircuitCommandError::Simulation(SimulationError::DenseSolverSizeLimitExceeded {
                unknowns: 640,
                max_unknowns: 512,
            });
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["detail"]["code"], "denseSolverSizeLimitExceeded");
        assert_eq!(serialized["detail"]["context"]["unknowns"], 640);
        assert_eq!(serialized["detail"]["context"]["maxUnknowns"], 512);
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

    #[test]
    fn job_registry_runs_on_a_worker_and_consumes_terminal_results() {
        let registry = CircuitJobRegistry::default();
        let job_id = registry.start(ground_document()).unwrap();
        let status = (0..100)
            .find_map(|_| {
                let status = registry.status(&job_id).unwrap();
                if matches!(
                    status.phase,
                    CircuitJobPhase::Completed
                        | CircuitJobPhase::Failed
                        | CircuitJobPhase::Cancelled
                ) {
                    Some(status)
                } else {
                    thread::sleep(Duration::from_millis(5));
                    None
                }
            })
            .expect("worker should finish within the test timeout");
        assert_eq!(status.phase, CircuitJobPhase::Completed);
        assert_eq!(status.stage, None);

        let outcome = registry.take_outcome(&job_id).unwrap().unwrap();
        assert!(matches!(outcome, CircuitJobOutcome::Completed { .. }));
        assert!(registry.status(&job_id).is_err());
    }

    #[test]
    fn job_registry_exposes_cancelling_and_stable_wire_shapes() {
        let registry = CircuitJobRegistry::default();
        let job_id = "queued-job".to_string();
        let job = Arc::new(CircuitJob {
            cancelled: AtomicBool::new(false),
            created_at: Instant::now(),
            state: Mutex::new(CircuitJobState::Queued),
        });
        registry
            .jobs
            .lock()
            .insert(job_id.clone(), Arc::clone(&job));

        assert_eq!(
            registry.cancel(&job_id).unwrap(),
            CircuitJobPhase::Cancelling
        );
        assert!(job.cancelled.load(Ordering::Acquire));
        let status = registry.status(&job_id).unwrap();
        assert_eq!(status.phase, CircuitJobPhase::Cancelling);
        assert_eq!(status.stage, Some(CircuitJobStage::Queued));
        assert_eq!(
            serde_json::to_value(CircuitJobOutcome::Cancelled).unwrap(),
            serde_json::json!({ "state": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(CircuitJobPhase::Running).unwrap(),
            serde_json::json!("running")
        );
        assert_eq!(
            serde_json::to_value(CircuitJobStage::Finalizing).unwrap(),
            serde_json::json!("finalizing")
        );
        let serialized_status = serde_json::to_value(status).unwrap();
        assert_eq!(serialized_status["phase"], "cancelling");
        assert_eq!(serialized_status["stage"], "queued");
        assert!(serialized_status["elapsedMillis"].is_u64());
    }

    #[test]
    fn job_registry_rejects_more_than_the_active_job_limit() {
        let registry = CircuitJobRegistry::default();
        for index in 0..MAX_ACTIVE_CIRCUIT_JOBS {
            registry.jobs.lock().insert(
                format!("queued-{index}"),
                Arc::new(CircuitJob {
                    cancelled: AtomicBool::new(false),
                    created_at: Instant::now(),
                    state: Mutex::new(CircuitJobState::Queued),
                }),
            );
        }

        let error = registry.start(ground_document()).unwrap_err();
        assert_eq!(
            error,
            format!("At most {MAX_ACTIVE_CIRCUIT_JOBS} circuit simulations may run at once.")
        );
    }
}
