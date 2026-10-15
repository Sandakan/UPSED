use upsed_lib::protocol::ProtocolError;
use upsed_lib::serial::SerialTransport;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
#[allow(dead_code)]
pub struct MockSerialPort {
    port_name: String,
    responses: HashMap<String, String>,
    sent_commands: Arc<Mutex<Vec<String>>>,
    inject_timeout: bool,
    inject_corrupt: bool,
    fail_count: Arc<Mutex<u32>>,
}

#[allow(dead_code)]
impl MockSerialPort {
    pub fn new(port_name: &str) -> Self {
        Self {
            port_name: port_name.to_string(),
            responses: HashMap::new(),
            sent_commands: Arc::new(Mutex::new(Vec::new())),
            inject_timeout: false,
            inject_corrupt: false,
            fail_count: Arc::new(Mutex::new(0)),
        }
    }

    pub fn with_response(mut self, cmd: &str, response: &str) -> Self {
        self.responses.insert(cmd.to_string(), response.to_string());
        self
    }

    pub fn with_axpert_golden_responses(port_name: &str) -> Self {
        let mut mock = Self::new(port_name);
        mock.responses.insert("QPI".into(), "(PI17".into());
        mock.responses.insert(
            "Q1".into(),
            "(238.0 50.0 238.0 50.0 023 0230 025.4 45 00110000".into(),
        );
        mock.responses.insert(
            "QPIGS".into(),
            "(238.0 50.0 238.0 50.0 0230 0230 023 380 25.4 010 085 0045".into(),
        );
        mock.responses.insert(
            "QPIWS".into(),
            "(0000000000000000000000000000000000000000000000000".into(),
        );
        mock.responses.insert(
            "QPIRI".into(),
            "(230.0 21.7 230.0 50.0 21.7 5000 5000 48.0 000 060".into(),
        );
        mock.responses.insert("QID".into(), "(9293311030000".into());
        mock.responses.insert("QVFW".into(), "(VERFW:00072.10".into());
        mock.responses.insert("Q".into(), "(OK".into());
        mock.responses.insert("BUZZER".into(), "(OK".into());
        mock.responses.insert("BZON".into(), "(ACK".into());
        mock.responses.insert("BZOFF".into(), "(ACK".into());
        mock.responses.insert("TL".into(), "(ACK".into());
        mock.responses.insert("QS".into(), "(238.0 50.0 238.0 50.0 023 0230 025.4 45 00110000".into());
        mock.responses.insert("QMOD".into(), "(L".into());
        mock.responses.insert("QFLAG".into(), "(EpbrsghczDoavefm".into());
        mock.responses.insert("QBV".into(), "(027.1 02 01 095 037".into());
        // NOTE: QGS/QWS/QRI/QMD/QHE/QBYV/QBYF/QBV/QFLAG/QMOD are real captures from a Protocol 01 unit. QFS/QBTAH/QSK are placeholders. The command
        // mnemonics are verified, but their response layouts are not yet
        // extracted (see docs/protocol-spec.md), so tests must not parse them.
        mock.responses.insert("T".into(), "(OK".into());
        mock.responses.insert("T05".into(), "(OK".into());
        mock.responses.insert("CT".into(), "(OK".into());
        // P-series read-only queries
        mock.responses.insert("QGS".into(), "(230.2 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 100000000001".into());
        mock.responses.insert("QWS".into(), "(0000000000000000000000000000000000000000000000000000000000000000".into());
        mock.responses.insert("QRI".into(), "(230.0 004 024.0 50.0".into());
        mock.responses.insert("QMD".into(), "(#######WPHVT1K0 ###1000 90 1/1 230 230 02 12.0".into());
        mock.responses.insert("QFS".into(), "(OK".into());
        mock.responses.insert("QHE".into(), "(242 218".into());
        mock.responses.insert("QBYV".into(), "(264 180".into());
        mock.responses.insert("QBYF".into(), "(53.0 47.0".into());
        mock.responses.insert("QBTAH".into(), "(009".into());
        mock.responses.insert("QSK1".into(), "(1".into());
        mock.responses.insert("QSK2".into(), "(1".into());
        // P-series config writes
        mock.responses.insert("PHV260".into(), "(ACK".into());
        mock.responses.insert("PLV190".into(), "(ACK".into());
        mock.responses.insert("PGF53.0".into(), "(ACK".into());
        mock.responses.insert("PSF47.0".into(), "(ACK".into());
        mock.responses.insert("HEH253".into(), "(ACK".into());
        mock.responses.insert("HEL190".into(), "(ACK".into());
        mock.responses.insert("MD0030".into(), "(ACK".into());
        mock.responses.insert("PEA".into(), "(ACK".into());
        mock.responses.insert("PDA".into(), "(ACK".into());
        // P-series power control
        mock.responses.insert("S.3".into(), "(ACK".into());
        mock.responses.insert("S05".into(), "(ACK".into());
        mock.responses.insert("S.3R0002".into(), "(ACK".into());
        mock.responses.insert("CS".into(), "(OK".into());
        mock.responses.insert("SON".into(), "(ACK".into());
        mock.responses.insert("SOFF".into(), "(ACK".into());
        mock.responses.insert("SKON1".into(), "(ACK".into());
        mock.responses.insert("SKOFF1".into(), "(ACK".into());
        mock
    }

    pub fn inject_timeout(mut self) -> Self {
        self.inject_timeout = true;
        self
    }

    pub fn inject_corrupt(mut self) -> Self {
        self.inject_corrupt = true;
        self
    }

    pub fn fail_next_n(self, count: u32) -> Self {
        *self.fail_count.lock().unwrap() = count;
        self
    }

    pub fn sent_commands(&self) -> Vec<String> {
        self.sent_commands.lock().unwrap().clone()
    }

    pub fn last_sent(&self) -> Option<String> {
        self.sent_commands.lock().unwrap().last().cloned()
    }
}

impl SerialTransport for MockSerialPort {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError> {
        self.sent_commands.lock().unwrap().push(cmd_str.to_string());

        let mut fails = self.fail_count.lock().unwrap();
        if *fails > 0 {
            *fails -= 1;
            return Err(ProtocolError::Timeout);
        }

        if self.inject_timeout {
            return Err(ProtocolError::Timeout);
        }

        if self.inject_corrupt {
            return Ok("CORRUPT_WITHOUT_PARENTHESIS".into());
        }

        if let Some(resp) = self.responses.get(cmd_str) {
            Ok(resp.clone())
        } else {
            // Unrecognized command returns NAK like real Voltronic hardware
            Ok("(NAK".into())
        }
    }

    fn port_name(&self) -> &str {
        &self.port_name
    }
}
