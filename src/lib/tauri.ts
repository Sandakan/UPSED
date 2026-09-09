import { invoke } from '@tauri-apps/api/core';
import {
  DiscoveredDevice,
  EventLogRecord,
  Q1Status,
  TelemetryRecord,
  UnlockStage,
  VoltronicCommand,
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

  getBatteryBridgeStatus: () => invoke<boolean>('get_battery_bridge_status'),

  setBatteryBridgeStatus: (enabled: boolean) =>
    invoke<void>('set_battery_bridge_status', { enabled }),
};

