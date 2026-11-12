import ExcelJS from "exceljs";
import template from "./ics-template-v2";
import { icsCost } from "./ics-workbook-v1";
import type { IcsPayload } from "./ics-workbook";

type SourceCell = { style: Partial<ExcelJS.Style>; value: string | number | null };
const sourceCells = template.cells as Record<string,SourceCell>;
const fontSize = 11;
const lineHeight = 14;
const maxLinesPerBlock = 14;
const rowHeight = (row:number) => template.heights[row-1] ?? 14.4;
const columnWidth = (first:number,last:number) => template.widths.slice(first-1,last).reduce((sum,width)=>sum+(width*7+5)*0.75,0)-10;

/** Conservative Calibri 11 glyph widths; text is never dropped or shrunk. */
export function wrapIcsText(text:string,width:number):string[] {
  const result:string[]=[];
  let buffer="", used=0;
  const measure=(char:string) => /[\r\n]/.test(char)?0:/\s/.test(char)?0.28:/[ilI.,:;'!|]/.test(char)?0.3:/[MW@#%]/.test(char)?0.94:(char.codePointAt(0)??0)>255?1:0.58;
  const appendCharacters=(token:string)=>{
    for(const char of Array.from(token)){
      const size=measure(char)*fontSize;
      if(buffer&&used+size>width){result.push(buffer);buffer="";used=0;}
      buffer+=char;used+=size;
    }
  };
  for(const token of text.match(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu)??[]){
    if(/^[\r\n]+$/.test(token)){buffer+=token;result.push(buffer);buffer="";used=0;continue;}
    const size=Array.from(token).reduce((sum,char)=>sum+measure(char)*fontSize,0);
    if(!/^\s+$/.test(token)&&size<=width&&buffer&&used+size>width){result.push(buffer);buffer="";used=0;}
    appendCharacters(token);
  }
  if(buffer || result.length===0)result.push(buffer);
  return result;
}
function cellStyle(sheet:ExcelJS.Worksheet,row:number,col:number,sourceRow:number) {
  sheet.getCell(row,col).style=structuredClone(sourceCells[`${String.fromCharCode(64+col)}${sourceRow}`]!.style);
}
function restoreEdges(sheet:ExcelJS.Worksheet,row:number,col:number,sourceRow:number) {
  const cell=sheet.getCell(row,col);
  cell.style={...cell.style,border:structuredClone(sourceCells[`${String.fromCharCode(64+col)}${sourceRow}`]!.style.border??{})};
}

/** Long bond (Folio): fixed source fonts, expanding item blocks and repeated headings. */
export async function renderIcsV2(data:IcsPayload) {
  const book=new ExcelJS.Workbook();
  const sheet=book.addWorksheet("ICS",{properties:{defaultRowHeight:14.4}});
  sheet.columns=template.widths.map(width=>({width}));
  for(let row=1;row<=11;row++) {
    sheet.getRow(row).height=rowHeight(row);
    for(let col=1;col<=8;col++) {
      cellStyle(sheet,row,col,row);
      sheet.getCell(row,col).value=sourceCells[`${String.fromCharCode(64+col)}${row}`]!.value;
    }
  }
  const headerMerges=template.merges.filter(range=>Math.max(...range.match(/\d+/g)!.map(Number))<=11);
  for(const range of headerMerges)sheet.mergeCells(range);
  sheet.mergeCells("A7:F7");sheet.mergeCells("G7:H7");
  for(let row=1;row<=11;row++)for(let col=1;col<=8;col++)restoreEdges(sheet,row,col,row);
  sheet.getCell("A5").value=`Entity Name: ${data.details.entity}`;
  sheet.getCell("A7").value=`Fund Cluster : ${data.fundCluster}`;
  sheet.getCell("G7").value=`ICS No : ${data.details.number}`;
  for(const address of ["A5","A7","G7"])sheet.getCell(address).alignment={...sheet.getCell(address).alignment,wrapText:true};
  const entityHeight=wrapIcsText(`Entity Name: ${data.details.entity}`,columnWidth(1,4)).length*14;
  if(entityHeight>rowHeight(5)+rowHeight(6))sheet.getRow(5).height=entityHeight-rowHeight(6)+4;
  const metadataLines=Math.max(wrapIcsText(`Fund Cluster : ${data.fundCluster}`,columnWidth(1,6)).length,wrapIcsText(`ICS No : ${data.details.number}`,columnWidth(7,8)).length);
  sheet.getRow(7).height=metadataLines===1?rowHeight(7):metadataLines*14+2;
  const headerHeight=Array.from({length:11},(_,i)=>sheet.getRow(i+1).height??14.4).reduce((a,b)=>a+b,0);
  const pageHeight=13*72-(template.margins.top+template.margins.bottom)*72-headerHeight;
  if(pageHeight<240)throw new Error("ICS headings are too long for the printable page.");
  let cursor=12,used=0,pages=1;
  const breakPage=()=>{
    if(cursor>12){for(let col=1;col<=8;col++){const cell=sheet.getCell(cursor-1,col);cell.style={...cell.style,border:{...cell.border,bottom:{style:"medium"}}};}sheet.getRow(cursor-1).addPageBreak();pages++;used=0;}
  };
  for(const line of data.lines) {
    if(icsCost(line.unitCost,line.quantity)!==line.totalCost)throw new Error("ICS total does not reconcile.");
    const texts=[wrapIcsText(line.unit,columnWidth(2,2)),wrapIcsText(line.description,columnWidth(5,6)),wrapIcsText(line.itemNumber,columnWidth(7,7)),wrapIcsText(line.usefulLife,columnWidth(8,8))];
    const count=Math.max(...texts.map(lines=>Math.ceil(lines.length/maxLinesPerBlock)));
    for(let part=0;part<count;part++) {
      const chunks=texts.map(lines=>lines.slice(part*maxLinesPerBlock,(part+1)*maxLinesPerBlock));
      const height=Math.max(rowHeight(12)+rowHeight(13)+rowHeight(14),Math.max(...chunks.map(chunk=>chunk.length))*lineHeight+10);
      if(used+height>pageHeight)breakPage();
      const start=cursor,end=cursor+(cursor===12?2:0);
      for(let row=start;row<=end;row++){
        sheet.getRow(row).height=end===start?height:row===start?height-rowHeight(13)-rowHeight(14):rowHeight(row===start+1?13:14);
        for(let col=1;col<=8;col++){
          cellStyle(sheet,row,col,12);
          const cell=sheet.getCell(row,col);cell.style={...cell.style,border:{left:cell.border.left,right:cell.border.right,...(used===0&&row===start?{top:{style:"medium" as const}}:{})},alignment:{horizontal:"center",vertical:"middle",wrapText:true}};
        }
      }
      for(const [first,last] of [[1,1],[2,2],[3,3],[4,4],[5,6],[7,7],[8,8]])if(start!==end||first!==last)sheet.mergeCells(start,first!,end,last!);
      const values=[part===0?line.quantity:null,chunks[0]!.join(""),part===0?Number(line.unitCost):null,part===0?Number(line.totalCost):null,chunks[1]!.join(""),null,chunks[2]!.join(""),chunks[3]!.join("")];
      values.forEach((value,index)=>{if(index!==5)sheet.getCell(start,index+1).value=value;});
      for(const col of [3,4])sheet.getCell(start,col).numFmt="#,##0.00";
      cursor=end+1;used+=height;
    }
  }
  const footerHeights=Array.from({length:8},(_,i)=>rowHeight(44+i));
  for(const [col,name,office] of [[1,data.details.fromName,data.details.fromOffice],[6,data.details.toName,data.details.toOffice]] as const){
    footerHeights[1]=Math.max(footerHeights[1]!,wrapIcsText(name,columnWidth(col,col===1?5:8)).length*14+4-rowHeight(46));
    footerHeights[4]=Math.max(footerHeights[4]!,wrapIcsText(office,columnWidth(col,col===1?5:8)).length*14+4);
  }
  const signatureHeight=footerHeights.reduce((a,b)=>a+b,0);
  const sourceBodyHeight=Array.from({length:32},(_,i)=>rowHeight(12+i)).reduce((a,b)=>a+b,0);
  if(pages===1&&used<sourceBodyHeight&&sourceBodyHeight+signatureHeight<=pageHeight){
    while(used<sourceBodyHeight-0.01){
      const height=Math.min(rowHeight(Math.min(cursor,43)),sourceBodyHeight-used);
      sheet.getRow(cursor).height=height;
      for(let col=1;col<=8;col++)cellStyle(sheet,cursor,col,Math.min(cursor,43));
      sheet.mergeCells(cursor,5,cursor,6);used+=height;cursor++;
    }
  }
  if(used+signatureHeight>pageHeight)breakPage();
  const footer=cursor;
  for(let source=44;source<=51;source++){
    const row=footer+source-44;sheet.getRow(row).height=footerHeights[source-44]!;
    for(let col=1;col<=8;col++){cellStyle(sheet,row,col,source);sheet.getCell(row,col).value=sourceCells[`${String.fromCharCode(64+col)}${source}`]!.value;}
  }
  for(const range of template.merges.filter(range=>Math.min(...range.match(/\d+/g)!.map(Number))>=44))sheet.mergeCells(range.replace(/\d+/g,row=>String(footer+Number(row)-44)));
  for(let source=44;source<=51;source++)for(let col=1;col<=8;col++)restoreEdges(sheet,footer+source-44,col,source);
  for(const [col,name,office,date] of [[1,data.details.fromName,data.details.fromOffice,data.details.fromDate],[6,data.details.toName,data.details.toOffice,data.details.toDate]] as const){
    sheet.getCell(footer+1,col).value=name;sheet.getCell(footer+4,col).value=office;sheet.getCell(footer+6,col).value=date;
    for(const offset of [1,4,6])sheet.getCell(footer+offset,col).alignment={...sheet.getCell(footer+offset,col).alignment,wrapText:true};
  }
  sheet.pageSetup={paperSize:14 as ExcelJS.PaperSize,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:0,scale:100,margins:template.margins,printArea:`A1:H${footer+7}`,printTitlesRow:"1:11",horizontalCentered:false};
  sheet.headerFooter={oddFooter:"Page &P of &N"};
  return Buffer.from(await book.xlsx.writeBuffer());
}
