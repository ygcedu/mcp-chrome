import React from 'react';

interface Props {
  className?: string;
}

const VectorIcon: React.FC<Props> = ({ className = 'icon-default' }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 4.5a4.5 4.5 0 0 1 6 0M9 4.5V3a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3v1.5M9 4.5a4.5 4.5 0 0 0-4.5 4.5v7.5A1.5 1.5 0 0 0 6 18h12a1.5 1.5 0 0 0 1.5-1.5V9a4.5 4.5 0 0 0-4.5-4.5M12 12l2.25 2.25M12 12l-2.25-2.25M12 12v6"
      />
    </svg>
  );
};

export default VectorIcon;
