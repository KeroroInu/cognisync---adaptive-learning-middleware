import React from 'react';

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'search';
  disabled?: boolean;
  error?: string;
  label?: string;
  className?: string;
}

export const Input: React.FC<InputProps> = ({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  error,
  label,
  className = ''
}) => {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label
          className="block text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-4 py-2 rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 ${
          error ? 'ring-2 ring-rose-500' : 'focus:ring-blue-500'
        }`}
        style={{
          backgroundColor: 'var(--glass-bg)',
          border: `1px solid ${error ? '#f43f5e' : 'var(--glass-border)'}`,
          color: 'var(--text-primary)'
        }}
      />
      {error && (
        <p className="text-sm" style={{ color: '#f43f5e' }}>
          {error}
        </p>
      )}
    </div>
  );
};
