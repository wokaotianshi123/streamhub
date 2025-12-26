import React from 'react';

interface IconProps {
  name: string;
  type?: 'round' | 'outlined';
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, type = 'round', className = '' }) => {
  const familyClass = type === 'outlined' ? 'material-icons-outlined' : 'material-icons-round';
  return (
    <span className={`${familyClass} ${className} select-none pointer-events-none`}>
      {name}
    </span>
  );
};