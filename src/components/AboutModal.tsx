import React, { useEffect } from 'react';
import { X, Shield, Cpu, Scale, ExternalLink, Terminal } from 'lucide-react';
import { UpsedLogo } from './UpsedLogo';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg transform overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/95 text-left shadow-2xl shadow-black/80 backdrop-blur-xl animate-modal-in"
      >
        {/* Header with Logo and Close */}
        <div className="p-6 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/60 to-transparent flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <UpsedLogo size="lg" className="text-white" />
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                v0.1.0
              </span>
            </div>

            {/* Phonetic Pronunciation Guide */}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800/40">
                /juː-piː-ɛst/
              </span>
              <span className="text-slate-300 font-medium">“U-P-S'd”</span>
              <span className="text-slate-500 text-[11px]">— you-pee-ess-d</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-xs text-slate-300 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Tagline & Summary */}
          <p className="text-sm leading-relaxed text-slate-200">
            <strong>UPSED</strong> is a high-performance, memory-safe, cross-platform desktop manager for 
            <strong> Voltronic Power</strong> and rebranded UPS hardware (Axpert, Mecer, MPP Solar, Effekta, RCT).
          </p>

          {/* Clean-Room Legal Status */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-200">
              <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Clean-Room & Legal Status</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Developed strictly under <strong>17 U.S.C. § 1201(f)</strong> (reverse engineering for interoperability) 
              and <strong>EU Directive 2009/24/EC Article 6</strong>. UPSED contains <em>zero</em> proprietary Java bytecode, 
              JSP files, or binary assets from ViewPower. All hardware communication relies exclusively on publicly documented 
              ASCII serial protocols.
            </p>
          </div>

          {/* Architecture & Safety Gate */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/30 space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hardware Gate</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Strict 4-Tier Command Gate (T1 Read-Only to T4 Power Control) preventing command injection or firmware corruption.
              </p>
            </div>

            <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/30 space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span>Runtime Engine</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Tauri v2 + Rust async runtime with Tokio, embedded SQLite WAL telemetry storage, and zero web server attack surface.
              </p>
            </div>
          </div>

          {/* Protocol specs */}
          <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/30 space-y-1 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 text-slate-200 font-medium mb-1">
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Protocol Interoperability</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-slate-800/50">
              <span>Supported Protocols:</span>
              <span className="font-mono text-slate-300">P01, P02, P03, P04, P05, Megatec</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-slate-800/50">
              <span>Transports:</span>
              <span className="font-mono text-slate-300">Serial COM (2400/9600 8N1), USB HID</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>Database Storage:</span>
              <span className="font-mono text-slate-300">SQLite (upsed.db)</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between">
          <a
            href="https://github.com/neurodivergent-dev/VoltWatch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            <span>GitHub Repository</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-slate-200 hover:text-white transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;

