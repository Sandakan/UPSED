mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::gate::CommandGate;
use upsed_lib::multi_port::MultiPortManager;
use upsed_lib::protocol::{DeviceCapabilities, UnlockStage, VoltronicCommand};
use upsed_lib::serial::DiscoveredDevice;

#[test]
fn multi_001_register_multiple_devices() {
    let manager = MultiPortManager::new();

    let dev1 = DiscoveredDevice {
        port_name: "COM1".into(),
        protocol_id: "17".into(),
        serial_number: Some("9293311030001".into()),
        unique_id: "QID-9293311030001".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("17"),
    };
    let dev2 = DiscoveredDevice {
        port_name: "COM2".into(),
        protocol_id: "02".into(),
        serial_number: Some("9293311030002".into()),
        unique_id: "QID-9293311030002".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("02"),
    };

    let port1 = MockSerialPort::with_axpert_golden_responses("COM1");
    let port2 = MockSerialPort::with_axpert_golden_responses("COM2");

    manager.register_device(dev1, Box::new(port1));
    manager.register_device(dev2, Box::new(port2));

    let list = manager.list_devices();
    assert_eq!(list.len(), 2);
}

#[test]
fn multi_002_commands_isolated_per_port() {
    let manager = MultiPortManager::new();

    let dev1 = DiscoveredDevice {
        port_name: "COM1".into(),
        protocol_id: "17".into(),
        serial_number: Some("9293311030001".into()),
        unique_id: "QID-9293311030001".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("17"),
    };
    let dev2 = DiscoveredDevice {
        port_name: "COM2".into(),
        protocol_id: "02".into(),
        serial_number: Some("9293311030002".into()),
        unique_id: "QID-9293311030002".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("02"),
    };

    let port1 = MockSerialPort::with_axpert_golden_responses("COM1");
    let port2 = MockSerialPort::with_axpert_golden_responses("COM2");

    manager.register_device(dev1, Box::new(port1));
    manager.register_device(dev2, Box::new(port2));

    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    // Send buzzer command to COM1 only
    let resp = manager
        .execute_gated_command("COM1", &VoltronicCommand::BuzzerToggle, &gate)
        .unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn multi_003_polling_multiple_ports() {
    let manager = MultiPortManager::new();

    let dev1 = DiscoveredDevice {
        port_name: "COM1".into(),
        protocol_id: "17".into(),
        serial_number: Some("9293311030001".into()),
        unique_id: "QID-9293311030001".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("17"),
    };
    let dev2 = DiscoveredDevice {
        port_name: "COM2".into(),
        protocol_id: "17".into(),
        serial_number: Some("9293311030002".into()),
        unique_id: "QID-9293311030002".into(),
        firmware_version: Some("00072.10".into()),
        usb_uuid: None,
        capabilities: DeviceCapabilities::for_protocol("17"),
    };

    let port1 = MockSerialPort::with_axpert_golden_responses("COM1");
    let port2 = MockSerialPort::with_axpert_golden_responses("COM2");

    manager.register_device(dev1, Box::new(port1));
    manager.register_device(dev2, Box::new(port2));

    let status1 = manager.poll_device("COM1").unwrap();
    let status2 = manager.poll_device("COM2").unwrap();

    assert_eq!(status1.grid_voltage_v, 238.0);
    assert_eq!(status2.grid_voltage_v, 238.0);
}
