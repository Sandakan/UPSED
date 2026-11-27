# Testing Strategy

> Back to [README](../README.md)

UPSED includes an in-memory mock-hardware test suite in `src-tauri/tests/`:

- `auth_tests.rs`: Validates Argon2id hashing, session expiration, brute-force lockout, and OS-auth integration.
- `battery_bridge_tests.rs`: Confirms that the OS battery bridge remains strictly disabled by default and validates tray icon RGBA generation.
- `concurrency_tests.rs`: Verifies multi-port isolation and independent device polling.
- `monitor_tests.rs`: Verifies application settings persistence, watch channel interval updates, and legacy SQLite database migration.
- `p_series_parser_tests.rs`: Validates P-series protocol parsing and command encoding.
- `protocol_catalog_tests.rs`: Verifies cataloged wire strings and protocol-aware encoding rejection.
- `security_and_gate_tests.rs`: Verifies that no arbitrary raw string commands can be passed, stages cannot be bypassed, and rising-edge events trigger accurately.
- `stage_t1_hid_tests.rs`: Tests USB HID candidate detection, VID matching, and null-padded frame decoding.
- `stage_t1_tests.rs`: Validates Q1, QPIGS, QPIWS, QID, QVFW, QPIRI parsing, timeout handling, and read-only gating.
- `stage_t2_tests.rs`: Tests buzzer toggle and 10s battery test commands and gate enforcement.
- `stage_t3_tests.rs`: Tests parameter validation (charge current, voltage windows, battery floors).
- `stage_t4_tests.rs`: Tests shutdown and outlet delay validation.

## Run All Tests

```bash
cd src-tauri
cargo test
```

*All active unit and mock-hardware tests across the 12 integration suites and library unit tests must pass with 0 failures (live-hardware HID tests are `#[ignore]`d by default).*
