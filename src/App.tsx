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
import { UpsMetadata, EventLogRecord, Q1Status, TelemetryRecord, ProbeStatusEvent, TransportStatusEvent, DiscoveredDevice } from './lib/types';
import { useTheme } from './lib/theme';
import { useWindowVisibility } from './lib/useWindowVisibility';

export function App() {
  const { themeMode, setThemeMode } = useTheme();
  const isWindowVisible = useWindowVisibility();
  const queryClient = useQueryClient();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(10); // 10 seconds default
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

  // 1. Scan serial and USB ports query
  const {
    data: devices = [],
    isFetching: isScanning,
    refetch: scanPorts,
  } = useQuery({
    queryKey: ['ports'],
    queryFn: () => api.scanPorts(),
    staleTime: 60000,
  });

  // 1a. Query connected devices directly from multi-port manager
  const { data: connectedDevices = [] } = useQuery({
    queryKey: ['connectedDevices'],
    queryFn: () => api.listConnectedDevices(),
    refetchInterval: 5000,
  });

  // Combine discovered ports with currently connected devices so any active device is always listed
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

  // 1b. Query last connected device from DB on startup
  const { data: lastSavedDeviceId = null } = useQuery({
    queryKey: ['lastConnectedDevice'],
    queryFn: () => api.getLastConnectedDevice(),
  });

  // Active connected device info (or fallback to discovered device matching last saved id)
  const activeDevice =
    allDevices.find((d) => d.port_name === selectedDevice) ||
    allDevices.find((d) => d.unique_id === lastSavedDeviceId) ||
    allDevices[0] ||
    null;

  // Reset modal dismissed state when active unique_id changes
  useEffect(() => {
    setIsSetupModalDismissed(false);
  }, [activeDevice?.unique_id]);

  // 1b. UPS Hardware Profile & Specifications query
  const targetUniqueId = activeDevice?.unique_id || lastSavedDeviceId;
  const { data: upsMetadata = null, isLoading: isMetadataLoading } = useQuery({
    queryKey: [
      'upsMetadata',
      targetUniqueId,
      activeDevice?.bridge_mac,
      activeDevice?.usb_uuid,
      activeDevice?.hardware_signature,
    ],
    queryFn: () =>
      targetUniqueId
        ? api.getUpsMetadata(
            targetUniqueId,
            activeDevice?.bridge_mac,
            activeDevice?.usb_uuid,
            activeDevice?.hardware_signature
          )
        : null,
    enabled: !!targetUniqueId,
  });

  const saveMetadataMutation = useMutation({
    mutationFn: (meta: UpsMetadata) => api.saveUpsMetadata(meta),
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: ['upsMetadata'] });
    },
  });

  // 2. Connect device mutation
  const connectMutation = useMutation({
    mutationFn: (portName: string) => api.connectDevice(portName),
    onSuccess: (connectedDevice, portName) => {
      if (connectedDevice?.unique_id) {
        api.setLastConnectedDevice(connectedDevice.unique_id).catch(console.error);
        queryClient.invalidateQueries({ queryKey: ['lastConnectedDevice'] });
      }
      queryClient.invalidateQueries({ queryKey: ['deviceStatus', portName] });
      queryClient.invalidateQueries({ queryKey: ['telemetryHistory', portName] });
      queryClient.invalidateQueries({ queryKey: ['recentEvents'] });
    },
  });

  const handleSelectDevice = useCallback(
    (portName: string) => {
      setSelectedDevice(portName);
      connectMutation.mutate(portName);
    },
    [connectMutation]
  );

  // Auto-reconnect to saved device or intelligently match relocated USB port
  useEffect(() => {
    if (allDevices.length === 0 || selectedDevice) return;

    // 1. Try to find the device matching the last saved unique_id
    let target = lastSavedDeviceId
      ? allDevices.find((d) => d.unique_id === lastSavedDeviceId)
      : null;

    // 2. If not matched by unique_id, try matching by usb_uuid locator
    if (!target && upsMetadata?.usb_uuid) {
      target = allDevices.find((d) => d.usb_uuid === upsMetadata.usb_uuid) || null;
    }

    // 3. Dynamic USB port roaming check: if same physical UPS discovered on a new USB port/UUID, auto-update in SQLite!
    if (target && upsMetadata && target.unique_id === upsMetadata.unique_id) {
      if (target.usb_uuid && target.usb_uuid !== upsMetadata.usb_uuid) {
        console.info(
          `[UPSED] Device ${target.unique_id} moved to new USB port (UUID: ${target.usb_uuid})`
        );
        api
          .updateDeviceUsbUuid(
            target.unique_id,
            target.usb_uuid,
            new Date().toISOString()
          )
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['upsMetadata', target.unique_id] });
          })
          .catch(console.error);
      }
    }

    // 4. Connect to matched device or fallback to first discovered
    const finalDevice = target || allDevices[0];
    if (finalDevice) {
      handleSelectDevice(finalDevice.port_name);
    }
  }, [allDevices, selectedDevice, lastSavedDeviceId, upsMetadata, handleSelectDevice, queryClient]);

  // Load initial poll interval from backend settings
  useEffect(() => {
    api.getPollInterval().then((val) => {
      if (val) setPollInterval(val);
    }).catch(console.error);
  }, []);

  // 3. Live Device Telemetry query (Q1) - Event-driven, populated by background Rust monitor
  const {
    data: status = null,
    error: statusError,
    isFetching: isFetchingStatus,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['deviceStatus', selectedDevice],
    queryFn: () => api.getDeviceStatus(selectedDevice!),
    enabled: !!selectedDevice,
    retry: 1,
  });

  // 4. Telemetry History query
  const {
    data: history = [],
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['telemetryHistory', selectedDevice],
    queryFn: () => api.getRecentTelemetry(selectedDevice!, 50),
    enabled: !!selectedDevice,
  });

  // 5. Recent System Events query
  const {
    data: events = [],
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['recentEvents'],
    queryFn: () => api.getRecentEvents(50),
  });

  // Listen to real-time 'ups-telemetry' broadcast pushed by Rust background monitor task
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<Q1Status>('ups-telemetry', (tauriEvent) => {
      const newStatus = tauriEvent.payload;
      queryClient.setQueryData(['deviceStatus', selectedDevice], newStatus);

      // Optimistically append new telemetry sample to cache to eliminate redundant IPC DB queries and avoid secondary re-renders
      if (selectedDevice) {
        queryClient.setQueryData<TelemetryRecord[]>(
          ['telemetryHistory', selectedDevice],
          (oldHistory = []) => {
            const newRecord: TelemetryRecord = {
              timestamp: new Date().toISOString(),
              port_name: selectedDevice,
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
  }, [selectedDevice, queryClient]);

  // Listen to real-time 'ups-event' broadcast from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    listen<EventLogRecord>('ups-event', (tauriEvent) => {
      handleIncomingUpsEvent(tauriEvent.payload, {
        osNotificationsEnabled,
        inAppToastsEnabled,
      });
      // Invalidate events cache to show in table
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

  // Listen to real-time 'ups-transport-status' broadcast (USB CDC vs Wi-Fi WebSocket)
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

  // Synchronize transport state based on selected device identifier
  useEffect(() => {
    if (!selectedDevice) {
      setActiveTransport(null);
      setTransportIp(null);
      return;
    }

    if (selectedDevice.startsWith('BRIDGE:WS:')) {
      setActiveTransport('websocket');
      const parts = selectedDevice.replace('BRIDGE:WS:', '').split(':');
      if (parts[0]) setTransportIp(parts[0]);
    } else if (selectedDevice.startsWith('BRIDGE:')) {
      // Actively query backend bridge status so we know the true active transport (WebSocket vs USB)
      api.getBridgeStatus(selectedDevice).then((st) => {
        if (st) {
          setActiveTransport(st.active_transport === 'websocket' ? 'websocket' : 'usb');
          if (st.ip) setTransportIp(st.ip);
          if (st.is_compatible !== undefined) setBridgeCompatible(st.is_compatible);
        }
      }).catch(() => {
        if (!activeTransport) setActiveTransport('usb');
      });
    } else {
      setActiveTransport(null);
      setTransportIp(null);
    }
  }, [selectedDevice]);

  const criticalCount = events.filter((e) => !e.acknowledged && e.severity === 'critical').length;
  const warningCount = events.filter((e) => !e.acknowledged && e.severity === 'warning').length;

  // Display label for the sidebar UPS device dropdown
  const activeDeviceLabel: string | null =
    upsMetadata?.name || activeDevice?.port_name || null;

  // 6. Safety Stage query
  const {
    data: safetyStage = 'T1ReadOnly',
    refetch: refetchSafetyStage,
  } = useQuery({
    queryKey: ['safetyStage'],
    queryFn: () => api.getSafetyStage(),
  });

  // 7. Battery Bridge Status query & mutation (default enabled)
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
    if (!selectedDevice) return;
    refetchStatus();
    refetchHistory();
    refetchEvents();
  }, [selectedDevice, refetchStatus, refetchHistory, refetchEvents]);

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

  return (
    <div className="flex h-screen text-slate-100 overflow-hidden font-sans select-none" style={{ backgroundColor: 'var(--app-bg)' }}>
      {/* Sidebar navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={handleTabChange}
        devices={allDevices}
        selectedDevice={selectedDevice}
        activeDeviceLabel={activeDeviceLabel}
        activeTransport={activeTransport}
        isStreaming={!!status}
        onSelectDevice={handleSelectDevice}
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
          selectedDevice={selectedDevice}
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
              portName={selectedDevice || activeDevice?.port_name || null}
              lastError={lastError}
              metadata={upsMetadata}
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
              onRefresh={refetchEvents}
              isRefreshing={isRefreshing}
            />
          )}

          {currentTab === 'control' && (
            <Control
              portName={selectedDevice}
              safetyStage={safetyStage}
              onRefreshStage={refreshMetadata}
            />
          )}

          {currentTab === 'config' && (
            <Config portName={selectedDevice} safetyStage={safetyStage} />
          )}

          {currentTab === 'history' && (
            <History
              telemetry={history}
              events={events}
              onRefresh={pollTelemetry}
              isRefreshing={isRefreshing}
              showOutageHighlights={showOutageHighlights}
              downsamplingMaxPoints={downsamplingMaxPoints}
              portName={selectedDevice}
            />
          )}

          {currentTab === 'iot' && (
            <IoT portName={selectedDevice} />
          )}

          {currentTab === 'settings' && (
            <Settings
              ref={settingsRef}
              pollInterval={pollInterval}
              onPollIntervalChange={handlePollIntervalChange}
              batteryBridgeActive={batteryBridgeActive}
              onBatteryBridgeChange={handleBatteryBridgeChange}
              metadata={upsMetadata}
              onUpdateMetadata={(meta) => saveMetadataMutation.mutate(meta)}
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
        selectedDevice={selectedDevice}
        isScanning={isScanning}
        onScan={handleScan}
        onSelectDevice={(port) => {
          handleSelectDevice(port);
          setIsConnectModalOpen(false);
        }}
      />

      {/* First-time UPS Configuration Modal */}
      {activeDevice && !isMetadataLoading && upsMetadata === null && !isSetupModalDismissed && (
        <UpsSetupModal
          device={activeDevice}
          status={status}
          isOpen={true}
          onClose={() => setIsSetupModalDismissed(true)}
          onSave={(meta) => {
            saveMetadataMutation.mutate(meta);
            setIsSetupModalDismissed(true);
          }}
          onLinkExisting={(targetProfileId) => {
            linkTransportMutation.mutate({
              profileId: targetProfileId,
              bridgeMac: activeDevice.bridge_mac,
              usbUuid: activeDevice.usb_uuid,
              hardwareSig: activeDevice.hardware_signature,
            });
            setIsSetupModalDismissed(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
