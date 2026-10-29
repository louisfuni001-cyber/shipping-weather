(function(root){
'use strict';
function parseDelimited(text){
  text=String(text).replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/)[0],sep=first.includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=ch;continue}
    if(ch==='"'&&cell===''){quoted=true;continue}
    if(ch===sep){row.push(cell);cell='';closed=false;continue}
    if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell='';closed=false;continue}
    if(closed&&!/\s/.test(ch))throw Error('CSV 引号后存在多余字符');if(!closed)cell+=ch;
  }if(quoted)throw Error('CSV 存在未闭合的双引号');row.push(cell);if(row.some(c=>c.trim()))rows.push(row);return rows;
}
function asCSV(rows){return '\ufeff'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^[\s]*[=+@]/.test(s)||/^[\s]*-\D/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n')}
function validRule(r){if(!r||!r.name?.trim())return '请填写模板名称';for(const k of ['min','max','maxHours','buffer'])if(r[k]===''||r[k]==null||!Number.isFinite(Number(r[k])))return '请填写所有数值阈值';if(Number(r.min)<-60||Number(r.max)>60||Number(r.min)>Number(r.max))return '温度范围须在 −60 至 60°C 内，最低值不高于最高值';if(Number(r.maxHours)<1||Number(r.maxHours)>168)return '最长运输时长须为 1–168 小时';if(Number(r.buffer)<0||Number(r.buffer)>72)return '延误缓冲须为 0–72 小时';return ''}
function inspectWindow(forecast,ship,end){
  if(!forecast?.hourly?.time?.length)return {missing:true};
  const h=forecast.hourly,times=h.time.map(t=>Date.parse(t+'+08:00'));
  const from=Math.floor(ship/3600000)*3600000,to=Math.ceil(end/3600000)*3600000;
  if(times[0]>from||times[times.length-1]+3600000<to)return {missing:true};
  const vals=[];for(let i=0;i<times.length;i++)if(times[i]>=from&&times[i]<to){if(typeof h.temperature_2m[i]!=='number')return {missing:true};vals.push(h.temperature_2m[i])}
  if(!vals.length||vals.length!==(to-from)/3600000)return {missing:true};
  const rain=forecast.daily?.rain_sum,showers=forecast.daily?.showers_sum;let heavy=false,rainUnknown=!forecast.daily?.time?.length;
  forecast.daily?.time.forEach((date,i)=>{const midnight=Date.parse(date+'T00:00:00+08:00');if(midnight<end&&midnight+86400000>ship){if(typeof rain?.[i]!=='number'||typeof showers?.[i]!=='number')rainUnknown=true;else if(rain[i]+showers[i]>=50)heavy=true}});
  return {missing:false,min:Math.min(...vals),max:Math.max(...vals),heavy,rainUnknown};
}
function evaluateRule({rule,hours,estimated,ship,destWeather,originWeather,knownEvent=false,now=Date.now()}){
  const fail=[],unknown=[],info=['按室外预报评估，不代表包装内水温；中转天气、承运能力和实时灾害仍需核验'];
  const invalid=validRule(rule);if(invalid)return {status:'待核验',reasons:[invalid],info};
  hours=Number(hours);if(!Number.isFinite(hours)||hours<=0||hours>240)return {status:'待核验',reasons:['运输时长缺失或超出 0–240 小时范围'],info};
  if(!Number.isFinite(ship)||ship<now-3600000)return {status:'待核验',reasons:['发货时间无效或已过去，请更新后重算'],info};
  const total=hours+Number(rule.buffer),end=ship+total*3600000;
  if(total>Number(rule.maxHours))fail.push(`运输 ${hours}h + 缓冲 ${rule.buffer}h = ${total}h，超过上限 ${rule.maxHours}h`);
  if(estimated)unknown.push('运输时长来自距离估算，请核验实际线路时效');
  const destination=inspectWindow(destWeather,ship,end),origin=inspectWindow(originWeather,ship,ship+3600000);
  for(const [label,w] of [['目的地运输及缓冲时窗',destination],['发货地发出时段',origin]]){
    if(w.missing){unknown.push(label+'天气缺失或超出 7 日预报范围');continue}
    if(w.min<Number(rule.min))fail.push(`${label}最低 ${w.min.toFixed(1)}°C，低于下限 ${rule.min}°C`);
    if(w.max>Number(rule.max))fail.push(`${label}最高 ${w.max.toFixed(1)}°C，高于上限 ${rule.max}°C`);
    if(rule.excludeRain&&w.heavy)fail.push(label+'存在采样日降雨 ≥50mm 的模型风险');
    if(rule.excludeRain&&w.rainUnknown)unknown.push(label+'降雨数据缺失');
  }
  if(knownEvent)fail.push('相关日期存在人工录入的灾害 / 停运记录');
  if(rule.strictUnknown)unknown.push('实时灾害预警及活体收寄能力尚未核验');
  return {status:fail.length?'建议暂缓':unknown.length?'待核验':'满足已设规则',reasons:[...fail,...unknown],info,destination,origin,total,end};
}
const api={parseDelimited,asCSV,validRule,inspectWindow,evaluateRule};root.MerchantCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
