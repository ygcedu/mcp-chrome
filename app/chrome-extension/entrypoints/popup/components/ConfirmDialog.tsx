import React from 'react';
import './ConfirmDialog.css';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  items?: string[];
  warning?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
  confirmingText?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<Props> = ({
  visible,
  title,
  message,
  items,
  warning,
  icon = '⚠️',
  confirmText = '确认',
  cancelText = '取消',
  confirmingText = '处理中...',
  isConfirming = false,
  onConfirm,
  onCancel,
}) => {
  if (!visible) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div className="confirmation-dialog" onClick={handleBackdropClick}>
      <div className="dialog-content">
        <div className="dialog-header">
          <span className="dialog-icon">{icon}</span>
          <h3 className="dialog-title">{title}</h3>
        </div>

        <div className="dialog-body">
          <p className="dialog-message">{message}</p>

          {items && items.length > 0 && (
            <ul className="dialog-list">
              {items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}

          {warning && (
            <div className="dialog-warning">
              <strong>{warning}</strong>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-button cancel-button" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className="dialog-button confirm-button"
            disabled={isConfirming}
            onClick={onConfirm}
          >
            {isConfirming ? confirmingText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
