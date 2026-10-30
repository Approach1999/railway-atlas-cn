import type {ShareView} from './view-state.ts';
export type ShareMode='visible'|'original';
export interface ShareContext {readonly original:ShareView;readonly visible:ShareView;readonly isolatedLine:string|null;readonly temporaryFeature:boolean}
function copy(view:ShareView):ShareView{return {...view,filters:{...view.filters,types:[...view.filters.types],classes:[...view.filters.classes],states:[...view.filters.states],lineKeys:view.filters.lineKeys===null?null:[...view.filters.lineKeys]}};}
export function captureShareContext(view:ShareView,isolatedLine:string|null,temporaryFeature:boolean):ShareContext{
  const original=copy(view),visible=copy(view);
  if(isolatedLine){visible.filters.types=['subway','light_rail','tram'];visible.filters.lineKeys=[isolatedLine];}
  return {original,visible,isolatedLine,temporaryFeature};
}
