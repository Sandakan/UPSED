import React from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  title?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  readOnly = false,
  title,
  className = '',
  size = 'md',
}) => {
  const isLocked = disabled || readOnly;

  return (
    <label
      className={`relative inline-flex items-center transition-opacity ${
        isLocked ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
      } ${className}`}
      title={title || (isLocked ? 'Read-only' : undefined)}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isLocked}
        readOnly={readOnly}
        onChange={(e) => {
          if (!isLocked && onChange) {
            onChange(e.target.checked);
          }
        }}
        className="sr-only peer"
      />
      <div
        className={`${
          size === 'sm' ? 'w-9 h-5' : 'w-11 h-6'
        } bg-white/[0.08] border border-white/[0.1] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full ${
          size === 'sm' ? 'after:h-4 after:w-4' : 'after:h-5 after:w-5'
        } after:transition-all peer-checked:bg-[#22c55e] peer-focus:outline-none`}
      />
    </label>
  );
};
