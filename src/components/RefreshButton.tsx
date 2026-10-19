import React from 'react';
import { RefreshCw } from 'lucide-react';

export interface RefreshButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  label?: string;
  loadingLabel?: string;
  title?: string;
  className?: string;
  iconClassName?: string;
}

export const RefreshButton: React.FC<RefreshButtonProps> = ({
  onClick,
  isLoading = false,
  disabled = false,
  label = 'Refresh',
  loadingLabel = 'Reading...',
  title = 'Refresh',
  className = '',
  iconClassName = 'text-emerald-400',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`flex items-center space-x-1.5 py-1.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] text-slate-200 border border-white/[0.08] text-xs transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed self-start sm:self-auto ${className}`}
      title={title}
    >
      <RefreshCw
        className={`w-3.5 h-3.5 ${iconClassName} ${isLoading ? 'animate-spin' : ''}`}
      />
      <span>{isLoading ? loadingLabel : label}</span>
    </button>
  );
};
