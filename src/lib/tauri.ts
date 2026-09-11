import { invoke } from '@tauri-apps/api/core';
import {
  DiscoveredDevice,
  EventLogRecord,
  Q1Status,
  TelemetryRecord,
  UnlockStage,
  VoltronicCommand,
  UpsMetadata,
} from './types';

export const api = {
  scanPorts: () => invoke<DiscoveredDevice[]>('scan_ports'),

  connectDevice: (portName: string, baudRate?: number) =>
    invoke<DiscoveredDevice>('connect_device', {
      portName,
      baudRate: baudRate || 2400,
    }),

  disconnectDevice: (portName: string) =>
    invoke<void>('disconnect_device', { portName }),

  listConnectedDevices: () =>
    invoke<DiscoveredDevice[]>('list_connected_devices'),

  getDeviceStatus: (portName: string) =>
    invoke<Q1Status>('get_device_status', { portName }),

  sendCommand: (portName: string, command: VoltronicCommand) =>
    invoke<string>('send_command', { portName, command }),

  getSafetyStage: () => invoke<UnlockStage>('get_safety_stage'),

  unlockSafetyStage: (targetStage: UnlockStage) =>
    invoke<void>('unlock_safety_stage', { targetStage }),

  getRecentTelemetry: (portName: string, limit?: number) =>
    invoke<TelemetryRecord[]>('get_recent_telemetry', { portName, limit }),

  getRecentEvents: (limit?: number) =>
    invoke<EventLogRecord[]>('get_recent_events', { limit }),

  clearEvents: () => invoke<void>('clear_events'),

  acknowledgeEvent: (eventId: number) =>
    invoke<void>('acknowledge_event', { eventId }),

  getBatteryBridgeStatus: () => invoke<boolean>('get_battery_bridge_status'),

  setBatteryBridgeStatus: (enabled: boolean) =>
    invoke<void>('set_battery_bridge_status', { enabled }),

  getUpsMetadata: (uniqueId: string) =>
    invoke<UpsMetadata | null>('get_ups_metadata', { uniqueId }),

  saveUpsMetadata: (metadata: UpsMetadata) =>
    invoke<void>('save_ups_metadata', { metadata }),

  listUpsMetadata: () => invoke<UpsMetadata[]>('list_ups_metadata'),

  getLastConnectedDevice: () => invoke<string | null>('get_last_connected_device'),

  setLastConnectedDevice: (uniqueId: string) =>
    invoke<void>('set_last_connected_device', { uniqueId }),

  updateDeviceUsbUuid: (uniqueId: string, newUsbUuid: string, updatedAt: string) =>
    invoke<void>('update_device_usb_uuid', { uniqueId, newUsbUuid, updatedAt }),

  fastProbeDevice: (portName: string) =>
    invoke<DiscoveredDevice | null>('fast_probe_device', { portName }),

  getPollInterval: () => invoke<number>('get_poll_interval'),

  setPollInterval: (secs: number) =>
    invoke<void>('set_poll_interval', { secs }),

  getCloseToMinimize: () => invoke<boolean>('get_close_to_minimize'),

  setCloseToMinimize: (enabled: boolean) =>
    invoke<void>('set_close_to_minimize', { enabled }),

  getStartMinimized: () => invoke<boolean>('get_start_minimized'),

  setStartMinimized: (enabled: boolean) =>
    invoke<void>('set_start_minimized', { enabled }),
};


