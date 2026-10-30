/** WCAG sRGB luminance; keep thresholds unrounded when deciding pass/fail. */
function channels(color:string):number[]{if(!/^#[0-9a-f]{6}$/i.test(color))throw Error('Invalid opaque RGB colour');return [1,3,5].map(index=>parseInt(color.slice(index,index+2),16)/255);}
export function luminance(color:string):number{const [r,g,b]=channels(color).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
export function contrastRatio(a:string,b:string):number{const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);}
export function contrastingCasing(color:string):string{return contrastRatio(color,'#ffffff')>=contrastRatio(color,'#1b2a32')?'#ffffff':'#1b2a32';}
export function badgeTextColor(color:string):string{return contrastRatio(color,'#000000')>=contrastRatio(color,'#ffffff')?'#000000':'#ffffff';}
