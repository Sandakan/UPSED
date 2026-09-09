use voltwatch_lib::protocol::{decode_response, parse_protocol_id};
use voltwatch_lib::serial::{is_candidate_ups_hid, scan_available_ports};

#[test]
fn hid_001_candidate_ups_known_vids_recognized() {
    // Test known vendor IDs: 0x0665 (Cypress/Voltronic), 0x06da (Phoenixtec/Eaton), etc.
    let known_vids = [
        0x0665, 0x06da, 0x05b8, 0x0483, 0x0925, 0x0f03, 0x14f0, 0x1a86, 0x1cb0, 0x04b4, 0x050d,
        0x0001, 0xffff,
    ];

    let api = match hidapi::HidApi::new() {
        Ok(a) => a,
        Err(_) => return, // Environment without HID subsystem (e.g. headless CI)
    };

    for dev in api.device_list() {
        if known_vids.contains(&dev.vendor_id()) {
            assert!(
                is_candidate_ups_hid(dev),
                "Known UPS VID {:04x} should be identified as candidate",
                dev.vendor_id()
            );
        }
    }
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
    assert_eq!(
        decoded,
        "(230.0 50.0 230.0 50.0 020 0200 027.0 35 00000000"
    );
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

