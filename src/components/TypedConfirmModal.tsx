import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertOctagon, X, RefreshCw, Laptop } from 'lucide-react';

export interface TypedConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: React.ReactNode;
  expectedConfirmationText: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  isLoading?: boolean;
}

export const TypedConfirmModal: React.FC<TypedConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  expectedConfirmationText,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  isLoading = false,
}) => {
  const { t } = useTranslation(['control', 'common']);
  const [typedText, setTypedText] = useState('');
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  const normalizedExpected = expectedConfirmationText.trim().toLowerCase();
  const normalizedTyped = typedText.trim().toLowerCase();
  const isMatch = normalizedTyped === normalizedExpected;

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      setTypedText('');
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        setTypedText('');
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      } else if (e.key === 'Enter' && isMatch && !isLoading) {
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose, onConfirm, isMatch]);

  if (!shouldRender) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isClosing ? 'opacity-0 backdrop-blur-none' : 'opacity-100 backdrop-blur-sm'
      }`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
    >
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl p-6 transition-all duration-200 ${
          isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        } ${
          isDanger
            ? 'border-rose-500/30 bg-[#0f1117]'
            : 'border-amber-500/30 bg-[#0f1117]'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl border ${
                isDanger
                  ? 'bg-rose-950/70 border-rose-800/60 text-rose-400'
                  : 'bg-amber-950/70 border-amber-800/60 text-amber-400'
              }`}
            >
              {isDanger ? (
                <AlertOctagon className="w-5 h-5 text-rose-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{title}</h3>
              <span
                className={`text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${
                  isDanger
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {t('control:stageT4.risk', 'High Risk - Stage T4')}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg transition hover:bg-white/[0.05]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Host PC Safety Warning Banner */}
        <div className="mb-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] text-rose-300 text-xs flex gap-2.5 items-start">
          <Laptop className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-200">
              {t('control:power.hostWarningTitle', 'Host PC Power Warning')}
            </p>
            <p className="text-[11px] text-rose-300/90 leading-relaxed">
              {t(
                'control:power.hostWarningDesc',
                'If this computer is connected to this UPS, shutting down or cutting output power will abruptly terminate this machine and cause unsaved data loss.'
              )}
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="text-xs text-slate-300 mb-4 leading-relaxed">{description}</div>

        {/* Typed Confirmation Prompt */}
        <div className="space-y-2 mb-5">
          <label className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              {t('control:power.typePrompt', 'Type ')}
              <span className="font-mono font-semibold text-slate-200 select-all bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/[0.1]">
                {expectedConfirmationText}
              </span>
              {t('control:power.typePromptSuffix', ' to confirm:')}
            </span>
            {isMatch && (
              <span className="text-emerald-400 text-[10px] font-medium">✓ Verified</span>
            )}
          </label>
          <input
            type="text"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder={expectedConfirmationText}
            disabled={isLoading}
            autoFocus
            className="w-full px-3 py-2 text-xs rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500/60 focus:ring-1 focus:ring-rose-500/40 transition font-mono"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-2 px-3 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.08] text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-40"
          >
            {cancelLabel || t('common:buttons.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={!isMatch || isLoading}
            className={`flex-1 py-2 px-3 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 shadow-lg shadow-rose-950/50 border border-rose-500/40'
                : 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 shadow-lg shadow-amber-950/50 border border-amber-500/40'
            }`}
          >
            {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>{confirmLabel || t('common:buttons.confirm', 'Confirm Action')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
