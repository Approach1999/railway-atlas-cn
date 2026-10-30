import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {DatasetManifest,Palette} from '../../shared/atlas-types.ts';
import {validateManifest,validatePalette} from './dataset-validation.ts';
import {keepDialogFocus} from './dialog-focus.ts';
import {safeSourceLink,datasetSourceTime,coverageDescription} from './about-data.ts';
import {requestJson} from './json-request';
interface Props {manifest?:DatasetManifest;snapshot:string;onClose:()=>void}
const message=(error:unknown)=>error instanceof Error?error.message:'数据说明暂不可用';
function read(path:string,signal:AbortSignal):Promise<unknown>{return requestJson(path,signal,status=>Error(status===410?'此数据版本已超过保留期，请关闭说明并通过地图或列表打开当前版本。':status===404&&path.endsWith('/dataset.json')?'此版本的数据说明暂不可用，可重试或关闭后打开当前版本。':'读取失败（'+status+'）'));}
export default function AboutDialog({manifest:provided,snapshot,onClose}:Props){
  const ref=useRef<HTMLDialogElement>(null),[manifest,setManifest]=useState(provided),[error,setError]=useState(''),[loading,setLoading]=useState(!provided),[retry,setRetry]=useState(0);
  const [palette,setPalette]=useState<Palette>(),[paletteError,setPaletteError]=useState(''),[paletteLoading,setPaletteLoading]=useState(false),[paletteRetry,setPaletteRetry]=useState(0);
  const interaction=useRef(0),retryFocus=useRef<{kind:'manifest'|'palette';epoch:number}|null>(null);
  useLayoutEffect(()=>{const request=retryFocus.current;if(!request||(request.kind==='manifest'?loading:paletteLoading))return;if(request.epoch===interaction.current&&(document.activeElement===document.body||document.activeElement?.hasAttribute('data-about-retry'))){const selector=request.kind==='manifest'?(error?'[data-about-retry=manifest]':'#about-title'):(paletteError?'[data-about-retry=palette]':'#palette-provenance>summary');ref.current?.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});}retryFocus.current=null;},[loading,error,paletteLoading,paletteError]);
  useLayoutEffect(()=>{const element=ref.current,previous=document.activeElement;element?.showModal();return ()=>{element?.close();if(previous instanceof HTMLElement&&previous.isConnected&&!previous.closest('[hidden]'))previous.focus({preventScroll:true});};},[]);
  useEffect(()=>{
    if(provided){setManifest(provided);setLoading(false);return;}
    const abort=new AbortController();let active=true;setLoading(true);
    (async()=>{if(snapshot&&!/^[A-Za-z0-9_-]{1,80}$/.test(snapshot))throw Error('快照标识无效');const value=await read((snapshot?'/snapshots/'+snapshot:'')+'/dataset.json',abort.signal);validateManifest(value,snapshot||undefined);if(active){setManifest(value);setError('');}})().catch(error=>{if(active)setError(message(error));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;abort.abort();};
  },[provided,snapshot,retry]);
  useEffect(()=>{
    if(!manifest)return;
    const abort=new AbortController();let active=true;setPaletteLoading(true);
    (async()=>{const value=await read('/snapshots/'+manifest.snapshot_id+'/palette.json',abort.signal);validatePalette(value);if(value.palette_version&&manifest.palette_version&&value.palette_version!==manifest.palette_version)throw Error('配色记录版本不一致');if(active){setPalette(value);setPaletteError('');}})().catch(error=>{if(active)setPaletteError(message(error));}).finally(()=>{if(active)setPaletteLoading(false);});
    return ()=>{active=false;abort.abort();};
  },[manifest,paletteRetry]);
  const source=manifest?.source||{},sourceURL=safeSourceLink(source.endpoint||source.source_url);
  const records=manifest?[['数据版本',manifest.snapshot_id],['源数据时间',datasetSourceTime(manifest)],['构建时间',manifest.build_time],['保留期限',manifest.retention_until],['输入数据指纹',manifest.input_sha256],['原始提取指纹',source.sha256],['区域原文件指纹',source.source_pbf_sha256],['分类规则',manifest.classification_version],['关系规则',manifest.relation_version],['配色版本',manifest.palette_version],['覆盖矩形',manifest.bbox.join(' / ')]]:[];
  return <dialog ref={ref} id="about" aria-labelledby="about-title" onKeyDown={event=>keepDialogFocus(event.currentTarget,event)} onPointerDownCapture={()=>{interaction.current++;}} onKeyDownCapture={()=>{interaction.current++;}} onCancel={event=>{event.preventDefault();onClose();}}>
    <button id="about-close" onClick={onClose} className="dialog-close" aria-label="关闭数据说明">×</button><div className="eyebrow">关于这幅地图</div><h2 id="about-title" tabIndex={-1}>有来源，也有边界。</h2>
    <p>这里展示沈阳城区及周边的 OSM 样本，不是沈阳市行政边界，也不是完整全国地图。</p>
    {loading&&<p role="status">正在读取此版本的数据说明…</p>}{error&&<p role="alert">{error} <button data-about-retry="manifest" disabled={loading} onClick={()=>{retryFocus.current={kind:'manifest',epoch:interaction.current};setRetry(value=>value+1);}}>重试此版本说明</button></p>}
    <p id="dataset-info">{manifest?`铁路数据截至 ${datasetSourceTime(manifest)}。快照 ${manifest.snapshot_id}；分类规则 ${manifest.classification_version||'未标注'}；配色 ${manifest.palette_version||'未标注'}。来源：${source.provider||'未标注'}。`:'版本说明尚未就绪。'}</p>
    <details><summary>当前版本的来源与处理记录</summary><div id="provenance-info"><dl>{records.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value||'未标注'}</dd></div>)}</dl>
      {sourceURL&&<a href={sourceURL} target="_blank" rel="noopener noreferrer">查看数据来源</a>}
      {source.provider?.includes('Geofabrik')&&<p>此提供方公开文件未提供贡献者身份和修改集编号；缺失字段保持未标注。</p>}
      {manifest&&<p><a href={'/snapshots/'+manifest.snapshot_id+'/dataset.json'} target="_blank" rel="noopener noreferrer">打开此版本的数据记录</a></p>}
      <p>旧源未提供的对象版本与更新时间保持“未标注”。线路关系缺失时使用回退色，不按名称或邻近轨道推断归属。</p>
    </div></details>
    <details id="palette-provenance"><summary>线路配色来源与核对记录</summary>
      {paletteLoading&&<p role="status">正在读取此版本的配色记录…</p>}{paletteError&&<p role="alert">{paletteError} <button data-about-retry="palette" disabled={paletteLoading} onClick={()=>{retryFocus.current={kind:'palette',epoch:interaction.current};setPaletteRetry(value=>value+1);}}>重试配色记录</button></p>}
      {palette&&Object.entries(palette.operators).map(([key,operator])=><section key={key}><h3>{operator.name||key}</h3><p>{operator.source||'来源未标注'} · 置信度：{({'operator-map':'运营方线路图取色',official:'官方公布值',manual:'人工配置',osm:'OSM 源标注',fallback:'制式回退色'} as Record<string,string>)[operator.confidence||'']||operator.confidence||'未标注'} · 核对日期：{operator.verified_at||'未标注'}</p>{safeSourceLink(operator.source_url)&&<a href={safeSourceLink(operator.source_url)} target="_blank" rel="noopener noreferrer">配色来源记录</a>}</section>)}
      {palette&&<p>核对日期属于配置来源记录，不是 OSM 对象更新时间或运营状态确认；制式回退色没有独立核对日期。</p>}
    </details>
<p>数据更新为月度人工触发，不承诺实时。应用代码许可尚未选定；地图数据使用 ODbL 1.0。</p><p><a href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer">第三方许可文本</a> · <a href="/dependency-inventory.json" target="_blank" rel="noopener noreferrer">依赖与来源清单</a></p><p>名称与属性来自源标签；高铁只按显式标签识别。未标注属性不作推断，当前标注不保证运营。重点站名单仅用于标注排版，不代表车站等级或客流。</p><p id="dataset-coverage">{manifest?coverageDescription(manifest):'图层覆盖说明尚未就绪。'}</p><p>不提供时刻表、导航或实时运营信息。</p><p>界面使用设备字体；地图名称优先使用本机托管的中文字体子集，无第三方字体请求、无分析脚本。<a href="/map-font-manifest.json" target="_blank" rel="noopener noreferrer">字体来源与构建记录</a> · <a href="/map-font-license.txt" target="_blank" rel="noopener noreferrer">字体许可</a>。开启底图时，浏览器会向 tile.openstreetmap.org 请求当前视野瓦片，服务方会接收 IP、视野瓦片编号与来源站点。关闭后停止新增底图请求，已发出的请求可能完成；铁路数据继续从本机加载。</p><p>地图数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL 1.0</p><p>底图来源与使用条件：<a href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noopener noreferrer">OpenStreetMap 瓦片使用政策</a>。只按视野加载，遵循浏览器缓存，不提供离线下载。本机预览不代表已完成公开发布验收。</p>
  </dialog>;
}
