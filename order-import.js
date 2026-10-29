(function(root){
'use strict';
const MAX_ORDERS=1000;
const normalizedHeaders=['订单号','商品模板','省','市','区县','行政区划码','预计运输小时','计划发货时间','商品名称','规格名称','导入提示'];
const headerKey=s=>String(s??'').replace(/^\uFEFF/,'').replace(/[\s\u200b]/g,'').replace(/[／\\]/g,'/');
const aliases={'订单号':['订单号','订单编号','平台订单号'],'地区':['省/市/区','省市区','收货省市区','收货省/市/区','收件省市区','收货地区'],'省':['省','省份','收货省','收货省份'],'市':['市','城市','收货市','收货城市'],'区县':['区县','区','县','区/县','收货区县','收货区','收货县'],'商品模板':['商品模板'],'行政区划码':['行政区划码','地区编码'],'预计运输小时':['预计运输小时'],'计划发货时间':['计划发货时间','计划发货时间（北京时间）'],'发货时间':['发货时间'],'商品名称':['商品名称'],'规格名称':['规格名称'],'导入提示':['导入提示']};
function canonicalHeader(s){const k=headerKey(s);for(const [target,names] of Object.entries(aliases))if(names.includes(k))return target;return null}
function isOrderHeader(row){const h=row.map(canonicalHeader);return h.includes('订单号')&&(h.includes('地区')||h.includes('区县')||h.includes('行政区划码'))}
function splitArea(value){const raw=String(value??'').trim();if(!raw||/^[*＊\s]+$/.test(raw))return {error:'省/市/区为空或已脱敏，无法定位'};
  const parts=raw.replace(/[／\\>|｜]/g,'/').split(/\s*\/\s*|\s+/).filter(Boolean);
  if(parts.length===3)return {province:parts[0],city:parts[1],district:parts[2]};
  if(parts.length===2&&/^(北京|天津|上海|重庆)市?$/.test(parts[0]))return {province:parts[0],city:parts[0],district:parts[1]};
  return {error:'省/市/区格式无法拆分，请核对原始地区（示例：广东省/江门市/台山市）'};
}
function normalizeRows(input){
  const rows=input.map(row=>row.map(v=>String(v??''))).filter(row=>row.some(v=>v.trim()));
  const headerIndex=rows.slice(0,30).findIndex(isOrderHeader);if(headerIndex<0)throw Error('未找到订单表头：支持拼多多“订单号 + 省/市/区”，或标准“订单号 + 区县/行政区划码”');
  const headers=rows[headerIndex].map(headerKey),mapped=headers.map(canonicalHeader),pdd=mapped.includes('地区');
  const meaningful=mapped.filter(Boolean);if(new Set(meaningful).size!==meaningful.length)throw Error('用于筛选的表头存在重复列，请保留一列');
  const body=rows.slice(headerIndex+1);if(!body.length)throw Error('表格只有表头，没有订单');if(body.length>MAX_ORDERS)throw Error(`单次最多 ${MAX_ORDERS} 单，请拆分导入`);
  const orders=body.map((values,i)=>{
    if(values.length>headers.length&&values.slice(headers.length).some(v=>v.trim()))throw Error(`第 ${headerIndex+i+2} 行列数超过表头，请检查逗号或引号`);
    const source={};mapped.forEach((h,j)=>{if(h)source[h]=String(values[j]??'').trim()});
    const order=Object.fromEntries(normalizedHeaders.map(h=>[h,source[h]||'']));
    // Combined PDD exports carry historic shipment times, not a new shipping plan.
    order['计划发货时间']=source['计划发货时间']||(!pdd?source['发货时间']:'')||'';
    if(pdd){const area=splitArea(source['地区']);if(area.error)order['导入提示']=[order['导入提示'],area.error].filter(Boolean).join('；');else{
      const names={'省':area.province,'市':area.city,'区县':area.district};for(const [key,value] of Object.entries(names)){if(order[key]&&order[key]!==value)order['导入提示']=[order['导入提示'],'分列地区与省/市/区不一致，请核验'].filter(Boolean).join('；');else order[key]=value}
    }}
    if(/^[0-9.]+e[+-]?\d+$/i.test(order['订单号']))order['导入提示']=[order['导入提示'],'订单号为科学计数法，可能已损失精度，请使用原始文本订单号'].filter(Boolean).join('；');
    return order;
  });
  return {orders,format:pdd?'拼多多省市区格式':'标准订单格式',headerIndex,ignoredPrivateColumns:true};
}
function csvForOrders(orders,core){return core.asCSV([normalizedHeaders,...orders.map(o=>normalizedHeaders.map(h=>o[h]||''))])}
function readWorkbook(buffer,xlsx){
  const wb=xlsx.read(buffer,{type:'array',cellDates:false,cellFormula:false,cellHTML:false,bookVBA:false,sheetRows:1035});
  const sheets=wb.SheetNames.map(name=>{
    const ws=wb.Sheets[name];const rows=xlsx.utils.sheet_to_json(ws,{header:1,raw:false,defval:'',blankrows:true});
    const fullRef=ws['!fullref']||ws['!ref'];const overflow=fullRef&&xlsx.utils.decode_range(fullRef).e.r>=1035;
    const headerIndex=rows.slice(0,30).findIndex(isOrderHeader);
    if(headerIndex>=0){const orderCol=rows[headerIndex].findIndex(h=>canonicalHeader(h)==='订单号');let noteCol=rows[headerIndex].findIndex(h=>canonicalHeader(h)==='导入提示');const range=xlsx.utils.decode_range(ws['!ref']||'A1');for(let i=headerIndex+1;i<rows.length;i++){const cell=ws[xlsx.utils.encode_cell({r:range.s.r+i,c:range.s.c+orderCol})];if(cell?.t==='n'&&(!Number.isSafeInteger(cell.v)||Math.abs(cell.v)>999999999999999)){if(noteCol<0){noteCol=rows[headerIndex].length;rows[headerIndex][noteCol]='导入提示'}while(rows[i].length<=noteCol)rows[i].push('');rows[i][noteCol]='订单号在 Excel 中是超长数值，可能已损失精度，请使用原始文本订单号'}}}
    return {name,rows,overflow,recognized:headerIndex>=0};
  });
  return {sheets};
}
const api={MAX_ORDERS,normalizedHeaders,canonicalHeader,isOrderHeader,splitArea,normalizeRows,csvForOrders,readWorkbook};root.OrderImport=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
