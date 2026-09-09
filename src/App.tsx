import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { Control } from './pages/Control';
import { Config } from './pages/Config';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import {
  DiscoveredDevice,
  EventLogRecord,
  Q1Status,
  TelemetryRecord,
  UnlockStage,
} from './lib/types';
import { api } from './lib/tauri';

export function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [status, setStatus] = useState<Q1Status | null>(null);
  const [history, setHistory] = useState<TelemetryRecord[]>([]);
  const [events, setEvents] = useState<EventLogRecord[]>([]);
  const [safetyStage, setSafetyStage] = useState<UnlockStage>('T1ReadOnly');
  const [batteryBridgeActive, setBatteryBridgeActive] = useState<boolean>(false);
  const [pollInterval, setPollInterval] = useState<number>(30); // 30 seconds default
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Scan serial and USB ports for Voltronic UPS hardware
  const handleScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const found = await api.scanPorts();
      setDevices(found);
      if (found.length > 0 && !selectedDevice) {
        const target = found[0].port_name;
        setSelectedDevice(target);
        try {
          await api.connectDevice(target);
        } catch (e) {
          console.error('Auto-connect failed:', e);
        }
      }
    } catch (e) {
      console.error('Port scan failed:', e);
    } finally {
      setIsScanning(false);
    }
  }, [selectedDevice]);

  const handleSelectDevice = useCallback(async (portName: string) => {
    setSelectedDevice(portName);
    try {
      await api.connectDevice(portName);
    } catch (e) {
      console.error('Failed to connect to device:', e);
    }
  }, []);

  // Refresh safety stage & battery bridge status
  const refreshMetadata = useCallback(async () => {
    try {
      const stage = await api.getSafetyStage();
      setSafetyStage(stage);
      const bridge = await api.getBatteryBridgeStatus();
      setBatteryBridgeActive(bridge);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Poll current device telemetry
  const pollTelemetry = useCallback(async () => {
    if (!selectedDevice) return;
    setIsRefreshing(true);
    try {
      const currentStatus = await api.getDeviceStatus(selectedDevice);
      setStatus(currentStatus);
      setLastError(null);

      const recentTelem = await api.getRecentTelemetry(selectedDevice, 50);
      setHistory(recentTelem);

      const recentEvts = await api.getRecentEvents(50);
      setEvents(recentEvts);
    } catch (e) {
      console.error('Polling failed:', e);
      setLastError(String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedDevice]);

  // Initial load
  useEffect(() => {
    handleScan();
    refreshMetadata();
  }, [handleScan, refreshMetadata]);

  // Polling timer
  useEffect(() => {
    if (!selectedDevice) return;
    pollTelemetry();
    const timer = setInterval(() => {
      pollTelemetry();
    }, pollInterval * 1000);

    return () => clearInterval(timer);
  }, [selectedDevice, pollInterval, pollTelemetry]);

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
        />

        <main className="flex-1 overflow-hidden">
          {currentTab === 'dashboard' && (
            <Dashboard
              status={status}
              history={history}
              portName={selectedDevice}
              lastError={lastError}
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
              onBatteryBridgeChange={setBatteryBridgeActive}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
