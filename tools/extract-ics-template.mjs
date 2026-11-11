import fs from 'node:fs';
import XLSX from '../packages/api/node_modules/xlsx/xlsx.mjs';
import {createHash} from 'node:crypto';
const bytes=fs.readFileSync('Appendix 59 - ICS.xls'),w=XLSX.read(bytes,{bookFiles:true,cellStyles:true}),s=w.Sheets.ICS;
const b=Buffer.from(w.cfb.FileIndex.find(x=>x.name==='Workbook').content),fonts=[],xfs=[],cells={};
let defaultHeight=15;
for(let p=0;p+4<b.length;){const id=b.readUInt16LE(p),n=b.readUInt16LE(p+2),v=b.subarray(p+4,p+4+n);p+=4+n;
if(id===0x225 && n>=4)defaultHeight=v.readUInt16LE(2)/20;
if(id===49){if(fonts.length===4)fonts.push(null);fonts.push({name:v.subarray(16,16+v[14]*(v[15]?2:1)).toString(v[15]?'utf16le':'latin1'),size:v.readUInt16LE(0)/20,bold:v.readUInt16LE(6)>=700,italic:!!(v.readUInt16LE(2)&2)});}
if(id===224){const borders=v.readUInt32LE(10);xfs.push({fontId:v.readUInt16LE(0),alignment:{horizontal:['general','left','center','right','fill','justify','centerContinuous','distributed'][v[6]&7],vertical:['top','middle','bottom','justify','distributed'][(v[6]>>4)&7]||'middle',wrapText:!!(v[6]&8)},border:Object.fromEntries(['left','right','top','bottom'].map((k,i)=>[k,({0:undefined,1:{style:'thin'},2:{style:'medium'},3:{style:'dashed'},6:{style:'double'}})[(borders>>(i*4))&15]]))});}
if([513,515,517,253].includes(id)&&n>=6){const r=v.readUInt16LE(0),c=v.readUInt16LE(2);if(r<51&&c<8)cells[XLSX.utils.encode_cell({r,c})]=v.readUInt16LE(4);}
if(id===190){const r=v.readUInt16LE(0),c=v.readUInt16LE(2),end=v.readUInt16LE(n-2);for(let col=c;col<=end;col++)if(r<51&&col<8)cells[XLSX.utils.encode_cell({r,c:col})]=v.readUInt16LE(4+(col-c)*2);}
}
const result={sourceHash:createHash('sha256').update(bytes).digest('hex'),widths:s['!cols'].slice(0,8).map(c=>c.width),heights:Array.from({length:51},(_,i)=>s['!rows'][i]?.hpt??defaultHeight),merges:s['!merges'].filter(m=>m.e.r<51).map(m=>XLSX.utils.encode_range(m)),cells:Object.fromEntries(Object.entries(cells).map(([key,xf])=>[key,{value:s[key]?.v??null,font:fonts[xfs[xf]?.fontId]??{name:'Times New Roman',size:12},alignment:xfs[xf]?.alignment,border:xfs[xf]?.border}]))};
fs.writeFileSync('packages/api/src/ics-template.ts','// Geometry and styles extracted from the unmodified Appendix 59 - ICS.xls.\n// Source-only formatting beyond A1:H51 is intentionally excluded.\nconst template = '+JSON.stringify(result)+';\nexport default template;\n');
