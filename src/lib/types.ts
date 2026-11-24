export type UnlockStage =
  | 'T1ReadOnly'
  | 'T2NonDestructive'
  | 'T3ConfigWrite'
  | 'T4PowerControl';

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  username?: string | null;
  os_auth_available: boolean;
  auth_method: 'os_native' | 'password_fallback';
  provider_name: string;
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
  record?: TelemetryRecord;
  bucket_committed?: boolean;
}

export type TransportMedium = 'wifi' | 'usb' | 'bridge' | 'serial' | 'unknown';
export type UpsOperatingState = 'Online' | 'Battery' | 'Bypass' | 'Testing' | 'Fault' | 'Offline' | 'Reconnecting';

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

export interface BridgeClientInfo {
  id: string;
  medium: 'websocket' | 'usb' | string;
  ip: string;
  connected_sec: number;
  req_count: number;
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
  backlog_oldest_ts?: number;
  backlog_newest_ts?: number;
  backlog_latest_seq?: number;
  psram_active: boolean;
  psram_free: number;
  uptime_sec: number;
  active_transport: 'usb' | 'websocket' | string;
  min_supported_fw?: string;
  is_compatible?: boolean;
  tuya_enabled?: boolean;
  tuya_connected?: boolean;
  tuya_state?: 'disabled' | 'waiting_ntp' | 'connecting' | 'connected' | 'retrying' | 'auth_failed' | string;
  tuya_retry_count?: number;
  tuya_next_retry_sec?: number;
  tuya_region?: string;
  tuya_last_error?: string;

  // Real-Time Clock (RTC) Telemetry
  rtc_ts?: number;
  rtc_iso?: string;
  time_synced?: boolean;
  time_source?: string;
  tz_offset_min?: number;

  // Multi-Client Telemetry
  ws_clients?: number;
  usb_client_active?: boolean;
  connected_clients?: BridgeClientInfo[];

  // Command Cache Telemetry
  cache_hits?: number;
  cache_misses?: number;
  cache_entries?: number;
  cache_capacity?: number;
  cache_ttl_ms?: number;

  // Hardware LED Illumination Policy
  night_mode_active?: boolean;
  night_mode_enabled?: boolean;
  night_mode_type?: 'dimmed' | 'off' | string;
  night_dim_pct?: number;
  night_wake_alert?: boolean;
  night_start_min?: number;
  night_end_min?: number;
  night_override?: number;
  proxy_stealth_active?: boolean;
  proxy_stealth_enabled?: boolean;
  proxy_stealth_type?: 'dimmed' | 'off' | string;
  proxy_stealth_dim_pct?: number;
}

export interface BridgeIlluminationConfig {
  night_enabled: boolean;
  night_type: 'dimmed' | 'off';
  night_dim_pct: number;
  night_wake_alert: boolean;
  night_start_min: number;
  night_end_min: number;
  stealth_enabled: boolean;
  stealth_type: 'dimmed' | 'off';
  stealth_dim_pct: number;
}

export interface TuyaBridgeConfig {
  enabled: boolean;
  region: 'eu' | 'us' | 'cn' | 'in' | string;
  broker?: string;
  product_id: string;
  device_id: string;
  device_secret: string;
  has_secret?: boolean;
  off_mode: 'SOFF' | 'S.2' | string;
  interlock_pct: number;
  connected?: boolean;
  state?: 'disabled' | 'waiting_ntp' | 'connecting' | 'connected' | 'retrying' | 'auth_failed' | string;
  retry_count?: number;
  next_retry_sec?: number;
  last_error?: string;
  output_enabled?: boolean;
  pc_online?: boolean;
  published?: boolean;
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
  expected_sha256?: string | null;
  local_binary_path?: string | null;
  local_binary_size?: number | null;
  local_binary_modified?: string | null;
  local_binary_version?: string | null;
}

export interface OtaProgressEvent {
  phase: 'downloading' | 'leasing' | 'uploading' | 'rebooting' | 'success' | 'error';
  percentage: number;
  bytes_transferred: number;
  total_bytes: number;
  message: string;
}

export interface BridgeCmdExecutedEvent {
  cmd: string;
  source: string;
  ts: number;
}

export interface BridgeStateChangedEvent {
  raw: string;
  reason: string;
  is_urgent?: boolean;
  ts?: number;
}



