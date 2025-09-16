import React from 'react';
import './ProgressIndicator.css';

interface Props {
  visible?: boolean;
  text: string;
  showSpinner?: boolean;
}

const ProgressIndicator: React.FC<Props> = ({ visible = true, text, showSpinner = true }) => {
  if (!visible) return null;

  return (
    <div className="progress-section">
      <div className="progress-indicator">
        {showSpinner && <div className="spinner"></div>}
        <span className="progress-text">{text}</span>
      </div>
    </div>
  );
};

export default ProgressIndicator;
