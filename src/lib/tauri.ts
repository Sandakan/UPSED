import { invoke } from '@tauri-apps/api/core';
import {
  DiscoveredDevice,
  EventLogRecord,
  Q1Status,
  TelemetryRecord,
  UnlockStage,
  VoltronicCommand,
  UpsMetadata,
  ThemeMode,
  DbStats,
  BridgeStatus,
  WifiScanNetwork,
  WsTestResult,
  BridgeLogEntry,
  BridgeFirmwareCheckResult,
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

  getTelemetryRange: (
    portName: string,
    startTime: string,
    endTime: string,
    maxPoints?: number
  ) =>
    invoke<TelemetryRecord[]>('get_telemetry_range', {
      portName,
      startTime,
      endTime,
      maxPoints,
    }),

  getRecentEvents: (limit?: number) =>
    invoke<EventLogRecord[]>('get_recent_events', { limit }),

  clearEvents: () => invoke<void>('clear_events'),

  acknowledgeEvent: (eventId: number) =>
    invoke<void>('acknowledge_event', { eventId }),

  acknowledgeAllEvents: () => invoke<number>('acknowledge_all_events'),

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

  getTheme: () => invoke<ThemeMode>('get_theme'),

  setTheme: (theme: ThemeMode) =>
    invoke<void>('set_theme', { theme }),

  isDevMode: () => invoke<boolean>('is_dev_mode'),
  getDbStats: () => invoke<DbStats>('get_db_stats'),
  pruneTelemetry: (olderThanDays: number) =>
    invoke<number>('prune_telemetry', { olderThanDays }),
  clearTelemetry: () => invoke<number>('clear_telemetry'),
  vacuumDatabase: () => invoke<void>('vacuum_database'),

  getBridgeStatus: (portName?: string) =>
    invoke<BridgeStatus | null>('get_bridge_status', { portName }),

  configureBridgeWifi: (ssid: string, password: string, portName?: string) =>
    invoke<BridgeStatus>('configure_bridge_wifi', { portName, ssid, password }),

  scanBridgeWifi: (portName?: string) =>
    invoke<WifiScanNetwork[]>('scan_bridge_wifi', { portName }),

  syncBridgeBacklog: (portName?: string) =>
    invoke<number>('sync_bridge_backlog', { portName }),

  clearBridgeBacklog: (portName?: string) =>
    invoke<boolean>('clear_bridge_backlog', { portName }),

  testBridgeWebsocket: (host: string) =>
    invoke<WsTestResult>('test_bridge_websocket', { host }),

  discoverBridgeOnLan: () =>
    invoke<Array<[string, BridgeStatus]>>('discover_bridge_on_lan'),

  getBridgeLogHistory: () =>
    invoke<BridgeLogEntry[]>('get_bridge_log_history'),

  getBridgeFallbackHost: () => invoke<string>('get_bridge_fallback_host'),

  setBridgeFallbackHost: (host: string) =>
    invoke<void>('set_bridge_fallback_host', { host }),

  checkBridgeFirmwareUpdate: (currentVersion: string) =>
    invoke<BridgeFirmwareCheckResult>('check_bridge_firmware_update', { currentVersion }),

  flashBridgeFirmware: (args: {
    portName?: string;
    source: 'github' | 'local' | 'file';
    customPath?: string;
    downloadUrl?: string;
  }) =>
    invoke<string>('flash_bridge_firmware', {
      portName: args.portName,
      source: args.source,
      customPath: args.customPath,
      downloadUrl: args.downloadUrl,
    }),
};



