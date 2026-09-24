import React, { useState, useEffect } from 'react';
import { X, Cpu, ExternalLink } from 'lucide-react';
import { UpsedLogo } from './UpsedLogo';
import { PrimaryButton } from './PrimaryButton';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  // Manage enter and exit animation lifecycle (matching DeviceConnectModal)
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

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
      aria-labelledby="about-upsed-title"
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
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center space-x-3">
              <UpsedLogo size="lg" className="text-slate-100" />
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                v0.1.0
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Cross-Platform Voltronic UPS Manager
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded-lg transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Modal Body ──────────────────────────────────────── */}
        <div className="p-5 space-y-4 text-xs">
          {/* Overview */}
          <p className="text-slate-300 leading-relaxed text-xs">
            A high-performance, memory-safe desktop manager for <strong className="text-slate-100 font-semibold">Voltronic Power</strong> and rebranded uninterruptible power supplies (Axpert, Mecer, MPP Solar, Effekta, RCT, Prolink).
          </p>

          {/* Architecture Highlights Card */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 space-y-1.5">
            <div className="flex items-center space-x-2 text-slate-200 font-medium">
              <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Direct Hardware Architecture</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Built on Tauri v2, Rust async runtime, and React 19. Communicates directly with hardware via native USB HID or RS-232 serial with zero external web servers and an incremental 4-stage safety command gate.
            </p>
          </div>

          {/* Technical Specifications */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 space-y-2">
            <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
              <span className="text-slate-400">Supported Protocols</span>
              <span className="font-mono text-slate-200 text-[11px]">Megatec, P00, P01, P02, P03, P04</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
              <span className="text-slate-400">Hardware Transports</span>
              <span className="font-mono text-slate-200 text-[11px]">USB HID (0665:5161), Serial COM</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
              <span className="text-slate-400">Telemetry Database</span>
              <span className="font-mono text-slate-200 text-[11px]">SQLite WAL (upsed.db)</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Safety Command Gate</span>
              <span className="font-mono text-emerald-400 text-[11px]">4-Tier Active (T1–T4)</span>
            </div>
          </div>
        </div>

        {/* ── Footer Actions ──────────────────────────────────── */}
        <div className="p-4 bg-black/30 border-t border-white/[0.07] flex items-center justify-between">
          <a
            href="https://github.com/Sandakan/UPSED"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-xl border border-white/[0.08] transition cursor-pointer"
          >
            <span>GitHub Repository</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          <PrimaryButton onClick={onClose} size="md">
            Close
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
