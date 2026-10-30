import {useLayoutEffect,useRef,useState} from 'react';
import {keepDialogFocus} from './dialog-focus.ts';
import {encodeView} from './view-state.ts';
import type {ShareContext,ShareMode} from './share-session.ts';
interface Props {context:ShareContext;onClose:()=>void}
export default function ShareDialog({context,onClose}:Props){
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
  const [mode,setMode]=useState<ShareMode>('visible'),[status,setStatus]=useState(''),[copying,setCopying]=useState(false);
  const attempt=useRef(0),interaction=useRef(0);
  const url=new URL(encodeView(context[mode]),location.origin).href;
  useLayoutEffect(()=>{
    const element=dialog.current,previous=document.activeElement;
    element?.showModal();input.current?.focus();input.current?.select();
    return ()=>{attempt.current++;element?.close();if(previous instanceof HTMLElement&&previous.isConnected&&!previous.closest('[hidden]'))previous.focus({preventScroll:true});};
  },[]);
  function choose(value:ShareMode){attempt.current++;setMode(value);setStatus('');setCopying(false);}
  async function copy(){
    const token=++attempt.current,epoch=interaction.current;setCopying(true);setStatus('正在复制…');
    try{
      if(!navigator.clipboard)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if(token===attempt.current){setStatus('链接已复制。');setCopying(false);}
    }catch{
      if(token!==attempt.current)return;
      setCopying(false);setStatus('无法自动复制，请复制分享链接。');
      if(epoch===interaction.current){input.current?.focus();input.current?.select();}
    }
  }
  return <dialog ref={dialog} id="share-dialog" aria-labelledby="share-title" aria-describedby="share-description" onKeyDown={event=>keepDialogFocus(event.currentTarget,event)} onCancel={event=>{event.preventDefault();onClose();}} onPointerDownCapture={()=>{interaction.current++;}} onKeyDownCapture={()=>{interaction.current++;}}>
    <button id="share-close" className="dialog-close" aria-label="关闭分享" onClick={onClose}>×</button>
    <h2 id="share-title">分享这幅铁路图</h2>
    <p id="share-description" className="feature-note">链接包含视图、图层、查询、选中对象和铁路数据版本。底图偏好保留在各自浏览器中。</p>
    <fieldset className="share-options"><legend>分享方式</legend>
      <label className="check"><input type="radio" name="share-mode" value="visible" checked={mode==='visible'} onChange={()=>choose('visible')}/>按当前所见分享</label>
      <label className="check"><input type="radio" name="share-mode" value="original" checked={mode==='original'} onChange={()=>choose('original')}/>保留原筛选分享</label>
    </fieldset>
    <p id="share-mode-description" className="feature-note">{context.isolatedLine?(mode==='visible'?'接收方将按当前单线视图打开。':'接收方将按进入“仅看此线”之前的筛选打开。'):'当前没有临时单线筛选，两种方式的图层相同。'}切换分享方式不会改变这张地图。</p>
    {context.temporaryFeature&&<p className="feature-note">选中对象会随链接临时显示；关闭详情后恢复链接中的筛选。</p>}
    <label htmlFor="share-link">分享链接</label><input ref={input} id="share-link" aria-describedby="share-mode-description" readOnly value={url} onFocus={event=>event.target.select()}/>
    <button id="share-copy" disabled={copying} onClick={()=>{void copy();}}>{copying?'正在复制…':'复制链接'}</button><p id="share-status" role="status">{status}</p>
  </dialog>;
}
