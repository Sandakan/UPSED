import React, { useState, useEffect } from 'react';
import { AlertTriangle, Trash2, X, RefreshCw } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  itemCount?: number;
  icon?: React.ReactNode;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Clear Event History?',
  description,
  confirmLabel = 'Clear All Events',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  itemCount,
  icon,
}) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  // Manage enter and exit animation lifecycle
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
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!shouldRender) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-rose-950/70 border-rose-800/60 text-rose-400',
          btnConfirm:
            'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg shadow-rose-950/50 border border-rose-500/40',
          badge: 'bg-rose-950/40 border-rose-800/60 text-rose-300',
          defaultIcon: <Trash2 className="w-5 h-5 text-rose-400" />,
        };
      case 'warning':
        return {
          iconBg: 'bg-amber-950/70 border-amber-800/60 text-amber-400',
          btnConfirm:
            'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-lg shadow-amber-950/50 border border-amber-500/40',
          badge: 'bg-amber-950/40 border-amber-800/60 text-amber-300',
          defaultIcon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
        };
      case 'info':
      default:
        return {
          iconBg: 'bg-cyan-950/70 border-cyan-800/60 text-cyan-400',
          btnConfirm:
            'bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white shadow-lg shadow-cyan-950/50 border border-cyan-500/40',
          badge: 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300',
          defaultIcon: <AlertTriangle className="w-5 h-5 text-cyan-400" />,
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className={`bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col ${
          isClosing ? 'animate-modal-out' : 'animate-modal-in'
        }`}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-start justify-between bg-slate-950/40">
          <div className="flex items-center space-x-3.5">
            <div className={`p-2.5 rounded-xl border ${styles.iconBg}`}>
              {icon || styles.defaultIcon}
            </div>
            <div>
              <h3
                id="confirm-modal-title"
                className="text-base font-semibold text-slate-100"
              >
                {title}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Permanent action</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition disabled:opacity-40"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-3.5 text-xs text-slate-300 leading-relaxed">
          {description ? (
            <div>{description}</div>
          ) : (
            <p>
              Are you sure you want to permanently clear all stored event logs
              from the local database?
            </p>
          )}

          {/* Item Count Notice */}
          {typeof itemCount === 'number' && itemCount > 0 && (
            <div
              className={`p-3 rounded-xl border flex items-center space-x-2.5 ${styles.badge}`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong>{itemCount}</strong> recorded event
                {itemCount === 1 ? '' : 's'} will be permanently deleted.
              </span>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            This action cannot be undone. Historical outage logs, low battery
            warnings, and transition timestamps will be purged from the database.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950/50 border-t border-slate-800/80 flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition disabled:opacity-40 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-xs font-semibold rounded-xl transition flex items-center space-x-2 cursor-pointer disabled:opacity-50 ${styles.btnConfirm}`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Clearing...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>{confirmLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

