use std::time::Duration;

#[test]
#[ignore]
fn probe_live_hid() {
    let api = hidapi::HidApi::new().expect("Failed to init hidapi");

    println!("=== Matching HID Devices ===");
    for dev in api.device_list() {
        if dev.vendor_id() == 0x0665 || dev.product_string().unwrap_or("").contains("UPS") {
            println!(
                "MATCH: VID={:04x}, PID={:04x}, Path={:?}, Prod={:?}, Mfr={:?}, UsagePage={:04x}, Usage={:04x}",
                dev.vendor_id(),
                dev.product_id(),
                dev.path(),
                dev.product_string(),
                dev.manufacturer_string(),
                dev.usage_page(),
                dev.usage()
            );
        }
    }

    if let Ok(dev) = api.open(0x0665, 0x5161) {
        println!("Successfully opened 0665:5161!");

        let cmd = "QPI\r";
        let mut buf = [0u8; 8];
        let bytes = cmd.as_bytes();
        for (i, &b) in bytes.iter().enumerate() {
            buf[i] = b;
        }

        println!("Sending cmd buffer: {:?}", &buf);
        let mut report = [0u8; 9];
        report[0] = 0x00;
        report[1..9].copy_from_slice(&buf);

        match dev.write(&report) {
            Ok(n) => println!("dev.write (report ID 0) wrote {} bytes", n),
            Err(e) => {
                println!("dev.write (report ID 0) error: {:?}", e);
                match dev.write(&buf) {
                    Ok(n2) => println!("dev.write (raw 8) wrote {} bytes", n2),
                    Err(e2) => println!("dev.write (raw 8) error: {:?}", e2),
                }
            }
        }

        let mut read_buf = [0u8; 64];
        match dev.read_timeout(&mut read_buf, 2000) {
            Ok(n) => {
                println!("dev.read_timeout read {} bytes: {:?}", n, &read_buf[..n]);
                if let Ok(s) = std::str::from_utf8(&read_buf[..n]) {
                    println!("Response str: {}", s);
                }
            }
            Err(e) => println!("dev.read_timeout error: {:?}", e),
        }
    } else {
        println!("Could not open 0665:5161 (might be locked by ViewPower service)");
    }
}
