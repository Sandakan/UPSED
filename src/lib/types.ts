export type UnlockStage =
  | 'T1ReadOnly'
  | 'T2NonDestructive'
  | 'T3ConfigWrite'
  | 'T4PowerControl';

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username?: string | null;
}

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
  bridge_mac?: string | null;
  hardware_signature?: string | null;
  capabilities: DeviceCapabilities;
}

export interface UpsMetadata {
  unique_id: string;
  name: string;
  usb_uuid?: string | null;
  bridge_mac?: string | null;
  hardware_signature?: string | null;
  rated_va: number;
  power_factor: number;
  rated_watts: number;
  battery_voltage: number;
  battery_capacity_ah: number;
  battery_chemistry: 'VRLA_SLA' | 'GEL' | 'LIFEPO4' | string;
  topology: 'Online' | 'LineInteractive' | 'OffLine' | string;
  poll_interval_secs?: number;
  bridge_ws_host?: string | null;
  last_port?: string | null;
  is_primary?: boolean;
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
  shutdown_active?: boolean;
  beeper_on?: boolean;
  raw_status_bits: string;
}

export interface OutletState {
  group: number;
  on: boolean;
}

const P_SERIES_FAMILIES = new Set([
  '00', '01', '02', '03', '05', '08', '09', '10', '13', '14', '31', '33', '35', '39', '44',
  '45', '71', '73', '74', '99',
]);

export function isPSeries(protocolId?: string | null): boolean {
  if (!protocolId) return false;
  const id = protocolId.trim().replace(/^[Pp]/, '');
  return P_SERIES_FAMILIES.has(id);
}

export interface UpsTelemetryPayload {
  ups_id?: string | null;
  port_name: string;
  status: Q1Status;
}

export type TransportMedium = 'wifi' | 'usb' | 'bridge' | 'serial' | 'unknown';
export type UpsOperatingState = 'Online' | 'Battery' | 'Bypass' | 'Testing' | 'Fault' | 'Offline';

export interface TelemetryRecord {
  id?: number;
  timestamp: string;
  ups_id: string;
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
  ups_id?: string | null;
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
  min_supported_fw?: string;
  is_compatible?: boolean;
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

export interface BridgeFirmwareCheckResult {
  current_version: string;
  latest_version?: string | null;
  update_available: boolean;
  release_notes?: string | null;
  published_at?: string | null;
  download_url?: string | null;
  binary_size?: number | null;
  local_binary_path?: string | null;
  local_binary_size?: number | null;
  local_binary_modified?: string | null;
}

export interface OtaProgressEvent {
  phase: 'downloading' | 'leasing' | 'uploading' | 'rebooting' | 'success' | 'error';
  percentage: number;
  bytes_transferred: number;
  total_bytes: number;
  message: string;
}



