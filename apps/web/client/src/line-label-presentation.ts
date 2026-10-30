import type {SymbolLayerSpecification} from 'maplibre-gl';
import {MAP_FONT_STACK} from './map-font.ts';

export const CAPTION_TICK='line-label-caption-tick';
/** Point placement needs a positive width. Zero folds CJK text into columns.
 * Short source paths use a horizontal caption with a joint-placed leader. */
export const shortLineLabelLayout:NonNullable<SymbolLayerSpecification['layout']>={
  'symbol-placement':'point','text-field':['get','label_text'],
  'text-font':MAP_FONT_STACK,'text-size':12,
  'text-max-width':64,'text-padding':20,'text-rotate':0,
  'text-rotation-alignment':'viewport','text-anchor':'bottom','text-offset':[0,-1.2],
  'icon-image':CAPTION_TICK,'icon-anchor':'bottom','icon-padding':1,
  'icon-optional':false,'text-optional':false,
};
export function createCaptionTick(){
  const data=new Uint8Array(2*12*4);
  for(let i=0;i<data.length;i+=4)data.set([80,105,117,200],i);
  return {width:2,height:12,data};
}
