import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  isLoading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * PrimaryButton — High-contrast, tactile call-to-action button designed for dark mode.
 * Solves the neon glare and low-contrast issues of pure bright green by using
 * rich emerald-600 with crisp white typography and comfortable vertical padding.
 */
export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  (
    {
      children,
      className,
      icon,
      iconPosition = 'left',
      isLoading = false,
      disabled = false,
      size = 'md',
      fullWidth = false,
      variant = 'primary',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const sizeStyles = {
      sm: 'py-1.5 px-3 text-xs gap-1.5 rounded-lg',
      md: 'py-2 px-3.5 sm:px-4 text-xs font-semibold gap-1.5 sm:gap-2 rounded-xl',
      lg: 'py-2.5 px-5 text-sm font-semibold gap-2 rounded-xl',
    };

    const variantStyles = {
      primary:
        'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white border border-emerald-500/40 shadow-sm shadow-emerald-950/40',
      secondary:
        'bg-white/[0.06] hover:bg-white/[0.1] active:bg-white/[0.14] text-slate-200 border border-white/[0.1] shadow-sm',
      danger:
        'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white border border-rose-500/40 shadow-sm shadow-rose-950/40',
    };

    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center font-sans tracking-normal transition-all duration-150 select-none cursor-pointer shrink-0',
          sizeStyles[size],
          variantStyles[variant],
          fullWidth && 'w-full',
          isDisabled && 'opacity-40 cursor-not-allowed pointer-events-none shadow-none',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          icon && iconPosition === 'left' && <span className="shrink-0 flex items-center">{icon}</span>
        )}

        {children}

        {!isLoading && icon && iconPosition === 'right' && (
          <span className="shrink-0 flex items-center">{icon}</span>
        )}
      </button>
    );
  }
);

PrimaryButton.displayName = 'PrimaryButton';

export default PrimaryButton;

