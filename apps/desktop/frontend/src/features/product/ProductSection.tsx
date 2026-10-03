import type { DownloadSelection } from '@ytdl-flow/contracts';
import { useState } from 'react';

import type { ProductFlowState } from './product-flow-controller';

export interface ProductSectionProps {
  state: ProductFlowState;
  canCreateDownload: boolean;
  onInputChange(value: string): void;
  onAnalyze(): void;
  onDownload(selection: DownloadSelection): void;
}

const selections: Array<{ value: DownloadSelection; label: string }> = [
  { value: 'video-auto', label: '视频（自动选择源格式）' },
  { value: 'audio-mp3', label: '音频 MP3' },
];

export function ProductSection({
  state,
  canCreateDownload,
  onInputChange,
  onAnalyze,
  onDownload,
}: ProductSectionProps) {
  const [selection, setSelection] = useState<DownloadSelection>('video-auto');
  const flowError = state.analyzeError ?? state.submitError;

  return (
    <section className="neo-box product-section" aria-labelledby="product-title">
      <div className="product-heading">
        <div>
          <p className="neo-kicker">单链接下载</p>
          <h1 id="product-title" className="product-title">
            解析并选择下载类型
          </h1>
        </div>
        {state.analyzing ? <span className="neo-count">解析中…</span> : null}
      </div>

      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAnalyze();
        }}
      >
        <label className="product-input-label" htmlFor="product-url">
          视频链接
        </label>
        <div className="product-input-row">
          <input
            id="product-url"
            className="neo-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="粘贴单个视频链接（http/https）"
            value={state.input}
            onChange={(event) => onInputChange(event.target.value)}
          />
          <button type="submit" className="neo-button" disabled={state.analyzing}>
            {state.analyzing ? '解析中…' : '解析'}
          </button>
        </div>
      </form>

      {flowError ? (
        <p className="neo-error" role="alert">
          {flowError.message}
        </p>
      ) : null}

      {state.analysis ? (
        <div className="analysis-card" data-testid="analysis-card" aria-live="polite">
          <div className="analysis-thumb" aria-hidden="true">
            封面
          </div>
          <div className="analysis-copy">
            <p className="analysis-title">{state.analysis.title}</p>
            <p className="analysis-meta">作者：{state.analysis.channel ?? '未知作者'}</p>
            <p className="analysis-meta">时长：{state.analysis.durationLabel ?? '时长未知'}</p>
            <p className="analysis-source">{state.analysis.sourceUrl}</p>
          </div>
        </div>
      ) : (
        <p className="product-hint">解析成功后可选择下载类型，并创建真实下载任务。</p>
      )}

      <div className="selection-group" role="group" aria-label="下载类型">
        {selections.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="neo-button selection-button"
            aria-pressed={selection === value}
            onClick={() => setSelection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="neo-button neo-button-primary"
        disabled={!canCreateDownload}
        onClick={() => onDownload(selection)}
      >
        {state.submitting ? '正在创建任务…' : '开始下载'}
      </button>
    </section>
  );
}
