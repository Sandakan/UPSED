use crate::protocol::{decode_response, encode_command, ProtocolError};
use std::io::{Read, Write};
use std::time::Duration;

/// An abstract serial transport interface allowing both real hardware and in-memory test mocks.
pub trait SerialTransport: Send {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError>;
    fn port_name(&self) -> &str;
}

pub struct PhysicalSerialPort {
    port_name: String,
    port: Box<dyn serialport::SerialPort>,
    timeout: Duration,
}

impl PhysicalSerialPort {
    pub fn open(port_name: &str, baud_rate: u32) -> Result<Self, ProtocolError> {
        let timeout = Duration::from_millis(1000);
        let port = serialport::new(port_name, baud_rate)
            .timeout(timeout)
            .open()
            .map_err(|e| ProtocolError::IoError(format!("Failed to open port {}: {}", port_name, e)))?;

        Ok(Self {
            port_name: port_name.to_string(),
            port,
            timeout,
        })
    }
}

impl SerialTransport for PhysicalSerialPort {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError> {
        let raw_cmd = encode_command(cmd_str);
        self.port
            .write_all(&raw_cmd)
            .map_err(|e| ProtocolError::IoError(format!("Write failed: {}", e)))?;
        self.port
            .flush()
            .map_err(|e| ProtocolError::IoError(format!("Flush failed: {}", e)))?;

        let mut buffer = [0u8; 64];
        let mut total_read = 0;
        let start = std::time::Instant::now();

        // Read until '\r' or buffer is full, respecting timeout
        while start.elapsed() < self.timeout && total_read < buffer.len() {
            let mut byte = [0u8; 1];
            match self.port.read(&mut byte) {
                Ok(1) => {
                    buffer[total_read] = byte[0];
                    total_read += 1;
                    if byte[0] == b'\r' {
                        break;
                    }
                }
                Ok(0) => std::thread::sleep(Duration::from_millis(10)),
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
                Err(e) => return Err(ProtocolError::IoError(format!("Read error: {}", e))),
            }
        }

        if total_read == 0 {
            return Err(ProtocolError::Timeout);
        }

        decode_response(&buffer[..total_read])
    }

    fn port_name(&self) -> &str {
        &self.port_name
    }
}
