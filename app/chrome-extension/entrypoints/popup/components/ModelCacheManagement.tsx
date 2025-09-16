import React from 'react';
import ProgressIndicator from './ProgressIndicator';
import { DatabaseIcon, VectorIcon, TrashIcon } from './icons';
import './ModelCacheManagement.css';

interface CacheEntry {
  url: string;
  size: number;
  sizeMB: number;
  timestamp: number;
  age: string;
  expired: boolean;
}

interface CacheStats {
  totalSize: number;
  totalSizeMB: number;
  entryCount: number;
  entries: CacheEntry[];
}

interface Props {
  cacheStats: CacheStats | null;
  isManagingCache: boolean;
  onCleanupCache: () => void;
  onClearAllCache: () => void;
}

const ModelCacheManagement: React.FC<Props> = ({
  cacheStats,
  isManagingCache,
  onCleanupCache,
  onClearAllCache,
}) => {
  const getModelNameFromUrl = (url: string) => {
    // Extract model name from HuggingFace URL
    const match = url.match(/huggingface\.co\/([^/]+\/[^/]+)/);
    if (match) {
      return match[1];
    }
    return url.split('/').pop() || url;
  };

  return (
    <div className="model-cache-section">
      <h2 className="section-title">模型缓存管理</h2>

      {/* Cache Statistics Grid */}
      <div className="stats-grid">
        <div className="stats-card">
          <div className="stats-header">
            <p className="stats-label">缓存大小</p>
            <span className="stats-icon orange">
              <DatabaseIcon />
            </span>
          </div>
          <p className="stats-value">{cacheStats?.totalSizeMB || 0} MB</p>
        </div>

        <div className="stats-card">
          <div className="stats-header">
            <p className="stats-label">缓存条目</p>
            <span className="stats-icon purple">
              <VectorIcon />
            </span>
          </div>
          <p className="stats-value">{cacheStats?.entryCount || 0}</p>
        </div>
      </div>

      {/* Cache Entries Details */}
      {cacheStats && cacheStats.entries.length > 0 && (
        <div className="cache-details">
          <h3 className="cache-details-title">缓存详情</h3>
          <div className="cache-entries">
            {cacheStats.entries.map((entry, index) => (
              <div key={entry.url || index} className="cache-entry">
                <div className="entry-info">
                  <div className="entry-url">{getModelNameFromUrl(entry.url)}</div>
                  <div className="entry-details">
                    <span className="entry-size">{entry.sizeMB} MB</span>
                    <span className="entry-age">{entry.age}</span>
                    {entry.expired && <span className="entry-expired">已过期</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Cache Message */}
      {cacheStats && cacheStats.entries.length === 0 && (
        <div className="no-cache">
          <p>暂无缓存数据</p>
        </div>
      )}

      {/* Loading State */}
      {!cacheStats && (
        <div className="loading-cache">
          <p>正在加载缓存信息...</p>
        </div>
      )}

      {/* Progress Indicator */}
      <ProgressIndicator
        visible={isManagingCache}
        text={isManagingCache ? '处理缓存中...' : ''}
        showSpinner={true}
      />

      {/* Action Buttons */}
      <div className="cache-actions">
        <div
          className={`secondary-button ${isManagingCache ? 'disabled' : ''}`}
          onClick={!isManagingCache ? onCleanupCache : undefined}
        >
          <span className="stats-icon">
            <DatabaseIcon />
          </span>
          <span>{isManagingCache ? '清理中...' : '清理过期缓存'}</span>
        </div>

        <div
          className={`danger-button ${isManagingCache ? 'disabled' : ''}`}
          onClick={!isManagingCache ? onClearAllCache : undefined}
        >
          <span className="stats-icon">
            <TrashIcon />
          </span>
          <span>{isManagingCache ? '清空中...' : '清空所有缓存'}</span>
        </div>
      </div>
    </div>
  );
};

export default ModelCacheManagement;
