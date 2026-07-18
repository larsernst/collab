use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    solve_dc_with_limits, Circuit, Component, ComponentId, DcSolveLimits, NodeId, ProbeMap,
    ProbeTarget, SimulationError,
};

const DEFAULT_MAX_SWEEP_SAMPLES: usize = 4_096;
const DEFAULT_MAX_SWEEP_VALUES: usize = 1_048_576;
const DEFAULT_MAX_SWEEP_DURATION: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DcSweepOutput {
    NodeVoltage { node: NodeId },
    ComponentCurrent { component: ComponentId },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepRequest {
    pub source: ComponentId,
    pub start: f64,
    pub stop: f64,
    pub sample_count: usize,
    pub outputs: Vec<DcSweepOutput>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepTrace {
    pub output: DcSweepOutput,
    pub values: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcSweepResult {
    pub source: ComponentId,
    pub source_values: Vec<f64>,
    pub traces: Vec<DcSweepTrace>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DcSweepLimits {
    pub max_samples: usize,
    pub max_result_values: usize,
    pub max_duration: Duration,
    pub dc: DcSolveLimits,
}

impl Default for DcSweepLimits {
    fn default() -> Self {
        Self {
            max_samples: DEFAULT_MAX_SWEEP_SAMPLES,
            max_result_values: DEFAULT_MAX_SWEEP_VALUES,
            max_duration: DEFAULT_MAX_SWEEP_DURATION,
            dc: DcSolveLimits::default(),
        }
    }
}

#[derive(Clone, Debug, Error, PartialEq, Serialize)]
#[serde(
    tag = "code",
    content = "context",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DcSweepError {
    #[error("a DC sweep requires at least two samples")]
    InvalidSampleCount { sample_count: usize },
    #[error(
        "the DC sweep requests {sample_count} samples, exceeding the {max_samples} sample limit"
    )]
    SampleLimitExceeded {
        sample_count: usize,
        max_samples: usize,
    },
    #[error("the DC sweep range must contain distinct finite values")]
    InvalidRange { start: f64, stop: f64 },
    #[error("a DC sweep requires at least one output trace")]
    MissingOutputs,
    #[error("the DC sweep output is duplicated")]
    DuplicateOutput { output: DcSweepOutput },
    #[error("DC sweep source '{source_id}' does not exist")]
    UnknownSource { source_id: ComponentId },
    #[error("component '{source_id}' is not an independent voltage or current source")]
    UnsupportedSource { source_id: ComponentId },
    #[error("DC sweep voltage output node '{node}' does not exist")]
    UnknownNodeOutput { node: NodeId },
    #[error("DC sweep current output component '{component}' does not exist")]
    UnknownComponentOutput { component: ComponentId },
    #[error(
        "the DC sweep result requires {required_values} values, exceeding the {max_values} value limit"
    )]
    ResultBufferLimitExceeded {
        required_values: usize,
        max_values: usize,
    },
    #[error("the DC sweep was cancelled")]
    Cancelled,
    #[error("the DC sweep exceeded its {limit_millis} ms execution limit")]
    TimeLimitExceeded { limit_millis: u64 },
    #[error("DC sweep sample {sample_index} at {source_value} failed: {error}")]
    SampleFailed {
        sample_index: usize,
        source_value: f64,
        error: SimulationError,
    },
}

pub fn sweep_dc(
    circuit: &Circuit,
    request: &DcSweepRequest,
) -> Result<DcSweepResult, DcSweepError> {
    sweep_dc_with_control(circuit, request, DcSweepLimits::default(), || false)
}

pub fn dc_sweep_outputs_for_probes(probes: &[ProbeMap]) -> Vec<DcSweepOutput> {
    let mut seen = BTreeSet::new();
    probes
        .iter()
        .filter_map(|probe| {
            let output = match &probe.target {
                ProbeTarget::NodeVoltage { electrical_node } => DcSweepOutput::NodeVoltage {
                    node: electrical_node.clone(),
                },
                ProbeTarget::BranchCurrent { component } => DcSweepOutput::ComponentCurrent {
                    component: component.clone(),
                },
            };
            seen.insert(output.clone()).then_some(output)
        })
        .collect()
}

pub fn sweep_dc_with_control(
    circuit: &Circuit,
    request: &DcSweepRequest,
    limits: DcSweepLimits,
    mut should_cancel: impl FnMut() -> bool,
) -> Result<DcSweepResult, DcSweepError> {
    validate_request(circuit, request, limits)?;
    let started_at = Instant::now();
    let source_values = linear_values(request.start, request.stop, request.sample_count);
    let mut traces = request
        .outputs
        .iter()
        .cloned()
        .map(|output| DcSweepTrace {
            output,
            values: Vec::with_capacity(request.sample_count),
        })
        .collect::<Vec<_>>();

    for (sample_index, source_value) in source_values.iter().copied().enumerate() {
        check_control(&mut should_cancel, started_at, limits.max_duration)?;
        let mut sample_circuit = circuit.clone();
        set_source_value(&mut sample_circuit, &request.source, source_value)?;
        let remaining = limits.max_duration.saturating_sub(started_at.elapsed());
        let dc_limits = DcSolveLimits {
            max_duration: limits.dc.max_duration.min(remaining),
            ..limits.dc
        };
        let operating_point = solve_dc_with_limits(&sample_circuit, dc_limits, &mut should_cancel)
            .map_err(|error| match error {
                SimulationError::Cancelled => DcSweepError::Cancelled,
                error => DcSweepError::SampleFailed {
                    sample_index,
                    source_value,
                    error,
                },
            })?;

        for trace in &mut traces {
            let value = match &trace.output {
                DcSweepOutput::NodeVoltage { node } => operating_point.node_voltages[node],
                DcSweepOutput::ComponentCurrent { component } => {
                    operating_point.component_currents[component]
                }
            };
            trace.values.push(value);
        }
    }

    Ok(DcSweepResult {
        source: request.source.clone(),
        source_values,
        traces,
    })
}

fn validate_request(
    circuit: &Circuit,
    request: &DcSweepRequest,
    limits: DcSweepLimits,
) -> Result<(), DcSweepError> {
    if request.sample_count < 2 {
        return Err(DcSweepError::InvalidSampleCount {
            sample_count: request.sample_count,
        });
    }
    if request.sample_count > limits.max_samples {
        return Err(DcSweepError::SampleLimitExceeded {
            sample_count: request.sample_count,
            max_samples: limits.max_samples,
        });
    }
    if !request.start.is_finite() || !request.stop.is_finite() || request.start == request.stop {
        return Err(DcSweepError::InvalidRange {
            start: request.start,
            stop: request.stop,
        });
    }
    if request.outputs.is_empty() {
        return Err(DcSweepError::MissingOutputs);
    }
    let required_values = request
        .outputs
        .len()
        .checked_add(1)
        .and_then(|trace_count| trace_count.checked_mul(request.sample_count))
        .unwrap_or(usize::MAX);
    if required_values > limits.max_result_values {
        return Err(DcSweepError::ResultBufferLimitExceeded {
            required_values,
            max_values: limits.max_result_values,
        });
    }

    let source = circuit
        .components
        .iter()
        .find(|component| component.id() == &request.source)
        .ok_or_else(|| DcSweepError::UnknownSource {
            source_id: request.source.clone(),
        })?;
    if !matches!(
        source,
        Component::VoltageSource { .. } | Component::CurrentSource { .. }
    ) {
        return Err(DcSweepError::UnsupportedSource {
            source_id: request.source.clone(),
        });
    }

    let nodes = circuit
        .components
        .iter()
        .flat_map(Component::nodes)
        .cloned()
        .chain(std::iter::once(circuit.reference.clone()))
        .collect::<BTreeSet<_>>();
    let component_ids = circuit
        .components
        .iter()
        .map(|component| component.id().clone())
        .collect::<BTreeSet<_>>();
    let mut outputs = BTreeSet::new();
    for output in &request.outputs {
        if !outputs.insert(output.clone()) {
            return Err(DcSweepError::DuplicateOutput {
                output: output.clone(),
            });
        }
        match output {
            DcSweepOutput::NodeVoltage { node } if !nodes.contains(node) => {
                return Err(DcSweepError::UnknownNodeOutput { node: node.clone() });
            }
            DcSweepOutput::ComponentCurrent { component } if !component_ids.contains(component) => {
                return Err(DcSweepError::UnknownComponentOutput {
                    component: component.clone(),
                });
            }
            _ => {}
        }
    }
    Ok(())
}

fn set_source_value(
    circuit: &mut Circuit,
    source: &ComponentId,
    value: f64,
) -> Result<(), DcSweepError> {
    let component = circuit
        .components
        .iter_mut()
        .find(|component| component.id() == source)
        .ok_or_else(|| DcSweepError::UnknownSource {
            source_id: source.clone(),
        })?;
    match component {
        Component::VoltageSource { voltage_volts, .. } => *voltage_volts = value,
        Component::CurrentSource { current_amps, .. } => *current_amps = value,
        _ => {
            return Err(DcSweepError::UnsupportedSource {
                source_id: source.clone(),
            });
        }
    }
    Ok(())
}

fn linear_values(start: f64, stop: f64, sample_count: usize) -> Vec<f64> {
    let denominator = (sample_count - 1) as f64;
    (0..sample_count)
        .map(|index| {
            if index + 1 == sample_count {
                stop
            } else {
                start + (stop - start) * index as f64 / denominator
            }
        })
        .collect()
}

fn check_control(
    should_cancel: &mut impl FnMut() -> bool,
    started_at: Instant,
    max_duration: Duration,
) -> Result<(), DcSweepError> {
    if should_cancel() {
        return Err(DcSweepError::Cancelled);
    }
    if started_at.elapsed() >= max_duration {
        return Err(DcSweepError::TimeLimitExceeded {
            limit_millis: max_duration.as_millis().min(u64::MAX as u128) as u64,
        });
    }
    Ok(())
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

    fn divider() -> Circuit {
        Circuit {
            reference: node("0"),
            components: vec![
                Component::VoltageSource {
                    id: component("V1"),
                    positive: node("vin"),
                    negative: node("0"),
                    voltage_volts: 0.0,
                },
                Component::Resistor {
                    id: component("R1"),
                    positive: node("vin"),
                    negative: node("out"),
                    resistance_ohms: 1_000.0,
                },
                Component::Resistor {
                    id: component("R2"),
                    positive: node("out"),
                    negative: node("0"),
                    resistance_ohms: 1_000.0,
                },
            ],
        }
    }

    fn divider_request() -> DcSweepRequest {
        DcSweepRequest {
            source: component("V1"),
            start: 0.0,
            stop: 10.0,
            sample_count: 3,
            outputs: vec![
                DcSweepOutput::NodeVoltage { node: node("out") },
                DcSweepOutput::ComponentCurrent {
                    component: component("R1"),
                },
            ],
        }
    }

    #[test]
    fn linearly_sweeps_an_independent_source_and_requested_outputs() {
        let result = sweep_dc(&divider(), &divider_request()).unwrap();

        assert_eq!(result.source_values, vec![0.0, 5.0, 10.0]);
        assert_eq!(result.traces[0].values, vec![0.0, 2.5, 5.0]);
        assert_eq!(result.traces[1].values, vec![0.0, 0.0025, 0.005]);
    }

    #[test]
    fn sweeps_an_independent_current_source() {
        let circuit = Circuit {
            reference: node("0"),
            components: vec![
                Component::CurrentSource {
                    id: component("I1"),
                    positive: node("0"),
                    negative: node("out"),
                    current_amps: 0.0,
                },
                Component::Resistor {
                    id: component("R1"),
                    positive: node("out"),
                    negative: node("0"),
                    resistance_ohms: 1_000.0,
                },
            ],
        };
        let result = sweep_dc(
            &circuit,
            &DcSweepRequest {
                source: component("I1"),
                start: 0.0,
                stop: 0.002,
                sample_count: 3,
                outputs: vec![DcSweepOutput::NodeVoltage { node: node("out") }],
            },
        )
        .unwrap();

        assert_eq!(result.source_values, vec![0.0, 0.001, 0.002]);
        assert_eq!(result.traces[0].values, vec![0.0, 1.0, 2.0]);
    }

    #[test]
    fn maps_compiled_probes_to_deduplicated_sweep_outputs() {
        let probes = vec![
            ProbeMap {
                probe_id: "v1".to_string(),
                label: None,
                target: ProbeTarget::NodeVoltage {
                    electrical_node: node("out"),
                },
            },
            ProbeMap {
                probe_id: "v2".to_string(),
                label: Some("same net".to_string()),
                target: ProbeTarget::NodeVoltage {
                    electrical_node: node("out"),
                },
            },
            ProbeMap {
                probe_id: "i1".to_string(),
                label: None,
                target: ProbeTarget::BranchCurrent {
                    component: component("R1"),
                },
            },
        ];

        assert_eq!(
            dc_sweep_outputs_for_probes(&probes),
            vec![
                DcSweepOutput::NodeVoltage { node: node("out") },
                DcSweepOutput::ComponentCurrent {
                    component: component("R1")
                },
            ]
        );
    }

    #[test]
    fn validates_source_outputs_and_result_budgets_before_solving() {
        let circuit = divider();
        let mut request = divider_request();
        request.source = component("R1");
        assert_eq!(
            sweep_dc(&circuit, &request),
            Err(DcSweepError::UnsupportedSource {
                source_id: component("R1")
            })
        );

        let mut request = divider_request();
        request.outputs.push(request.outputs[0].clone());
        assert!(matches!(
            sweep_dc(&circuit, &request),
            Err(DcSweepError::DuplicateOutput { .. })
        ));

        let request = divider_request();
        assert!(matches!(
            sweep_dc_with_control(
                &circuit,
                &request,
                DcSweepLimits {
                    max_result_values: 8,
                    ..DcSweepLimits::default()
                },
                || false,
            ),
            Err(DcSweepError::ResultBufferLimitExceeded {
                required_values: 9,
                max_values: 8
            })
        ));
    }

    #[test]
    fn checks_cancellation_before_and_during_samples() {
        let mut checks = 0;
        assert_eq!(
            sweep_dc_with_control(
                &divider(),
                &divider_request(),
                DcSweepLimits::default(),
                || {
                    checks += 1;
                    checks > 3
                },
            ),
            Err(DcSweepError::Cancelled)
        );
        assert!(checks > 3);

        assert_eq!(
            sweep_dc_with_control(
                &divider(),
                &divider_request(),
                DcSweepLimits {
                    max_duration: Duration::ZERO,
                    ..DcSweepLimits::default()
                },
                || false,
            ),
            Err(DcSweepError::TimeLimitExceeded { limit_millis: 0 })
        );
    }

    #[test]
    fn serializes_explicit_trace_and_error_shapes() {
        let result = sweep_dc(&divider(), &divider_request()).unwrap();
        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["sourceValues"][1], 5.0);
        assert_eq!(serialized["traces"][0]["output"]["kind"], "node-voltage");

        let error = serde_json::to_value(DcSweepError::SampleLimitExceeded {
            sample_count: 5_000,
            max_samples: 4_096,
        })
        .unwrap();
        assert_eq!(error["code"], "sampleLimitExceeded");
        assert_eq!(error["context"]["maxSamples"], 4_096);
    }
}
