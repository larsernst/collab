use std::collections::BTreeSet;

use collab_circuit::{
    compile_schematic, Component, ComponentId, DiagramMode, NodeId, SchematicComponentKind,
    SchematicDocument, SchematicElectricalParameters, SchematicNode, SchematicWire,
};

fn node(
    id: impl Into<String>,
    kind: SchematicComponentKind,
    electrical: Option<SchematicElectricalParameters>,
) -> SchematicNode {
    SchematicNode {
        id: id.into(),
        kind,
        rotation: None,
        electrical,
    }
}

fn wire(
    id: impl Into<String>,
    source: impl Into<String>,
    source_handle: impl Into<String>,
    target: impl Into<String>,
    target_handle: impl Into<String>,
) -> SchematicWire {
    SchematicWire {
        id: id.into(),
        source: source.into(),
        target: target.into(),
        source_handle: Some(source_handle.into()),
        target_handle: Some(target_handle.into()),
    }
}

fn voltage_source() -> SchematicNode {
    node(
        "source",
        SchematicComponentKind::VoltageSource,
        Some(SchematicElectricalParameters {
            voltage_volts: Some(5.0),
            ..Default::default()
        }),
    )
}

fn two_terminal_fixture(
    kind: SchematicComponentKind,
    electrical: SchematicElectricalParameters,
    positive_handle: &str,
    negative_handle: &str,
) -> SchematicDocument {
    SchematicDocument {
        diagram_mode: DiagramMode::Schematic,
        nodes: vec![
            node("dut", kind, Some(electrical)),
            node("ground", SchematicComponentKind::Ground, None),
            voltage_source(),
        ],
        wires: vec![
            wire("input", "source", "positive", "dut", positive_handle),
            wire("output", "dut", negative_handle, "ground", "terminal"),
            wire("reference", "source", "negative", "ground", "terminal"),
        ],
        simulation: None,
    }
}

fn compiled_dut(document: &SchematicDocument) -> Component {
    compile_schematic(document)
        .expect("golden fixture should compile")
        .circuit
        .components
        .into_iter()
        .find(|component| component.id() == &ComponentId::new("dut"))
        .expect("golden fixture should emit the device under test")
}

#[test]
fn compiler_component_outputs_match_the_typed_golden_contract() {
    let two_terminal_net = NodeId::new("net:3:dut:terminal-a");
    let diode_net = NodeId::new("net:3:dut:anode");
    let reference = NodeId::new("0");

    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Resistor,
            SchematicElectricalParameters {
                resistance_ohms: Some(1_234.0),
                ..Default::default()
            },
            "terminal-a",
            "terminal-b",
        )),
        Component::Resistor {
            id: ComponentId::new("dut"),
            positive: two_terminal_net.clone(),
            negative: reference.clone(),
            resistance_ohms: 1_234.0,
        }
    );
    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Capacitor,
            SchematicElectricalParameters {
                capacitance_farads: Some(2.2e-6),
                ..Default::default()
            },
            "terminal-a",
            "terminal-b",
        )),
        Component::Capacitor {
            id: ComponentId::new("dut"),
            positive: two_terminal_net.clone(),
            negative: reference.clone(),
            capacitance_farads: 2.2e-6,
        }
    );
    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Inductor,
            SchematicElectricalParameters {
                inductance_henries: Some(4.7e-3),
                ..Default::default()
            },
            "terminal-a",
            "terminal-b",
        )),
        Component::Inductor {
            id: ComponentId::new("dut"),
            positive: two_terminal_net.clone(),
            negative: reference.clone(),
            inductance_henries: 4.7e-3,
        }
    );
    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Switch,
            SchematicElectricalParameters {
                switch_closed: Some(true),
                ..Default::default()
            },
            "terminal-a",
            "terminal-b",
        )),
        Component::Switch {
            id: ComponentId::new("dut"),
            positive: two_terminal_net,
            negative: reference.clone(),
            closed: true,
            closed_resistance_ohms: 1.0e-3,
            open_resistance_ohms: 1.0e12,
        }
    );
    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Diode,
            SchematicElectricalParameters {
                model_ref: Some("builtin:diode".to_string()),
                ..Default::default()
            },
            "anode",
            "cathode",
        )),
        Component::Diode {
            id: ComponentId::new("dut"),
            anode: diode_net.clone(),
            cathode: reference.clone(),
            saturation_current_amps: 1.0e-12,
            emission_coefficient: 1.0,
            thermal_voltage_volts: 0.025_852,
        }
    );
    assert_eq!(
        compiled_dut(&two_terminal_fixture(
            SchematicComponentKind::Led,
            SchematicElectricalParameters {
                model_ref: Some("builtin:led".to_string()),
                ..Default::default()
            },
            "anode",
            "cathode",
        )),
        Component::Diode {
            id: ComponentId::new("dut"),
            anode: diode_net,
            cathode: reference.clone(),
            saturation_current_amps: 1.0e-18,
            emission_coefficient: 2.0,
            thermal_voltage_volts: 0.025_852,
        }
    );

    let transistor = SchematicDocument {
        diagram_mode: DiagramMode::Schematic,
        nodes: vec![
            node(
                "dut",
                SchematicComponentKind::Transistor,
                Some(SchematicElectricalParameters {
                    model_ref: Some("builtin:npn".to_string()),
                    ..Default::default()
                }),
            ),
            node("ground", SchematicComponentKind::Ground, None),
            voltage_source(),
        ],
        wires: vec![
            wire("base", "source", "positive", "dut", "base"),
            wire("collector", "source", "positive", "dut", "collector"),
            wire("emitter", "dut", "emitter", "ground", "terminal"),
            wire("reference", "source", "negative", "ground", "terminal"),
        ],
        simulation: None,
    };
    assert_eq!(
        compiled_dut(&transistor),
        Component::BipolarNpn {
            id: ComponentId::new("dut"),
            base: NodeId::new("net:3:dut:base"),
            collector: NodeId::new("net:3:dut:base"),
            emitter: reference,
            saturation_current_amps: 1.0e-15,
            forward_beta: 100.0,
            emission_coefficient: 1.0,
            thermal_voltage_volts: 0.025_852,
        }
    );
}

fn branched_fixture(branch_count: usize) -> SchematicDocument {
    let mut nodes = vec![
        node("ground", SchematicComponentKind::Ground, None),
        node("junction", SchematicComponentKind::Junction, None),
        voltage_source(),
    ];
    let mut wires = vec![
        wire("bus-source", "source", "positive", "junction", "terminal"),
        wire(
            "source-reference",
            "source",
            "negative",
            "ground",
            "terminal",
        ),
    ];
    for index in 0..branch_count {
        let resistor_id = format!("r-{index:03}");
        nodes.push(node(
            &resistor_id,
            SchematicComponentKind::Resistor,
            Some(SchematicElectricalParameters {
                resistance_ohms: Some(1_000.0 + index as f64),
                ..Default::default()
            }),
        ));
        wires.push(wire(
            format!("bus-{index:03}"),
            "junction",
            "terminal",
            &resistor_id,
            "terminal-a",
        ));
        wires.push(wire(
            format!("return-{index:03}"),
            &resistor_id,
            "terminal-b",
            "ground",
            "terminal",
        ));
    }
    SchematicDocument {
        diagram_mode: DiagramMode::Schematic,
        nodes,
        wires,
        simulation: None,
    }
}

fn deterministic_shuffle<T>(items: &mut [T], mut state: u64) {
    for index in (1..items.len()).rev() {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        items.swap(index, (state as usize) % (index + 1));
    }
}

#[test]
fn generated_branch_topologies_preserve_nets_source_maps_and_ordering() {
    for branch_count in [2, 3, 8, 16, 32, 64] {
        let baseline_document = branched_fixture(branch_count);
        let baseline = compile_schematic(&baseline_document).unwrap();
        let bus_nodes: BTreeSet<_> = baseline
            .source_map
            .wires
            .iter()
            .filter(|mapping| mapping.wire_id.starts_with("bus-"))
            .map(|mapping| mapping.electrical_node.clone())
            .collect();
        assert_eq!(bus_nodes.len(), 1, "branch count {branch_count}");
        assert_eq!(baseline.circuit.components.len(), branch_count + 1);

        for seed in 0..24_u64 {
            let mut permuted = baseline_document.clone();
            deterministic_shuffle(&mut permuted.nodes, seed ^ branch_count as u64);
            deterministic_shuffle(&mut permuted.wires, seed.rotate_left(17));
            for (index, schematic_node) in permuted.nodes.iter_mut().enumerate() {
                schematic_node.rotation = Some([0, 90, 180, 270][(index + seed as usize) % 4]);
            }
            assert_eq!(
                compile_schematic(&permuted).unwrap(),
                baseline,
                "branch count {branch_count}, seed {seed}"
            );
        }
    }
}

#[test]
fn voltage_source_ground_and_junction_have_stable_golden_output() {
    let document = branched_fixture(2);
    let compiled = compile_schematic(&document).unwrap();
    let source = compiled
        .circuit
        .components
        .iter()
        .find(|component| component.id() == &ComponentId::new("source"))
        .unwrap();
    assert_eq!(
        source,
        &Component::VoltageSource {
            id: ComponentId::new("source"),
            positive: NodeId::new("net:8:junction:terminal"),
            negative: NodeId::new("0"),
            voltage_volts: 5.0,
        }
    );
    assert!(!compiled
        .circuit
        .components
        .iter()
        .any(|component| matches!(component.id().0.as_str(), "ground" | "junction")));
    assert_eq!(
        serde_json::to_value(&compiled.source_map).unwrap(),
        serde_json::json!({
            "terminals": [
                { "terminal": { "nodeId": "ground", "handleId": "terminal" }, "electricalNode": "0" },
                { "terminal": { "nodeId": "junction", "handleId": "terminal" }, "electricalNode": "net:8:junction:terminal" },
                { "terminal": { "nodeId": "r-000", "handleId": "terminal-a" }, "electricalNode": "net:8:junction:terminal" },
                { "terminal": { "nodeId": "r-000", "handleId": "terminal-b" }, "electricalNode": "0" },
                { "terminal": { "nodeId": "r-001", "handleId": "terminal-a" }, "electricalNode": "net:8:junction:terminal" },
                { "terminal": { "nodeId": "r-001", "handleId": "terminal-b" }, "electricalNode": "0" },
                { "terminal": { "nodeId": "source", "handleId": "negative" }, "electricalNode": "0" },
                { "terminal": { "nodeId": "source", "handleId": "positive" }, "electricalNode": "net:8:junction:terminal" }
            ],
            "wires": [
                { "wireId": "bus-000", "electricalNode": "net:8:junction:terminal" },
                { "wireId": "bus-001", "electricalNode": "net:8:junction:terminal" },
                { "wireId": "bus-source", "electricalNode": "net:8:junction:terminal" },
                { "wireId": "return-000", "electricalNode": "0" },
                { "wireId": "return-001", "electricalNode": "0" },
                { "wireId": "source-reference", "electricalNode": "0" }
            ],
            "probes": []
        })
    );
}
