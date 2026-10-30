import {useEffect, useRef, useState} from 'react';
import type {Map} from 'maplibre-gl';
import {
  BasemapController, readPreference, savePreference, validateConfig,
  type BasemapStatus,
} from './basemap';

function storage(): Storage | null {
  try {return window.localStorage;} catch {return null;}
}

export function BasemapControl({map}: {map: Map | null}) {
  const [enabled, setEnabled] = useState(() => readPreference(storage()));
  const [status, setStatus] = useState<BasemapStatus>('off');
  const [configFailed, setConfigFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<BasemapController | null>(null);
  const wanted = useRef(enabled);
  wanted.current = enabled;

  useEffect(() => {
    if (!map) return;
    const abort = new AbortController();
    setConfigFailed(false);
    // Fetch local configuration only. The raster source is created only when enabled.
    fetch('/basemap.json', {signal: abort.signal})
      .then(async response => {
        if (!response.ok) throw new Error('底图配置读取失败');
        return validateConfig(await response.json());
      })
      .then(config => {
        if (abort.signal.aborted) return;
        controller.current = new BasemapController(map, config, setStatus);
        controller.current.setEnabled(wanted.current);
      })
      .catch(() => {
        if (!abort.signal.aborted) {setConfigFailed(true); setStatus('failed');}
      });
    return () => {
      abort.abort();
      controller.current?.destroy();
      controller.current = null;
    };
  }, [map, attempt]);

  function toggle() {
    const next = !enabled;
    wanted.current = next;
    setEnabled(next);
    savePreference(storage(), next);
    controller.current?.setEnabled(next);
    if (!next) setStatus('off');
  }

  const failed = enabled && (status === 'failed' || configFailed);
  return <div className="basemap-tools">
    <button id="basemap-toggle" role="switch" aria-checked={enabled}
      title="切换底图，保留铁路、站名和当前视野" onClick={toggle}>
      <span className={'switch-dot' + (enabled ? ' enabled' : '')} aria-hidden="true" />
      显示底图 <span className="basemap-state">{enabled ? '开' : '关'}</span>
    </button>
    <div id="basemap-status" role="status" aria-live="polite"
      className={failed ? 'basemap-message' : 'sr-only'}>
      {failed ? <>底图暂不可用，铁路仍可浏览。<button id="basemap-retry" onClick={() => {
        if (configFailed) setAttempt(value => value + 1); else controller.current?.retry();
      }}>重试</button></> : enabled ? status === 'ready' ? '底图已显示' : '底图加载中' : '底图已隐藏'}
    </div>
  </div>;
}
