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
import { Settings } from './pages/Settings';
import { api } from './lib/tauri';
import { UpsMetadata } from './lib/types';

export function App() {
  const queryClient = useQueryClient();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(10); // 10 seconds default
  const [isSetupModalDismissed, setIsSetupModalDismissed] = useState(false);

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

  // Active connected device info
  const activeDevice = devices.find((d) => d.port_name === selectedDevice) || null;

  // Reset modal dismissed state when active unique_id changes
  useEffect(() => {
    setIsSetupModalDismissed(false);
  }, [activeDevice?.unique_id]);

  // 1b. UPS Hardware Profile & Specifications query
  const { data: upsMetadata = null } = useQuery({
    queryKey: ['upsMetadata', activeDevice?.unique_id],
    queryFn: () =>
      activeDevice?.unique_id ? api.getUpsMetadata(activeDevice.unique_id) : null,
    enabled: !!activeDevice?.unique_id,
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
    onSuccess: (_, portName) => {
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

  // Auto-select first discovered device
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      handleSelectDevice(devices[0].port_name);
    }
  }, [devices, selectedDevice, handleSelectDevice]);

  // 3. Live Device Telemetry query (Q1)
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
    refetchInterval: pollInterval * 1000,
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
    refetchInterval: pollInterval * 1000,
  });

  // 5. Recent System Events query
  const {
    data: events = [],
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['recentEvents'],
    queryFn: () => api.getRecentEvents(50),
    refetchInterval: pollInterval * 1000,
  });

  // 6. Safety Stage query
  const {
    data: safetyStage = 'T1ReadOnly',
    refetch: refetchSafetyStage,
  } = useQuery({
    queryKey: ['safetyStage'],
    queryFn: () => api.getSafetyStage(),
  });

  // 7. Battery Bridge Status query & mutation
  const {
    data: batteryBridgeActive = false,
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
              onPollIntervalChange={setPollInterval}
              batteryBridgeActive={batteryBridgeActive}
              onBatteryBridgeChange={handleBatteryBridgeChange}
              metadata={upsMetadata}
              onUpdateMetadata={(meta) => saveMetadataMutation.mutate(meta)}
            />
          )}
        </main>
      </div>

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
