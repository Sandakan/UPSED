import { invoke } from '@tauri-apps/api/core';
import {
  AuthStatus,
  DiscoveredDevice,
  EventLogRecord,
  OutletState,
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
  TuyaBridgeConfig,
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

  getDeviceStatus: (portName: string, upsId?: string) =>
    invoke<Q1Status>('get_device_status', { portName, upsId: upsId || null }),

  getOutletStates: (upsId?: string, portName?: string) =>
    invoke<OutletState[]>('get_outlet_states', { upsId: upsId || null, portName: portName || null }),

  sendCommand: (portName: string, command: VoltronicCommand, upsId?: string) =>
    invoke<string>('send_command', { portName, command, upsId: upsId || null }),

  authStatus: () => invoke<AuthStatus>('auth_status'),

  authSetup: (username: string, password: string) =>
    invoke<void>('auth_setup', { username, password }),

  authLogin: (username: string, password: string) =>
    invoke<void>('auth_login', { username, password }),

  authLogout: () => invoke<void>('auth_logout'),

  authChangePassword: (oldPassword: string, newPassword: string) =>
    invoke<void>('auth_change_password', { oldPassword, newPassword }),

  authReset: () => invoke<void>('auth_reset'),

  getSafetyStage: (upsId?: string) =>
    invoke<UnlockStage>('get_safety_stage', { upsId: upsId || null }),

  unlockSafetyStage: (targetStage: UnlockStage, upsId?: string) =>
    invoke<void>('unlock_safety_stage', { targetStage, upsId: upsId || null }),

  getRecentTelemetry: (portOrUpsId?: string, limit?: number, upsId?: string) => {
    const effectiveUpsId = upsId || (portOrUpsId && !portOrUpsId.startsWith('COM') && !portOrUpsId.startsWith('USB:') && !portOrUpsId.startsWith('BRIDGE:') ? portOrUpsId : null);
    const effectivePort = portOrUpsId && (portOrUpsId.startsWith('COM') || portOrUpsId.startsWith('USB:') || portOrUpsId.startsWith('BRIDGE:')) ? portOrUpsId : null;
    return invoke<TelemetryRecord[]>('get_recent_telemetry', {
      upsId: effectiveUpsId,
      portName: effectivePort,
      limit,
    });
  },

  getTelemetryRange: (
    portOrUpsId: string,
    startTime: string,
    endTime: string,
    maxPoints?: number,
    upsId?: string
  ) => {
    const effectiveUpsId = upsId || (portOrUpsId && !portOrUpsId.startsWith('COM') && !portOrUpsId.startsWith('USB:') && !portOrUpsId.startsWith('BRIDGE:') ? portOrUpsId : null);
    const effectivePort = portOrUpsId && (portOrUpsId.startsWith('COM') || portOrUpsId.startsWith('USB:') || portOrUpsId.startsWith('BRIDGE:')) ? portOrUpsId : null;
    return invoke<TelemetryRecord[]>('get_telemetry_range', {
      upsId: effectiveUpsId,
      portName: effectivePort,
      startTime,
      endTime,
      maxPoints,
    });
  },

  getRecentEvents: (limit?: number, upsId?: string) =>
    invoke<EventLogRecord[]>('get_recent_events', { limit, upsId: upsId || null }),

  clearEvents: (upsId?: string) =>
    invoke<void>('clear_events', { upsId: upsId || null }),

  acknowledgeEvent: (eventId: number) =>
    invoke<void>('acknowledge_event', { eventId }),

  acknowledgeAllEvents: (upsId?: string) =>
    invoke<number>('acknowledge_all_events', { upsId: upsId || null }),

  getBatteryBridgeStatus: () => invoke<boolean>('get_battery_bridge_status'),

  setBatteryBridgeStatus: (enabled: boolean) =>
    invoke<void>('set_battery_bridge_status', { enabled }),

  getUpsMetadata: (
    uniqueId: string,
    bridgeMac?: string | null,
    usbUuid?: string | null,
    hardwareSignature?: string | null
  ) =>
    invoke<UpsMetadata | null>('get_ups_metadata', {
      uniqueId,
      bridgeMac: bridgeMac || null,
      usbUuid: usbUuid || null,
      hardwareSignature: hardwareSignature || null,
    }),

  linkTransportToProfile: (
    uniqueId: string,
    bridgeMac?: string | null,
    usbUuid?: string | null,
    hardwareSignature?: string | null
  ) =>
    invoke<void>('link_transport_to_profile', {
      uniqueId,
      bridgeMac: bridgeMac || null,
      usbUuid: usbUuid || null,
      hardwareSignature: hardwareSignature || null,
    }),

  getDisambiguationCandidates: (hardwareSignature: string) =>
    invoke<UpsMetadata[]>('get_disambiguation_candidates', { hardwareSignature }),

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
  pruneTelemetry: (olderThanDays: number, upsId?: string) =>
    invoke<number>('prune_telemetry', { olderThanDays, upsId: upsId || null }),
  clearTelemetry: (upsId?: string) =>
    invoke<number>('clear_telemetry', { upsId: upsId || null }),
  deleteUpsProfile: (uniqueId: string) =>
    invoke<void>('delete_ups_profile', { uniqueId }),
  setPrimaryUps: (uniqueId: string) =>
    invoke<void>('set_primary_ups', { uniqueId }),
  vacuumDatabase: () => invoke<void>('vacuum_database'),

  getBridgeStatus: (portName?: string) =>
    invoke<BridgeStatus | null>('get_bridge_status', { portName }),

  configureBridgeWifi: (ssid: string, password: string, portName?: string) =>
    invoke<BridgeStatus>('configure_bridge_wifi', { portName, ssid, password }),

  scanBridgeWifi: (portName?: string) =>
    invoke<WifiScanNetwork[]>('scan_bridge_wifi', { portName }),

  syncBridgeBacklog: (portName?: string, upsId?: string) =>
    invoke<number>('sync_bridge_backlog', { portName: portName || null, upsId: upsId || null }),

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

  getBridgeTuyaConfig: (portName?: string) =>
    invoke<TuyaBridgeConfig>('get_bridge_tuya_config', { portName }),

  setBridgeTuyaConfig: (config: TuyaBridgeConfig, portName?: string) =>
    invoke<TuyaBridgeConfig>('set_bridge_tuya_config', { portName, config }),

  testBridgeTuyaPublish: (portName?: string) =>
    invoke<TuyaBridgeConfig>('test_bridge_tuya_publish', { portName }),
};



