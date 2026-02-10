import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  disabled,
  className = ''
}) => {
  return (
    <label className={`inline-flex items-center space-x-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <div
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 shadow-inner ${
          checked
            ? 'bg-gradient-to-r from-blue-500 to-blue-600'
            : 'bg-gray-300 dark:bg-gray-600'
        }`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-all duration-300 shadow-md ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
      {label && (
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {label}
        </span>
      )}
    </label>
  );
};
