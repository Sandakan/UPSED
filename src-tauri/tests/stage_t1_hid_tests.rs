use upsed_lib::protocol::{decode_response, parse_protocol_id};
use upsed_lib::serial::{is_candidate_ups_hid, scan_available_ports, with_hid_api};

#[test]
fn hid_001_candidate_ups_known_vids_recognized() {
    // Test known vendor IDs: 0x0665 (Cypress/Voltronic), 0x06da (Phoenixtec/Eaton), etc.
    let known_vids = [
        0x0665, 0x06da, 0x05b8, 0x0483, 0x0925, 0x0f03, 0x14f0, 0x1a86, 0x1cb0, 0x04b4, 0x050d,
        0x0001, 0xffff,
    ];

    with_hid_api(move |api| {
        for dev in api.device_list() {
            if known_vids.contains(&dev.vendor_id()) {
                assert!(
                    is_candidate_ups_hid(dev),
                    "Known UPS VID {:04x} should be identified as candidate",
                    dev.vendor_id()
                );
            }
        }
    });
}

#[test]
fn hid_002_decode_handles_null_padded_hid_responses() {
    // HID feature and input reports are fixed-size (e.g. 8 bytes), so trailing padding contains null bytes
    let raw_hid_report = [40, 80, 73, 48, 49, 13, 0, 0]; // "(PI01\r\0\0"
    let decoded = decode_response(&raw_hid_report).expect("Should decode null-padded response");
    assert_eq!(decoded, "(PI01");

    let proto = parse_protocol_id(&decoded).expect("Should parse protocol ID");
    assert_eq!(proto, "01");
}

#[test]
fn hid_003_decode_handles_standard_q1_null_padded() {
    let mut raw_q1 = b"(230.0 50.0 230.0 50.0 020 0200 027.0 35 00000000\r".to_vec();
    raw_q1.extend_from_slice(&[0, 0, 0, 0]); // Add HID padding
    let decoded = decode_response(&raw_q1).expect("Should decode padded Q1 response");
    assert_eq!(decoded, "(230.0 50.0 230.0 50.0 020 0200 027.0 35 00000000");
}

#[test]
#[ignore]
fn hid_004_live_hardware_scan_discovers_ups() {
    let devices = scan_available_ports();
    println!("Live scan discovered {} devices:", devices.len());
    for d in &devices {
        println!(
            " - Port: {}, Protocol: {}, Serial: {:?}",
            d.port_name, d.protocol_id, d.serial_number
        );
    }
    assert!(
        !devices.is_empty(),
        "Expected to find at least one connected UPS device during live hardware scan"
    );
}

#[test]
#[ignore]
fn hid_005_live_hardware_read_only_q1_telemetry() {
    use upsed_lib::protocol::Q1Status;
    use upsed_lib::serial::{HidTransport, SerialTransport};

    let devices = scan_available_ports();
    assert!(!devices.is_empty(), "No devices found");
    let dev_info = &devices[0];

    let mut transport =
        HidTransport::open_by_port_name(&dev_info.port_name).expect("Should open HidTransport");

    // Strictly Stage T1 Read-Only query (QuickStatus Q1)
    let resp = transport
        .send_command("Q1")
        .expect("Q1 query should succeed on UPS");
    println!("Live Q1 raw response: {}", resp);

    let status = Q1Status::parse(&resp).expect("Q1 response should parse successfully");
    println!(
        "Parsed telemetry: Grid={:.1}V, Out={:.1}V, Freq={:.1}Hz, Load={}% Bat={:.1}V Temp={}C",
        status.grid_voltage_v,
        status.output_voltage_v,
        status.output_frequency_hz,
        status.output_load_pct,
        status.battery_voltage_v,
        status.temperature_c
    );

    assert!(status.output_voltage_v > 100.0 && status.output_voltage_v < 300.0);
    assert!(status.output_frequency_hz >= 40.0 && status.output_frequency_hz <= 70.0);
    assert!(status.battery_voltage_v > 10.0 && status.battery_voltage_v < 60.0);
}

#[test]
fn hid_006_concurrent_multithreaded_hid_scans_do_not_crash() {
    use std::thread;
    use upsed_lib::serial::scan_hid_devices;

    // Spawn 8 concurrent threads hammering HID scanning simultaneously.
    // On macOS Apple Silicon (ARM64e), unpinned HidApi access across Tokio worker threads
    // triggered EXC_BREAKPOINT (SIGTRAP) in __CFCheckCFInfoPACSignature due to cross-thread CFRunLoop mutation.
    // The dedicated upsed-hid-actor thread ensures all IOKit/hidapi calls are safely pinned to a single OS thread.
    let mut handles = Vec::new();
    for thread_idx in 0..8 {
        handles.push(thread::spawn(move || {
            for _ in 0..3 {
                let results = scan_hid_devices(&[]);
                println!(
                    "Thread {} completed HID scan: {} devices found",
                    thread_idx,
                    results.len()
                );
            }
        }));
    }

    for h in handles {
        h.join().expect("Thread panicked during concurrent HID scan");
    }
}
