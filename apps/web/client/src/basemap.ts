import type {Map, MapSourceDataEvent, ErrorEvent} from 'maplibre-gl';

export const BASEMAP_SOURCE = 'context-basemap';
export const BASEMAP_LAYER = 'context-basemap-raster';
export const PREFERENCE_KEY = 'railway-atlas:basemap:v1';
export type BasemapStatus = 'off' | 'loading' | 'ready' | 'failed';
export interface BasemapConfig {
  schema_version: number;
  id: string;
  name: string;
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  opacity: number;
  saturation: number;
  contrast: number;
  attribution: string;
  request_domains: string[];
  preview_proxy?: boolean;
}

export function readPreference(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {return storage?.getItem(PREFERENCE_KEY) !== 'false';}
  catch {return true;}
}

export function savePreference(storage: Pick<Storage, 'setItem'> | null, enabled: boolean): void {
  try {storage?.setItem(PREFERENCE_KEY, String(enabled));}
  catch {/* Browsing works when storage is disabled or full. */}
}

export function validateConfig(value: unknown): BasemapConfig {
  if (!value || typeof value !== 'object') throw new Error('底图配置无效');
  const c = value as BasemapConfig;
  if (c.schema_version !== 1 || !c.id || !c.name || !Array.isArray(c.tiles) || !c.tiles.length ||
      !Array.isArray(c.request_domains) || !c.request_domains.length ||
      !Number.isFinite(c.opacity) || c.opacity < 0 || c.opacity > 1 ||
      !Number.isFinite(c.saturation) || c.saturation < -1 || c.saturation > 1 ||
      !Number.isFinite(c.contrast) || c.contrast < -1 || c.contrast > 1 ||
      !Number.isInteger(c.tileSize) || c.tileSize < 1 ||
      !Number.isInteger(c.maxzoom) || c.maxzoom < 0 || c.maxzoom > 22 ||
      typeof c.attribution !== 'string') throw new Error('底图配置不完整');
  for (const template of c.tiles) {
    if(c.preview_proxy===true&&template==='/preview-basemap/{z}/{x}/{y}.png'&&c.request_domains.includes('self'))continue;
    const url = new URL(template);
    if (url.protocol !== 'https:' || !c.request_domains.includes(url.hostname) ||
        !['{z}', '{x}', '{y}'].every(token => template.includes(token))) {
      throw new Error('底图地址与来源声明不一致');
    }
  }
  // Attribution is trusted application configuration, never OSM feature text.
  return c;
}

/** A separate source/layer; never replace the railway style or change camera state. */
export class BasemapController {
  private enabled = false;
  private disposed = false;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private status: BasemapStatus = 'off';
  private readonly map: Map;
  private readonly config: BasemapConfig;
  private readonly onStatus: (status: BasemapStatus) => void;
  private readonly timeoutMs: number;

  constructor(
    map: Map,
    config: BasemapConfig,
    onStatus: (status: BasemapStatus) => void,
    timeoutMs = 15000,
  ) {
    this.map = map;
    this.config = config;
    this.onStatus = onStatus;
    this.timeoutMs = timeoutMs;
    map.on('load', this.onLoad);
    map.on('idle', this.onLoad);
    map.on('sourcedata', this.onSourceData);
    map.on('error', this.onError);
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      this.detach();
      this.emit('off');
    } else {
      this.failed = false;
      if (this.map.isStyleLoaded()) this.attach(); else this.emit('loading');
    }
  }

  retry(): void {
    if (!this.enabled || this.disposed) return;
    this.detach();
    this.attach();
  }

  destroy(): void {
    this.disposed = true;
    this.map.off('load', this.onLoad);
    this.map.off('idle', this.onLoad);
    this.map.off('sourcedata', this.onSourceData);
    this.map.off('error', this.onError);
    this.detach();
  }

  private emit(status: BasemapStatus): void {
    this.status = status;
    if (!this.disposed) this.onStatus(status);
  }

  private onLoad = (): void => {
    if (this.enabled && !this.disposed && !this.failed) this.attach();
  };

  private onSourceData = (event: MapSourceDataEvent): void => {
    const tileReady = event.tile?.state === 'loaded';
    const sourceReady = event.sourceDataType === 'idle' && event.isSourceLoaded;
    if (event.sourceId === BASEMAP_SOURCE && (tileReady || sourceReady) &&
        this.enabled && (tileReady || !this.failed) && this.map.getSource(BASEMAP_SOURCE)) {
      clearTimeout(this.timer);
      this.failed = false;
      this.emit('ready');
    }
  };

  private onError = (event: ErrorEvent & {sourceId?: string}): void => {
    if (event.sourceId === BASEMAP_SOURCE && this.enabled && this.map.getSource(BASEMAP_SOURCE)) {
      this.fail();
    }
  };

  private fail(): void {
    this.failed = true;
    // A tile error is local to that tile. Keep the source and loaded imagery so
    // subsequent zoom/pan requests can succeed without a manual retry.
    clearTimeout(this.timer);
    this.emit('failed');
  }

  private attach(): void {
    if (this.disposed || !this.enabled || this.map.getSource(BASEMAP_SOURCE)) return;
    this.failed = false;
    this.emit('loading');
    try {
      this.map.addSource(BASEMAP_SOURCE, {
        type: 'raster', tiles: this.config.tiles, tileSize: this.config.tileSize,
        maxzoom: this.config.maxzoom, attribution: this.config.attribution,
      });
      const before = this.map.getStyle().layers?.find(layer => layer.type !== 'background')?.id;
      this.map.addLayer({
        id: BASEMAP_LAYER, type: 'raster', source: BASEMAP_SOURCE,
        paint: {
          'raster-opacity': this.config.opacity,
          'raster-saturation': this.config.saturation,
          'raster-contrast': this.config.contrast,
          'raster-fade-duration': 0,
        },
      }, before);
      this.timer = setTimeout(() => {
        if (this.enabled && this.status === 'loading') this.fail();
      }, this.timeoutMs);
    } catch {
      this.fail();
    }
  }

  private detach(): void {
    clearTimeout(this.timer);
    if (!this.map.getStyle()) return;
    if (this.map.getLayer(BASEMAP_LAYER)) this.map.removeLayer(BASEMAP_LAYER);
    if (this.map.getSource(BASEMAP_SOURCE)) this.map.removeSource(BASEMAP_SOURCE);
  }
}
