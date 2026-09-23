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
  | { type: 'BuzzerToggle' }
  | { type: 'TenSecondTest' }
  | { type: 'CancelTest' }
  | { type: 'SetChargeCurrentAmps'; payload: number }
  | { type: 'SetBypassHighVoltage'; payload: number }
  | { type: 'SetBypassLowVoltage'; payload: number }
  | { type: 'SetBatteryLowShutdownVoltage'; payload: number }
  | { type: 'ShutdownWithDelay'; payload: { minutes: number } }
  | { type: 'CancelShutdown' }
  | { type: 'OutletOn'; payload: { group: number; delay_minutes: number } }
  | { type: 'OutletOff'; payload: { group: number; delay_minutes: number } };

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
  isActive?: boolean;
}


