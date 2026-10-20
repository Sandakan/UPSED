import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { UpsSetupModal } from './components/UpsSetupModal';
import { DeviceConnectModal } from './components/DeviceConnectModal';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { Dashboard } from './pages/Dashboard';
import { Control } from './pages/Control';
import { Config } from './pages/Config';
import { History } from './pages/History';
import { Events } from './pages/Events';
import { IoT } from './pages/IoT';
import { Settings, SettingsHandle } from './pages/Settings';
import { UpsedToaster } from './components/UpsedToaster';
import { AboutModal } from './components/AboutModal';
import { handleIncomingUpsEvent } from './lib/notifications';
import { listen } from '@tauri-apps/api/event';
import { api } from './lib/tauri';
import {
  UpsMetadata,
  EventLogRecord,
  Q1Status,
  TelemetryRecord,
  ProbeStatusEvent,
  TransportStatusEvent,
  DiscoveredDevice,
  UpsTelemetryPayload,
} from './lib/types';
import { useTheme } from './lib/theme';
import { useWindowVisibility } from './lib/useWindowVisibility';

export function App() {
  const { themeMode, setThemeMode } = useTheme();
  const isWindowVisible = useWindowVisibility();
  const queryClient = useQueryClient();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedUpsId, setSelectedUpsId] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, Q1Status>>({});
  const [configuringDevice, setConfiguringDevice] = useState<DiscoveredDevice | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(10);
  const [isSetupModalDismissed, setIsSetupModalDismissed] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [osNotificationsEnabled, setOsNotificationsEnabled] = useState<boolean>(true);
  const [inAppToastsEnabled, setInAppToastsEnabled] = useState<boolean>(true);
  const [showOutageHighlights, setShowOutageHighlights] = useState<boolean>(() => {
    const saved = localStorage.getItem('upsed_show_outage_highlights');
    return saved !== null ? saved === 'true' : true;
  });
  const [downsamplingMaxPoints, setDownsamplingMaxPoints] = useState<number>(() => {
    const saved = localStorage.getItem('upsed_downsampling_max_points');
    return saved !== null ? Number(saved) : 5000;
  });
  const [probeStatus, setProbeStatus] = useState<ProbeStatusEvent | null>(null);
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false);
  const [isModalSaving, setIsModalSaving] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const settingsRef = useRef<SettingsHandle>(null);

  const [activeTransport, setActiveTransport] = useState<'usb' | 'websocket' | null>(null);
  const [transportIp, setTransportIp] = useState<string | null>(null);
  const [bridgeUpdateAvailable, setBridgeUpdateAvailable] = useState(false);
  const [bridgeCompatible, setBridgeCompatible] = useState(true);

  // Check for ESP32 Bridge firmware updates periodically
  useEffect(() => {
    let isMounted = true;
    const checkUpdate = async () => {
      try {
        const st = await api.getBridgeStatus().catch(() => null);
        if (st && st.is_compatible !== undefined) {
          setBridgeCompatible(st.is_compatible);
        }
        const fw = st?.fw || '1.0.0';
        const res = await api.checkBridgeFirmwareUpdate(fw);
        if (isMounted) {
          setBridgeUpdateAvailable(res.update_available);
        }
      } catch {
        // Ignore offline / network check failures
      }
    };

    checkUpdate();
    const interval = setInterval(checkUpdate, 5 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleShowOutageHighlightsChange = (val: boolean) => {
    setShowOutageHighlights(val);
    localStorage.setItem('upsed_show_outage_highlights', String(val));
  };

  const handleDownsamplingMaxPointsChange = (val: number) => {
    setDownsamplingMaxPoints(val);
    localStorage.setItem('upsed_downsampling_max_points', String(val));
  };

  // 1. All saved UPS profiles query
  const {
    data: profiles = [],
    refetch: refetchProfiles,
  } = useQuery({
    queryKey: ['upsProfiles'],
    queryFn: () => api.listUpsMetadata(),
    staleTime: 5000,
  });

  // 1a. Scan serial and USB ports query
  const {
    data: devices = [],
    isFetching: isScanning,
    refetch: scanPorts,
  } = useQuery({
    queryKey: ['ports'],
    queryFn: () => api.scanPorts(),
    staleTime: 60000,
  });

  // 1b. Query connected devices directly from multi-port manager
  const { data: connectedDevices = [] } = useQuery({
    queryKey: ['connectedDevices'],
    queryFn: () => api.listConnectedDevices(),
    refetchInterval: 5000,
  });

  // Combine discovered ports with currently connected devices
  const allDevices: DiscoveredDevice[] = useMemo(() => {
    const list = [...connectedDevices];
    for (const dev of devices) {
      const alreadyPresent = list.some(
        (existing) => existing.port_name === dev.port_name || existing.unique_id === dev.unique_id
      );
      if (!alreadyPresent) {
        list.push(dev);
      }
    }
    return list;
  }, [devices, connectedDevices]);

  // Auto-select primary UPS profile or first available on startup / profile list changes
  useEffect(() => {
    if (profiles.length > 0) {
      if (!selectedUpsId || !profiles.some((p) => p.unique_id === selectedUpsId)) {
        const primary = profiles.find((p) => p.is_primary);
        const fallback = primary ? primary.unique_id : profiles[0].unique_id;
        setSelectedUpsId(fallback);
      }
    }
  }, [profiles, selectedUpsId]);

  // Active profile matching selectedUpsId
  const activeProfile: UpsMetadata | null = useMemo(() => {
    if (!selectedUpsId) return null;
    return profiles.find((p) => p.unique_id === selectedUpsId) || null;
  }, [profiles, selectedUpsId]);

  // Active connected hardware matching selected profile
  const activeDevice: DiscoveredDevice | null = useMemo(() => {
    if (!selectedUpsId && !selectedDevice) {
      return allDevices[0] || null;
    }
    return (
      allDevices.find((d) => d.unique_id === selectedUpsId) ||
      allDevices.find((d) => activeProfile?.last_port && d.port_name === activeProfile.last_port) ||
      allDevices.find((d) => d.port_name === selectedDevice) ||
      null
    );
  }, [allDevices, selectedUpsId, selectedDevice, activeProfile]);

  const effectivePort = activeDevice?.port_name || activeProfile?.last_port || selectedDevice || null;

  // Reset modal dismissed state when active unique_id changes
  useEffect(() => {
    setIsSetupModalDismissed(false);
  }, [selectedUpsId]);

  // Save metadata mutation
  const saveMetadataMutation = useMutation({
    mutationFn: (meta: UpsMetadata) => api.saveUpsMetadata(meta),
    onSuccess: () => {
      refetchProfiles();
      queryClient.invalidateQueries({ queryKey: ['upsProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['upsMetadata'] });
    },
  });

  const linkTransportMutation = useMutation({
    mutationFn: ({
      profileId,
      bridgeMac,
      usbUuid,
      hardwareSig,
    }: {
      profileId: string;
      bridgeMac?: string | null;
      usbUuid?: string | null;
      hardwareSig?: string | null;
    }) => api.linkTransportToProfile(profileId, bridgeMac, usbUuid, hardwareSig),
    onSuccess: () => {
      refetchProfiles();
      queryClient.invalidateQueries({ queryKey: ['upsProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['upsMetadata'] });
    },
  });

  // Connect device mutation
  const connectMutation = useMutation({
    mutationFn: (portName: string) => api.connectDevice(portName),
    onSuccess: (connectedDevice, portName) => {
      if (connectedDevice?.unique_id) {
        api.setLastConnectedDevice(connectedDevice.unique_id).catch(console.error);
        queryClient.invalidateQueries({ queryKey: ['lastConnectedDevice'] });
      }
      queryClient.invalidateQueries({ queryKey: ['deviceStatus', portName] });
      queryClient.invalidateQueries({ queryKey: ['deviceStatus', connectedDevice?.unique_id] });
      queryClient.invalidateQueries({ queryKey: ['telemetryHistory', portName] });
      queryClient.invalidateQueries({ queryKey: ['telemetryHistory', connectedDevice?.unique_id] });
      queryClient.invalidateQueries({ queryKey: ['recentEvents'] });
      refetchProfiles();
    },
  });

  const handleSelectUps = useCallback(
    (upsId: string) => {
      setSelectedUpsId(upsId);
      const target = profiles.find((p) => p.unique_id === upsId);
      if (target?.last_port) {
        setSelectedDevice(target.last_port);
      }
    },
    [profiles]
  );

  const handleSelectDevice = useCallback(
    (portName: string) => {
      setSelectedDevice(portName);
      connectMutation.mutate(portName);

      // Check if this device matches an existing profile
      const discovered = allDevices.find((d) => d.port_name === portName);
      if (discovered) {
        const matchingProfile = profiles.find(
          (p) =>
            p.unique_id === discovered.unique_id ||
            (discovered.usb_uuid && p.usb_uuid === discovered.usb_uuid) ||
            (discovered.bridge_mac && p.bridge_mac === discovered.bridge_mac)
        );
        if (matchingProfile) {
          setSelectedUpsId(matchingProfile.unique_id);
        } else {
          // Unapproved device -> launch setup modal
          setConfiguringDevice(discovered);
        }
      }
    },
    [allDevices, profiles, connectMutation]
  );

  // Load initial poll interval from backend settings
  useEffect(() => {
    api
      .getPollInterval()
      .then((val) => {
        if (val) setPollInterval(val);
      })
      .catch(console.error);
  }, []);

  // Live Device Telemetry query (Q1) for the active selection
  const targetTelemetryKey = selectedUpsId || effectivePort;
  const {
    data: fetchedStatus = null,
    error: statusError,
    isFetching: isFetchingStatus,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['deviceStatus', targetTelemetryKey],
    queryFn: () => api.getDeviceStatus(effectivePort || '', selectedUpsId || undefined),
    enabled: !!effectivePort || !!selectedUpsId,
    retry: 1,
  });

  // Effective status combining real-time memory map with query cache
  const status: Q1Status | null = useMemo(() => {
    if (selectedUpsId && deviceStatuses[selectedUpsId]) {
      return deviceStatuses[selectedUpsId];
    }
    if (effectivePort && deviceStatuses[effectivePort]) {
      return deviceStatuses[effectivePort];
    }
    return fetchedStatus;
  }, [selectedUpsId, effectivePort, deviceStatuses, fetchedStatus]);

  // Telemetry History query scoped to active UPS profile
  const {
    data: history = [],
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['telemetryHistory', targetTelemetryKey],
    queryFn: () =>
      api.getRecentTelemetry(
        targetTelemetryKey || undefined,
        50,
        selectedUpsId || undefined
      ),
    enabled: !!targetTelemetryKey,
  });

  // Recent Events query scoped to active UPS profile (or system events)
  const {
    data: events = [],
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['recentEvents', selectedUpsId],
    queryFn: () => api.getRecentEvents(50, selectedUpsId || undefined),
  });

  // Listen to real-time 'ups-telemetry' broadcast pushed by Rust background monitor task
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<UpsTelemetryPayload>('ups-telemetry', (tauriEvent) => {
      const payload = tauriEvent.payload;
      const newStatus = payload.status;

      // Update multi-device status cache in memory
      setDeviceStatuses((prev) => {
        const next = { ...prev, [payload.port_name]: newStatus };
        if (payload.ups_id) {
          next[payload.ups_id] = newStatus;
        }
        return next;
      });

      // If payload matches the active profile or effective port, update query cache
      const isTarget =
        (payload.ups_id && payload.ups_id === selectedUpsId) ||
        (!selectedUpsId && payload.port_name === effectivePort);

      if (isTarget) {
        const cacheKey = selectedUpsId || effectivePort;
        if (cacheKey) {
          queryClient.setQueryData(['deviceStatus', cacheKey], newStatus);
          queryClient.setQueryData<TelemetryRecord[]>(
            ['telemetryHistory', cacheKey],
            (oldHistory = []) => {
              const newRecord: TelemetryRecord = {
                timestamp: new Date().toISOString(),
                ups_id: payload.ups_id || cacheKey,
                grid_voltage: newStatus.grid_voltage_v,
                output_voltage: newStatus.output_voltage_v,
                grid_frequency: newStatus.grid_frequency_hz,
                output_frequency: newStatus.output_frequency_hz,
                load_pct: newStatus.output_load_pct,
                output_watts: newStatus.output_watts,
                battery_voltage: newStatus.battery_voltage_v,
                temperature_c: newStatus.temperature_c,
              };
              const updated = [...oldHistory, newRecord];
              return updated.length > 50 ? updated.slice(-50) : updated;
            }
          );
        }
      }
    }).then((fn) => {
      if (!isMounted) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [selectedUpsId, effectivePort, queryClient]);

  // Listen to real-time 'ups-event' broadcast from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<EventLogRecord>('ups-event', (tauriEvent) => {
      handleIncomingUpsEvent(tauriEvent.payload, {
        osNotificationsEnabled,
        inAppToastsEnabled,
      });
      queryClient.invalidateQueries({ queryKey: ['recentEvents'] });
    }).then((fn) => {
      if (!isMounted) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [osNotificationsEnabled, inAppToastsEnabled, queryClient]);

  // Listen to real-time 'ups-probe-status' broadcast from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<ProbeStatusEvent>('ups-probe-status', (tauriEvent) => {
      setProbeStatus(tauriEvent.payload);
      if (tauriEvent.payload.phase === 'fetching' || tauriEvent.payload.phase === 'idle') {
        if (tauriEvent.payload.port_name && !selectedDevice) {
          setSelectedDevice(tauriEvent.payload.port_name);
        }
      }
    }).then((fn) => {
      if (!isMounted) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [selectedDevice]);

  // Listen to real-time 'ups-transport-status' broadcast
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<TransportStatusEvent>('ups-transport-status', (tauriEvent) => {
      const payload = tauriEvent.payload;
      setActiveTransport(payload.active_transport);
      if (payload.ip) {
        setTransportIp(payload.ip);
      }
      queryClient.invalidateQueries({ queryKey: ['connectedDevices'] });
      queryClient.invalidateQueries({ queryKey: ['ports'] });
    }).then((fn) => {
      if (!isMounted) fn();
      else unlisten = fn;
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [queryClient]);

  // Synchronize transport state based on effective port
  useEffect(() => {
    if (!effectivePort) {
      setActiveTransport(null);
      setTransportIp(null);
      return;
    }

    if (effectivePort.startsWith('BRIDGE:WS:')) {
      setActiveTransport('websocket');
      const parts = effectivePort.replace('BRIDGE:WS:', '').split(':');
      if (parts[0]) setTransportIp(parts[0]);
    } else if (effectivePort.startsWith('BRIDGE:')) {
      api
        .getBridgeStatus(effectivePort)
        .then((st) => {
          if (st) {
            setActiveTransport(st.active_transport === 'websocket' ? 'websocket' : 'usb');
            if (st.ip) setTransportIp(st.ip);
            if (st.is_compatible !== undefined) setBridgeCompatible(st.is_compatible);
          }
        })
        .catch(() => {
          if (!activeTransport) setActiveTransport('usb');
        });
    } else {
      setActiveTransport(null);
      setTransportIp(null);
    }
  }, [effectivePort]);

  const criticalCount = events.filter((e) => !e.acknowledged && e.severity === 'critical').length;
  const warningCount = events.filter((e) => !e.acknowledged && e.severity === 'warning').length;

  const activeDeviceLabel: string | null =
    activeProfile?.name || activeDevice?.port_name || null;

  // Safety Stage query for the active UPS profile
  const {
    data: safetyStage = 'T1ReadOnly',
    refetch: refetchSafetyStage,
  } = useQuery({
    queryKey: ['safetyStage', selectedUpsId],
    queryFn: () => api.getSafetyStage(selectedUpsId || undefined),
  });

  // Battery Bridge Status query & mutation (default enabled)
  const {
    data: batteryBridgeActive = true,
    refetch: refetchBatteryBridge,
  } = useQuery({
    queryKey: ['batteryBridgeStatus'],
    queryFn: () => api.getBatteryBridgeStatus(),
  });

  const batteryBridgeMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setBatteryBridgeStatus(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batteryBridgeStatus'] });
    },
  });

  const handleBatteryBridgeChange = useCallback(
    (enabled: boolean) => {
      batteryBridgeMutation.mutate(enabled);
    },
    [batteryBridgeMutation]
  );

  const handlePollIntervalChange = useCallback((newInterval: number) => {
    setPollInterval(newInterval);
    api.setPollInterval(newInterval).catch(console.error);
  }, []);

  // Manual refresh handler
  const pollTelemetry = useCallback(() => {
    refetchStatus();
    refetchHistory();
    refetchEvents();
  }, [refetchStatus, refetchHistory, refetchEvents]);

  // Metadata refresh handler
  const refreshMetadata = useCallback(() => {
    refetchSafetyStage();
    refetchBatteryBridge();
  }, [refetchSafetyStage, refetchBatteryBridge]);

  const handleScan = useCallback(() => {
    scanPorts();
  }, [scanPorts]);

  const handleOpenAddDeviceModal = useCallback(() => {
    setIsConnectModalOpen(true);
  }, []);

  const handleTabChange = useCallback(
    (nextTab: string) => {
      if (currentTab === 'settings' && isSettingsDirty && nextTab !== 'settings') {
        setPendingTab(nextTab);
        setShowLeaveConfirmModal(true);
        return;
      }
      setCurrentTab(nextTab);
    },
    [currentTab, isSettingsDirty]
  );

  const handleModalSaveAndLeave = async () => {
    if (settingsRef.current) {
      setIsModalSaving(true);
      const ok = await settingsRef.current.save();
      setIsModalSaving(false);
      if (ok && pendingTab) {
        setShowLeaveConfirmModal(false);
        setCurrentTab(pendingTab);
        setPendingTab(null);
      }
    } else if (pendingTab) {
      setShowLeaveConfirmModal(false);
      setCurrentTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handleModalDiscardAndLeave = () => {
    if (settingsRef.current) {
      settingsRef.current.discard();
    }
    setShowLeaveConfirmModal(false);
    if (pendingTab) {
      setCurrentTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handleModalClose = () => {
    setShowLeaveConfirmModal(false);
    setPendingTab(null);
  };

  const lastError = statusError
    ? statusError instanceof Error
      ? statusError.message
      : String(statusError)
    : null;

  const isRefreshing = isFetchingStatus;

  // Device to configure in UpsSetupModal
  const targetSetupDevice =
    configuringDevice ||
    (activeDevice && !activeProfile && !isSetupModalDismissed ? activeDevice : null);

  return (
    <div
      className="flex h-screen text-slate-100 overflow-hidden font-sans select-none"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      {/* Sidebar navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={handleTabChange}
        profiles={profiles}
        selectedUpsId={selectedUpsId}
        activeProfile={activeProfile}
        activeDevice={activeDevice}
        activeStatus={status}
        deviceStatuses={deviceStatuses}
        onSelectUps={handleSelectUps}
        onOpenConnectModal={handleOpenAddDeviceModal}
        onScan={handleScan}
        isScanning={isScanning}
        safetyStage={safetyStage}
        criticalCount={criticalCount}
        warningCount={warningCount}
        onOpenAbout={() => setIsAboutModalOpen(true)}
      />

      {/* Hovering Main Outlet */}
      <div
        className="flex-1 flex flex-col min-w-0 m-2 sm:m-3 rounded-2xl sm:rounded-3xl overflow-hidden border"
        style={{
          backgroundColor: 'var(--outlet-bg)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <Header
          currentTab={currentTab}
          selectedUpsId={selectedUpsId}
          activeProfile={activeProfile}
          activeDevice={activeDevice}
          activeStatus={status}
          selectedDevice={effectivePort}
          activeTransport={activeTransport}
          transportIp={transportIp}
          bridgeUpdateAvailable={bridgeUpdateAvailable}
          bridgeCompatible={bridgeCompatible}
          onRefresh={pollTelemetry}
          isRefreshing={isRefreshing}
          safetyStage={safetyStage}
          onTabChange={handleTabChange}
          onOpenAddDeviceModal={handleOpenAddDeviceModal}
        />

        <main className="flex-1 overflow-hidden flex flex-col custom-scrollbar min-w-0">
          {currentTab === 'dashboard' && (
            <Dashboard
              status={status}
              history={history}
              portName={effectivePort}
              lastError={lastError}
              metadata={activeProfile}
              isScanning={isScanning}
              isConnecting={connectMutation.isPending}
              probeStatus={probeStatus}
              targetDeviceName={activeDeviceLabel}
              events={events}
              showOutageHighlights={showOutageHighlights}
              downsamplingMaxPoints={downsamplingMaxPoints}
              onRescan={() => scanPorts()}
              isWindowVisible={isWindowVisible}
            />
          )}

          {currentTab === 'events' && (
            <Events
              events={events}
              upsId={selectedUpsId}
              onRefresh={refetchEvents}
              isRefreshing={isRefreshing}
            />
          )}

          {currentTab === 'control' && (
            <Control
              portName={effectivePort}
              upsId={selectedUpsId}
              safetyStage={safetyStage}
              onRefreshStage={refreshMetadata}
            />
          )}

          {currentTab === 'config' && (
            <Config
              portName={effectivePort}
              upsId={selectedUpsId}
              safetyStage={safetyStage}
            />
          )}

          {currentTab === 'history' && (
            <History
              telemetry={history}
              events={events}
              onRefresh={pollTelemetry}
              isRefreshing={isRefreshing}
              showOutageHighlights={showOutageHighlights}
              downsamplingMaxPoints={downsamplingMaxPoints}
              portName={effectivePort}
              upsId={selectedUpsId}
            />
          )}

          {currentTab === 'iot' && (
            <IoT portName={effectivePort} upsId={selectedUpsId} />
          )}

          {currentTab === 'settings' && (
            <Settings
              ref={settingsRef}
              pollInterval={pollInterval}
              onPollIntervalChange={handlePollIntervalChange}
              batteryBridgeActive={batteryBridgeActive}
              onBatteryBridgeChange={handleBatteryBridgeChange}
              metadata={activeProfile}
              onUpdateMetadata={(meta) => saveMetadataMutation.mutate(meta)}
              profiles={profiles}
              onSelectUps={handleSelectUps}
              onProfilesChanged={() => {
                refetchProfiles();
                queryClient.invalidateQueries({ queryKey: ['upsProfiles'] });
              }}
              osNotificationsEnabled={osNotificationsEnabled}
              onOsNotificationsChange={setOsNotificationsEnabled}
              inAppToastsEnabled={inAppToastsEnabled}
              onInAppToastsChange={setInAppToastsEnabled}
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
              showOutageHighlights={showOutageHighlights}
              onShowOutageHighlightsChange={handleShowOutageHighlightsChange}
              downsamplingMaxPoints={downsamplingMaxPoints}
              onDownsamplingMaxPointsChange={handleDownsamplingMaxPointsChange}
              onDirtyChange={setIsSettingsDirty}
              onOpenAbout={() => setIsAboutModalOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Headless Bespoke Toast Notification Container */}
      <UpsedToaster />

      {/* About UPSED Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />

      {/* Unsaved Changes Navigation Guard Modal */}
      <UnsavedChangesModal
        isOpen={showLeaveConfirmModal}
        onClose={handleModalClose}
        onSaveAndLeave={handleModalSaveAndLeave}
        onDiscardAndLeave={handleModalDiscardAndLeave}
        isLoading={isModalSaving}
      />

      {/* Device Connection / Scanning Modal */}
      <DeviceConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        devices={allDevices}
        profiles={profiles}
        selectedDevice={effectivePort}
        isScanning={isScanning}
        onScan={handleScan}
        onSelectDevice={(port) => {
          handleSelectDevice(port);
          setIsConnectModalOpen(false);
        }}
        onConfigureDevice={(dev) => {
          setConfiguringDevice(dev);
          setIsConnectModalOpen(false);
        }}
      />

      {/* UPS Profile Configuration Modal */}
      {targetSetupDevice && (
        <UpsSetupModal
          device={targetSetupDevice}
          status={status}
          isOpen={true}
          isFirstProfile={profiles.length === 0}
          onClose={() => {
            setConfiguringDevice(null);
            setIsSetupModalDismissed(true);
          }}
          onSave={(meta) => {
            saveMetadataMutation.mutate(meta);
            setSelectedUpsId(meta.unique_id);
            if (targetSetupDevice.port_name) {
              api.connectDevice(targetSetupDevice.port_name).catch(console.error);
            }
            setConfiguringDevice(null);
            setIsSetupModalDismissed(true);
          }}
          onLinkExisting={(targetProfileId) => {
            linkTransportMutation.mutate({
              profileId: targetProfileId,
              bridgeMac: targetSetupDevice.bridge_mac,
              usbUuid: targetSetupDevice.usb_uuid,
              hardwareSig: targetSetupDevice.hardware_signature,
            });
            setSelectedUpsId(targetProfileId);
            setConfiguringDevice(null);
            setIsSetupModalDismissed(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
