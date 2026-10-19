export type UnlockStage =
  | 'T1ReadOnly'
  | 'T2NonDestructive'
  | 'T3ConfigWrite'
  | 'T4PowerControl';

export interface DeviceCapabilities {
  protocol_id: string;
  supports_qpigs: boolean;
  supports_qpiws: boolean;
  supports_outlets: boolean;
  supports_bypass_control: boolean;
  supports_deep_battery_test: boolean;
  supports_modbus: boolean;
}

export interface DiscoveredDevice {
  port_name: string;
  protocol_id: string;
  serial_number?: string | null;
  unique_id: string;
  firmware_version?: string | null;
  usb_uuid?: string | null;
  capabilities: DeviceCapabilities;
}

export interface UpsMetadata {
  unique_id: string;
  name: string;
  usb_uuid?: string | null;
  rated_va: number;
  power_factor: number;
  rated_watts: number;
  battery_voltage: number;
  battery_capacity_ah: number;
  battery_chemistry: 'VRLA_SLA' | 'GEL' | 'LIFEPO4' | string;
  topology: 'Online' | 'LineInteractive' | 'OffLine' | string;
  updated_at: string;
}

export interface Q1Status {
  grid_voltage_v: number;
  grid_frequency_hz: number;
  output_voltage_v: number;
  output_frequency_hz: number;
  output_load_pct: number;
  output_watts: number;
  battery_voltage_v: number;
  temperature_c: number;
  utility_fail: boolean;
  battery_low: boolean;
  bypass_active: boolean;
  ups_failed: boolean;
  test_in_progress?: boolean;
  beeper_on?: boolean;
  raw_status_bits: string;
}

export interface TelemetryRecord {
  id?: number;
  timestamp: string;
  port_name: string;
  grid_voltage: number;
  output_voltage: number;
  grid_frequency?: number;
  output_frequency?: number;
  load_pct: number;
  output_watts?: number;
  battery_voltage: number;
  temperature_c: number;
}

export type EventSeverity = 'critical' | 'warning' | 'info' | 'success';

export interface EventLogRecord {
  id?: number;
  timestamp: string;
  port_name: string;
  event_type: string;
  severity: EventSeverity;
  message: string;
  acknowledged?: boolean;
}

export type VoltronicCommand =
  | { type: 'QueryProtocolId' }
  | { type: 'QuickStatus' }
  | { type: 'QueryStatusQs' }
  | { type: 'QueryGeneralStatus' }
  | { type: 'QueryWarningStatus' }
  | { type: 'QueryRatingInfo' }
  | { type: 'QueryWorkingMode' }
  | { type: 'QueryFlags' }
  | { type: 'QueryDeviceId' }
  | { type: 'QueryFirmwareVersion' }
  | { type: 'QueryBatteryVoltage' }
  | { type: 'QueryPStatus' }
  | { type: 'QueryPWarning' }
  | { type: 'QueryPRating' }
  | { type: 'QueryModel' }
  | { type: 'QueryFaultStatus' }
  | { type: 'QueryEcoWindow' }
  | { type: 'QueryBypassVoltage' }
  | { type: 'QueryBypassFrequency' }
  | { type: 'QueryBatteryCapacity' }
  | { type: 'QueryOutletState'; payload: { group: number } }
  | { type: 'BuzzerToggle' }
  | { type: 'BuzzerOn' }
  | { type: 'BuzzerOff' }
  | { type: 'TenSecondTest' }
  | { type: 'CancelTest' }
  | { type: 'TestForMinutes'; payload: number }
  | { type: 'TestUntilLow' }
  | { type: 'SetBypassHighVoltage'; payload: number }
  | { type: 'SetBypassLowVoltage'; payload: number }
  | { type: 'SetBypassHighFrequency'; payload: number }
  | { type: 'SetBypassLowFrequency'; payload: number }
  | { type: 'SetEcoHigh'; payload: number }
  | { type: 'SetEcoLow'; payload: number }
  | { type: 'SetMaxBackupMinutes'; payload: number }
  | { type: 'SetAlarmEnabled'; payload: boolean }
  | { type: 'ShutdownWithDelay'; payload: { minutes: number } }
  | { type: 'ShutdownAndRestore'; payload: { minutes: number; restore_minutes: number } }
  | { type: 'CancelShutdown' }
  | { type: 'OutputOn' }
  | { type: 'OutputOff' }
  | { type: 'OutletOn'; payload: { group: number } }
  | { type: 'OutletOff'; payload: { group: number } };

export type ThemeMode = 'system' | 'dark' | 'light';

export interface ProbeStatusEvent {
  phase: 'scanning' | 'connecting' | 'fetching' | 'idle' | 'no_device' | 'error';
  message: string;
  port_name?: string | null;
  device_name?: string | null;
}

export interface OutageInterval {
  start: string;
  end: string;
  rawStart?: string;
  rawEnd?: string;
  startIndex?: number;
  endIndex?: number;
  isActive?: boolean;
}

export interface DbStats {
  file_size_bytes: number;
  wal_size_bytes: number;
  telemetry_count: number;
  events_count: number;
  oldest_telemetry?: string | null;
  newest_telemetry?: string | null;
}

export interface BridgeStatus {
  bridge: string;
  fw: string;
  mac: string;
  mode: 'proxy' | 'standalone' | string;
  wifi_connected: boolean;
  ssid: string;
  ip: string;
  hostname: string;
  ws_port: number;
  rssi: number;
  wifi_last_error?: string;
  log_seq?: number;
  backlog_records: number;
  backlog_capacity: number;
  psram_active: boolean;
  psram_free: number;
  uptime_sec: number;
  active_transport: 'usb' | 'websocket' | string;
}

export interface WifiScanNetwork {
  ssid: string;
  rssi: number;
  open: boolean;
  channel: number;
}

export interface WsTestResult {
  reachable: boolean;
  host: string;
  port: number;
  latency_ms: number;
  status?: BridgeStatus | null;
  error?: string | null;
}

export interface BridgeLogEntry {
  seq: number;
  ms: number;
  level: string;
  msg: string;
  timestamp: string;
  source: string;
}

export interface TransportStatusEvent {
  port_name: string;
  active_transport: 'usb' | 'websocket';
  ip?: string | null;
  host?: string | null;
}

export interface WifiProvisionStatusEvent {
  phase: 'saving' | 'reconnecting' | 'connected' | 'rollback' | 'failed';
  ssid: string;
  ip?: string | null;
  error?: string | null;
}



