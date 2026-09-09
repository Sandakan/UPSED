use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ProtocolError {
    #[error("Command encoding failed: {0}")]
    EncodingError(String),

    #[error("Response does not start with '(' prefix: {0}")]
    InvalidResponsePrefix(String),

    #[error("Device returned NAK (command rejected by hardware)")]
    CommandNak,

    #[error("Timeout waiting for response from UPS")]
    Timeout,

    #[error("IO error during serial communication: {0}")]
    IoError(String),

    #[error("Response parsing error: {0}")]
    ParseError(String),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    #[error("Device communication error: {0}")]
    DeviceError(String),
}

/// Encodes a Voltronic command to ASCII bytes with a trailing carriage return `\r`.
pub fn encode_command(cmd_str: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(cmd_str.len() + 1);
    bytes.extend_from_slice(cmd_str.as_bytes());
    bytes.push(b'\r');
    bytes
}

/// Decodes raw bytes received from the UPS into a clean response string.
/// Checks that the response begins with '(' and strips any trailing '\r' or '\n'.
pub fn decode_response(raw: &[u8]) -> Result<String, ProtocolError> {
    if raw.is_empty() {
        return Err(ProtocolError::ParseError("Empty response from device".into()));
    }

    let raw_str = std::str::from_utf8(raw)
        .map_err(|e| ProtocolError::ParseError(format!("Invalid UTF-8 in response: {}", e)))?;

    let trimmed = raw_str.trim_matches(|c| c == '\r' || c == '\n');

    if !trimmed.starts_with('(') {
        return Err(ProtocolError::InvalidResponsePrefix(trimmed.to_string()));
    }

    if trimmed == "(NAK" {
        return Err(ProtocolError::CommandNak);
    }

    Ok(trimmed.to_string())
}

