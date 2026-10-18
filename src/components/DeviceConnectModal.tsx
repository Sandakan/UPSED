import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, RefreshCw, X, Check, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { DiscoveredDevice } from '../lib/types';
import { PrimaryButton } from './PrimaryButton';

export interface DeviceConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: DiscoveredDevice[];
  selectedDevice: string | null;
  isScanning: boolean;
  onScan: () => void;
  onSelectDevice: (portName: string) => void;
}

export const DeviceConnectModal: React.FC<DeviceConnectModalProps> = ({
  isOpen,
  onClose,
  devices,
  selectedDevice,
  isScanning,
  onScan,
  onSelectDevice,
}) => {
  const { t } = useTranslation(['modals', 'common']);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [chosenPort, setChosenPort] = useState<string | null>(selectedDevice);

  // Manage enter and exit animation lifecycle (matching ConfirmModal)
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      // Auto-scan on open as requested
      onScan();
      if (selectedDevice) {
        setChosenPort(selectedDevice);
      }
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keep chosenPort updated if devices change and none is chosen
  useEffect(() => {
    if (!chosenPort && devices.length > 0) {
      setChosenPort(selectedDevice || devices[0].port_name);
    }
  }, [devices, chosenPort, selectedDevice]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const handleConnect = () => {
    if (chosenPort) {
      onSelectDevice(chosenPort);
      onClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-ups-title"
    >
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
          isClosing ? 'animate-modal-out' : 'animate-modal-in'
        }`}
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        {/* ── Modal Header ────────────────────────────────────── */}
        <div className="p-5 border-b border-white/[0.07] flex items-start justify-between bg-black/20">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 rounded-xl border bg-emerald-950/70 border-emerald-800/60 text-emerald-400">
              <Plug className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3
                id="connect-ups-title"
                className="text-base font-semibold text-slate-100"
              >
                {t('modals:connect.title', 'Connect UPS Hardware Device')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('modals:connect.subtitle', 'Select a communication port to start real-time telemetry')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded-lg transition"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Modal Body ──────────────────────────────────────── */}
        <div className="p-5 space-y-4 text-xs">
          {/* Scan Status Banner */}
          {isScanning ? (
            <div className="p-3 rounded-xl border border-emerald-600/40 bg-emerald-950/30 text-emerald-300 flex items-center space-x-2.5">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-emerald-400" />
              <span>{t('modals:connect.scanning', 'Scanning serial ports (2400/9600 baud) and USB HID interfaces...')}</span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-slate-400 px-1">
              <span>
                {devices.length === 0
                  ? t('modals:connect.noDevices', 'No devices detected yet')
                  : t('modals:connect.detectedCount', { count: devices.length, defaultValue: `Detected ${devices.length} hardware interfaces` })}
              </span>
              <span className="text-[11px] font-mono text-slate-500">{t('modals:connect.discoveryStage', 'Stage T1 Discovery')}</span>
            </div>
          )}

          {/* Device List / Empty State */}
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-0.5">
            {devices.length === 0 && !isScanning ? (
              <div className="rounded-xl border border-dashed border-white/[0.1] p-6 text-center space-y-2 bg-black/10">
                <AlertTriangle className="w-8 h-8 mx-auto text-amber-400 opacity-80 mb-1" />
                <p className="font-semibold text-slate-200 text-sm">
                  {t('modals:connect.noUpsFound', 'No Voltronic UPS Found')}
                </p>
                <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
                  {t('modals:connect.noUpsDesc', 'Ensure the USB or serial cable is connected securely and no third-party software (e.g. ViewPower) is locking the COM port.')}
                </p>
                <div className="pt-2">
                  <button
                    onClick={onScan}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('modals:connect.scanAgain', 'Scan Again')}</span>
                  </button>
                </div>
              </div>
            ) : (
              devices.map((dev) => {
                const isChosen = chosenPort === dev.port_name;
                const isCurrentlyActive = selectedDevice === dev.port_name;
                return (
                  <button
                    key={dev.port_name}
                    type="button"
                    onClick={() => setChosenPort(dev.port_name)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                      isChosen
                        ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                        : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      {/* Radio Check Circle */}
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition ${
                          isChosen
                            ? 'border-emerald-400 bg-emerald-500 text-white'
                            : 'border-slate-600 bg-transparent'
                        }`}
                      >
                        {isChosen && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-sm text-slate-100">
                            {dev.port_name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-white/[0.06] border border-white/[0.08] text-slate-300">
                            {dev.capabilities.protocol_id || dev.protocol_id}
                          </span>
                          {dev.port_name.startsWith('BRIDGE:WS:') ? (
                            <span className="text-[10px] px-2 py-0.5 rounded font-sans font-bold uppercase bg-cyan-950/80 border border-cyan-700/60 text-cyan-400">
                              Wi-Fi
                            </span>
                          ) : dev.port_name.startsWith('BRIDGE:') ? (
                            <span className="text-[10px] px-2 py-0.5 rounded font-sans font-bold uppercase bg-emerald-950/80 border border-emerald-700/60 text-emerald-400">
                              Bridge
                            </span>
                          ) : null}
                          {isCurrentlyActive && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-950 text-emerald-400 border border-emerald-700/50">
                              {t('common:status.connected', 'Connected')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center space-x-2">
                          {dev.serial_number && <span>SN: {dev.serial_number}</span>}
                          {dev.firmware_version && <span>FW: {dev.firmware_version}</span>}
                          {!dev.serial_number && !dev.firmware_version && (
                            <span>{t('dashboard:autoDiscovery.discovered', 'Hardware detected & validated')}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <ShieldCheck
                      className={`w-4 h-4 shrink-0 transition ${
                        isChosen ? 'text-emerald-400' : 'text-slate-600'
                      }`}
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Footer Actions ──────────────────────────────────── */}
        <div className="p-4 bg-black/30 border-t border-white/[0.07] flex items-center justify-between">
          {/* Left: Rescan Button */}
          <button
            type="button"
            onClick={onScan}
            disabled={isScanning}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-xl border border-white/[0.08] transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? t('common:status.scanning', 'Scanning...') : t('common:buttons.scan', 'Rescan Ports')}</span>
          </button>

          {/* Right: Cancel & Connect */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded-xl transition cursor-pointer"
            >
              {t('common:buttons.cancel', 'Cancel')}
            </button>
            <PrimaryButton
              onClick={handleConnect}
              disabled={!chosenPort || isScanning}
              icon={<Plug className="w-3.5 h-3.5" />}
            >
              <span>{chosenPort ? t('modals:connect.connectBtn', { port: chosenPort, defaultValue: `Connect to ${chosenPort}` }) : t('modals:connect.selectPortFirst', 'Connect Device')}</span>
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
};
