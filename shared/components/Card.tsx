import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  padding?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  onClick,
  padding = true
}) => {
  const paddingClass = padding ? 'p-6' : '';
  const clickableClass = onClick ? 'cursor-pointer hover:shadow-xl' : '';

  return (
    <div
      className={`glass-card ${paddingClass} ${clickableClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
