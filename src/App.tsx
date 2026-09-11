import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { UpsSetupModal } from './components/UpsSetupModal';
import { Dashboard } from './pages/Dashboard';
import { Control } from './pages/Control';
import { Config } from './pages/Config';
import { History } from './pages/History';
import { Events } from './pages/Events';
import { Settings } from './pages/Settings';
import { VoltWatchToaster } from './components/VoltWatchToaster';
import { handleIncomingUpsEvent } from './lib/notifications';
import { listen } from '@tauri-apps/api/event';
import { api } from './lib/tauri';
import { UpsMetadata, EventLogRecord, Q1Status } from './lib/types';

export function App() {
  const queryClient = useQueryClient();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(10); // 10 seconds default
  const [isSetupModalDismissed, setIsSetupModalDismissed] = useState(false);
  const [osNotificationsEnabled, setOsNotificationsEnabled] = useState<boolean>(true);
  const [inAppToastsEnabled, setInAppToastsEnabled] = useState<boolean>(true);

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

  // 1a. Query last connected device from DB on startup
  const { data: lastSavedDeviceId = null } = useQuery({
    queryKey: ['lastConnectedDevice'],
    queryFn: () => api.getLastConnectedDevice(),
  });

  // Active connected device info (or fallback to discovered device matching last saved id)
  const activeDevice =
    devices.find((d) => d.port_name === selectedDevice) ||
    devices.find((d) => d.unique_id === lastSavedDeviceId) ||
    null;

  // Reset modal dismissed state when active unique_id changes
  useEffect(() => {
    setIsSetupModalDismissed(false);
  }, [activeDevice?.unique_id]);

  // 1b. UPS Hardware Profile & Specifications query
  const targetUniqueId = activeDevice?.unique_id || lastSavedDeviceId;
  const { data: upsMetadata = null } = useQuery({
    queryKey: ['upsMetadata', targetUniqueId],
    queryFn: () => (targetUniqueId ? api.getUpsMetadata(targetUniqueId) : null),
    enabled: !!targetUniqueId,
  });

  const saveMetadataMutation = useMutation({
    mutationFn: (meta: UpsMetadata) => api.saveUpsMetadata(meta),
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
    if (devices.length === 0 || selectedDevice) return;

    // 1. Try to find the device matching the last saved unique_id
    let target = lastSavedDeviceId
      ? devices.find((d) => d.unique_id === lastSavedDeviceId)
      : null;

    // 2. If not matched by unique_id, try matching by usb_uuid locator
    if (!target && upsMetadata?.usb_uuid) {
      target = devices.find((d) => d.usb_uuid === upsMetadata.usb_uuid) || null;
    }

    // 3. Dynamic USB port roaming check: if same physical UPS discovered on a new USB port/UUID, auto-update in SQLite!
    if (target && upsMetadata && target.unique_id === upsMetadata.unique_id) {
      if (target.usb_uuid && target.usb_uuid !== upsMetadata.usb_uuid) {
        console.info(
          `[VoltWatch] Device ${target.unique_id} moved to new USB port (UUID: ${target.usb_uuid})`
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
    const finalDevice = target || devices[0];
    handleSelectDevice(finalDevice.port_name);
  }, [devices, selectedDevice, lastSavedDeviceId, upsMetadata, handleSelectDevice, queryClient]);

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
    dataUpdatedAt: statusUpdatedAt,
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
    listen<Q1Status>('ups-telemetry', (tauriEvent) => {
      queryClient.setQueryData(['deviceStatus', selectedDevice], tauriEvent.payload);
      queryClient.invalidateQueries({ queryKey: ['telemetryHistory', selectedDevice] });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [selectedDevice, queryClient]);

  // Listen to real-time 'ups-event' broadcast from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<EventLogRecord>('ups-event', (tauriEvent) => {
      handleIncomingUpsEvent(tauriEvent.payload, {
        osNotificationsEnabled,
        inAppToastsEnabled,
      });
      // Invalidate events cache to show in table
      queryClient.invalidateQueries({ queryKey: ['recentEvents'] });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [osNotificationsEnabled, inAppToastsEnabled, queryClient]);

  const unreadEventsCount = events.filter(
    (e) => !e.acknowledged && (e.severity === 'critical' || e.severity === 'warning')
  ).length;

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

  const lastError = statusError
    ? statusError instanceof Error
      ? statusError.message
      : String(statusError)
    : null;

  const isRefreshing = isFetchingStatus;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* Sidebar navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        devices={devices}
        selectedDevice={selectedDevice}
        onSelectDevice={handleSelectDevice}
        onScan={handleScan}
        isScanning={isScanning}
        safetyStage={safetyStage}
        unreadEventsCount={unreadEventsCount}
      />

      {/* Main App Canvas */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        <Header
          selectedDevice={selectedDevice}
          status={status}
          onRefresh={pollTelemetry}
          isRefreshing={isRefreshing}
          batteryBridgeActive={batteryBridgeActive}
          lastError={lastError}
          lastUpdatedAt={statusUpdatedAt}
          upsMetadata={upsMetadata}
        />

        <main className="flex-1 overflow-hidden flex flex-col">
          {currentTab === 'dashboard' && (
            <Dashboard
              status={status}
              history={history}
              portName={selectedDevice}
              lastError={lastError}
              metadata={upsMetadata}
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
            />
          )}

          {currentTab === 'settings' && (
            <Settings
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
            />
          )}
        </main>
      </div>

      {/* Headless Bespoke Toast Notification Container */}
      <VoltWatchToaster />

      {/* First-time UPS Configuration Modal */}
      {activeDevice && upsMetadata === null && !isSetupModalDismissed && (
        <UpsSetupModal
          device={activeDevice}
          status={status}
          isOpen={true}
          onClose={() => setIsSetupModalDismissed(true)}
          onSave={(meta) => {
            saveMetadataMutation.mutate(meta);
            setIsSetupModalDismissed(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
