import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className = '',
  children,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center rounded-lg border font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'flow-button border-[color:color-mix(in_srgb,var(--brand-cyan)_44%,var(--line))] text-white shadow-sm hover:border-[color:var(--brand-cyan)] hover:shadow-md',
    secondary: 'border-[color:color-mix(in_srgb,var(--brand-amber)_44%,var(--line))] bg-[color:color-mix(in_srgb,var(--brand-amber)_18%,var(--surface-strong))] text-[color:var(--text-primary)] shadow-sm hover:border-[color:var(--brand-amber)] hover:shadow-md',
    outline: 'border-[color:var(--line)] bg-transparent text-[color:var(--text-primary)] hover:bg-[color:var(--surface-muted)]',
    ghost: 'border-transparent bg-transparent text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-muted)]'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {children}
        </>
      ) : children}
    </button>
  );
};
