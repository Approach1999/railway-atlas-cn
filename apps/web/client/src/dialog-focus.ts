/** Keep native modal keyboard traversal inside the first/last visible control. */
export function keepDialogFocus(container:HTMLElement,event:{key:string;shiftKey:boolean;preventDefault:()=>void}){
  if(event.key!=='Tab')return;
  const controls=[...container.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),summary,a[href],[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length);
  const first=controls[0],last=controls.at(-1),active=document.activeElement;
  if(!first||!last)return;
  if(event.shiftKey&&(active===first||!container.contains(active))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!container.contains(active))){event.preventDefault();first.focus();}
}
