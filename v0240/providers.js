const TZ='Asia/Taipei';
const number=value=>value===null||value===undefined||String(value).trim()===''?NaN:Number(String(value).replaceAll(',',''));
const valid=value=>Number.isFinite(value)&&value>0;
const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const twDate=t=>dateFormat.format(t);
const twTime=t=>timeFormat.format(t);
const usDateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const isUS=m=>m?.exchange==='us';
const marketDate=(m,t)=>isUS(m)?usDateFormat.format(t):twDate(t);
function usTicker(value){
 const ticker=value.trim().toUpperCase().replace(/^US[:：]\s*/,'').replace('.','-');
 return /^[A-Z][A-Z0-9]{0,5}(?:-[A-Z])?$/.test(ticker)?ticker:null;
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;
const encodeQuery=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const kv=obj=>Object.entries(obj).map(([k,v])=>encodeQuery(k)+'='+encodeQuery(v)).join('&');
const cache=new Map();
function memo(key,ttl,fn){
 const old=cache.get(key);
 if(old&&Date.now()-old.at<ttl)return old.promise;
 const entry={at:Date.now(),promise:Promise.resolve().then(fn)};
 cache.set(key,entry);
 entry.promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key)});
 return entry.promise;
}
const sessionKey='market-watch-local-session';
const localMode=location.protocol==='http:'&&location.hostname==='localhost'&&Number(location.port)>=18888&&Number(location.port)<=18907;
const launch=location.hash.match(/^#([0-9a-f]{32})(\/settings)?$/);
const launchSession=launch?.[1]||'';
const launchSettings=Boolean(launch?.[2]);
let bridgeSession='';
try{
 if(/^[0-9a-f]{32}$/.test(launchSession)){
  bridgeSession=launchSession;
  sessionStorage.setItem(sessionKey,bridgeSession);
  history.replaceState(null,'',location.pathname);
 }else bridgeSession=sessionStorage.getItem(sessionKey)||'';
}catch{if(bridgeSession)history.replaceState(null,'',location.pathname)}
async function bridge(path,options={},encoding){
 if(!localMode||!/^[0-9a-f]{32}$/.test(bridgeSession))throw new Error('請從 Start-Market-Watch.cmd 啟動');
 const headers=new Headers(options.headers||{});
 headers.set('X-CAS-Session',bridgeSession);
 const response=await fetch('./'+path,{...options,headers,cache:'no-store',credentials:'omit',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(encoding==='binary'?40000:22000)});
 if(!response.ok)throw Object.assign(new Error('HTTP '+response.status),{status:response.status});
 return encoding==='binary'?response.arrayBuffer():encoding?new TextDecoder(encoding).decode(await response.arrayBuffer()):response.text();
}
const yahooRetryAt=new Map();
async function yahooBridge(path){
 const host=path.startsWith('chart2/')?'finance':'taiwan';
 if(Date.now()<(yahooRetryAt.get(host)||0))throw new Error('Yahoo 限流，稍後重試');
 try{return await bridge(path);}
 catch(e){
  if(e.status===429||e.status===503)yahooRetryAt.set(host,Date.now()+60000);
  throw e;
 }
}
const json=async path=>JSON.parse(await bridge(path));
function objectAt(text,start){
 let depth=0,quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(escaped)escaped=false;
   else if(c==='\\')escaped=true;
   else if(c==='"')quoted=false;
  }else if(c==='"')quoted=true;
  else if(c==='{')depth++;
  else if(c==='}'&&--depth===0)return JSON.parse(text.slice(start,i+1));
 }
 throw new Error('找不到完整行情資料');
}
function quoteFromYahoo(html,symbol){
 const tag=JSON.stringify(symbol)+':{"meta":';
 const at=html.indexOf(tag);
 if(at<0)throw new Error('Yahoo 頁面未提供分時資料');
 return objectAt(html,at+tag.indexOf('{'));
}
function chartBars(raw){
 const q=raw?.indicators?.quote?.[0];
 if(!q||!raw.timestamp)return [];
 return raw.timestamp.flatMap((t,i)=>{
  const c=number(q.close?.[i]),o=number(q.open?.[i]),h=number(q.high?.[i]),l=number(q.low?.[i]);
  if(!valid(c)||!valid(t))return [];
  return [{t:t*1000,c,o:valid(o)?o:c,h:valid(h)?h:c,l:valid(l)?l:c,v:number(q.volume?.[i]),complete:[o,h,l].every(valid)&&h>=Math.max(o,c)&&l<=Math.min(o,c)}];
 });
}
function normYahoo(r,source){
 const m=r?.meta||{}, price=number(m.regularMarketPrice),prev=number(m.chartPreviousClose??m.previousClose);
 const bars=chartBars(r);
 if(!valid(price)||!valid(m.regularMarketTime))throw new Error('無有效報價');
 return {price,prev,ts:m.regularMarketTime*1000,bars,source,delayed:number(m.exchangeDataDelayedBy)>0,barMinutes:Number(/^(\d+)m$/.exec(m.dataGranularity||'')?.[1])||null,volume:number(r.quote?.volume?.raw??r.quote?.volume??m.regularMarketVolume),
  activityVolume:number(m.regularMarketVolume??r.quote?.volume?.raw??r.quote?.volume),
  open:number(r.quote?.openPrice?.raw??bars[0]?.o), high:number(m.regularMarketDayHigh),low:number(m.regularMarketDayLow)};
}
function yahooVisibleQuote(html){
 const text=html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ');
 const area=text.slice(Math.max(0,text.indexOf('即時行情')));
 const stamp=/資料時間\s*[:：]?\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(area);
 if(!stamp)return null;
 const [,year,month,day,hour,minute,second='00']=stamp;
 const pad=x=>x.padStart(2,'0');
 const date=year+'-'+pad(month)+'-'+pad(day);
 const ts=Date.parse(date+'T'+pad(hour)+':'+minute+':'+second+'+08:00');
 if(!Number.isFinite(ts)||twDate(ts)!==date)return null;
 const summary=area.slice(stamp.index,stamp.index+3800);
 const amount=label=>number(new RegExp(label+'\\s*([\\d,]+(?:\\.\\d+)?)').exec(summary)?.[1]);
 const inner=/內盤\s*([\d,]+(?:\.\d+)?)\s*[(（]\s*([\d.]+)\s*[%％]\s*[)）]/.exec(summary);
 const next=inner?summary.slice(inner.index+inner[0].length):'';
 const outer=/外盤\s*([\d,]+(?:\.\d+)?)\s*[(（]\s*([\d.]+)\s*[%％]\s*[)）]/.exec(next)||
  /([\d,]+(?:\.\d+)?)\s*[(（]\s*([\d.]+)\s*[%％]\s*[)）]\s*外盤/.exec(next);
 const inside=number(inner?.[1]),outside=number(outer?.[1]),insidePct=number(inner?.[2]),outsidePct=number(outer?.[2]);
 const sides=[inside,outside,insidePct,outsidePct].every(n=>Number.isFinite(n)&&n>=0)&&
  inside+outside>0&&insidePct<=100&&outsidePct<=100&&Math.abs(insidePct+outsidePct-100)<.25?
  {inside,outside,insidePct,outsidePct,ts,source:'Yahoo 股市'}:null;
 const bid=amount('(?:報買價|買進|買價)'),ask=amount('(?:報賣價|賣出|賣價)');
 const dealerQuote=valid(bid)&&valid(ask)&&ask>=bid?{bid,ask,ts}:null;
 const total=/總量\s*(?:[(（]\s*([股張])\s*[)）]\s*)?([\d,]+(?:\.\d+)?)\s*([股張])?/.exec(summary);
 return {ts,dealerQuote,price:amount('成交'),prev:amount('(?:昨收|昨均價|昨日均價|前一日參考價|前一日均價|前日均價)'),open:amount('開盤'),high:amount('最高'),low:amount('最低'),volume:number(total?.[2]),volumeUnit:total?.[1]||total?.[3]||'張',sides};
}
function misQuote(rows,m){
 const id=m.id==='TAIEX'?'t00':m.id;
 const last=x=>valid(number(x.z))?number(x.z):number(x.trade?.z);
 const q=rows?.msgArray?.find(x=>x.c===id&&valid(last(x)));
 if(!q)return null;
 const t=q.trade?.t||q.t, d=q.d||q['^'];
 let ts=number(q.tlong);
 if(/^\d{8}$/.test(d||'')&&/^\d\d:\d\d:\d\d$/.test(t||''))ts=Date.parse(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)+'T'+t+'+08:00');
 const levels=(prices,sizes)=>{
  const p=String(prices??'').split('_'), v=String(sizes??'').split('_');
  return Array.from({length:5},(_,i)=>({price:number(p[i]),size:number(v[i])}));
 };
 return {price:last(q),prev:number(q.y),ts,open:number(q.o),high:number(q.h),low:number(q.l),
  volume:number(q.v),activityVolume:number(q.v),source:'證交所 MIS',name:q.n,bids:levels(q.b,q.g),asks:levels(q.a,q.f)};
}
const futuresProducts={
 TX:{name:'台指期',symbol:'WTX',digits:0,aliases:'大台 大台指 臺股期貨 台股期貨'},
 MTX:{name:'小型台指期',symbol:'WMT',digits:0,aliases:'小台 小台指 小型臺指期貨'},
 TMF:{name:'微型台指期',symbol:'WTM',digits:0,aliases:'微台 微台指 微型臺指期貨'},
 TE:{name:'電子期貨',symbol:'WTE',digits:2,aliases:'電子期 電子指數期貨'},
 TF:{name:'金融期貨',symbol:'WTF',digits:2,aliases:'金融期 金融指數期貨'},
 XIF:{name:'非金電期貨',symbol:'WXI',digits:0,aliases:'非金電 非金融電子期貨'}
};
const isFuture=m=>Object.hasOwn(futuresProducts,m.id);
const hasTaiexBasis=m=>['TX','MTX','TMF'].includes(m.id);
function symbolFor(m){
 if(m.id==='TAIEX')return '^TWII';
 if(isFuture(m))return futuresProducts[m.id].symbol+(m.contract==='次月'?'@':'&');
 if(isUS(m))return m.id.slice(3);
 return m.id+(['otc','esb'].includes(m.exchange)?'.TWO':'.TW');
}
function yahooPage(m){
 const symbol=symbolFor(m);
 return memo('yahoo-page:'+symbol,59000,()=>yahooBridge('yquote/'+encodeURIComponent(symbol)));
}
const hasTradeSides=m=>!isUS(m)&&m.id!=='TAIEX'&&!isFuture(m);
async function tradeSidesFor(m){
 return yahooVisibleQuote(await yahooPage(m))?.sides||null;
}
async function yahooChart(m,range,interval){
 const symbol=m.profileSymbol||symbolFor(m);
 const start=new Date();start.setUTCFullYear(start.getUTCFullYear()-30);
 const query=range==='outlook'?{period1:Math.max(0,Math.floor(start.getTime()/1000)),period2:Math.floor(Date.now()/1000),interval:'1d'}:{range,interval};
 const r=JSON.parse(await yahooBridge('chart2/'+encodeURIComponent(symbol)+'?'+kv(query))).chart?.result?.[0];
 const meta=r?.meta;
 if(!meta||String(meta.symbol||'').toUpperCase()!==symbol)throw new Error('找不到此代號的行情');
 if(isUS(m)&&(meta.currency!=='USD'||!['EQUITY','ETF'].includes(meta.instrumentType)||meta.exchangeTimezoneName!=='America/New_York'))
  throw new Error('此代號沒有可用的美國股票或 ETF 行情');
 return r;
}
let misRetryAt=0;
function batchMIS(markets){
 if(Date.now()<misRetryAt)return Promise.resolve(null);
 const channels=markets.filter(m=>!isFuture(m)&&!isUS(m)&&m.exchange!=='esb').map(m=>(m.exchange==='otc'?'otc':'tse')+'_'+(m.id==='TAIEX'?'t00':m.id)+'.tw');
 return channels.length?json('mis/'+kv({ex_ch:channels.join('|'),json:1,delay:0,_:Date.now()})).catch(e=>{
  if(/HTTP (429|503)$/.test(e.message))misRetryAt=Date.now()+60000;
  return null;
 }):Promise.resolve(null);
}
const chartState=new Map();
function intradayHistory(m){
 const symbol=symbolFor(m);
 return memo('intraday-history:'+symbol,5*60000,async()=>{
  const r=await yahooChart(m,'1mo','15m');
  if(r?.meta?.dataGranularity!=='15m')throw new Error('來源未提供 15 分鐘資料');
  const bars=[...new Map(chartBars(r).filter(b=>b.complete).map(b=>[b.t,b])).values()].sort((a,b)=>a.t-b.t);
  if(!bars.length)throw new Error('來源沒有可用的歷史分 K');
  return {bars,barMinutes:15,source:'Yahoo Finance 歷史分 K'};
 });
}
function backgroundChart(m){
 const symbol=symbolFor(m), old=chartState.get(symbol);
 if(old&&(old.busy||Date.now()-old.at<60000))return old;
 const entry={at:Date.now(),value:old?.value,busy:true};
 chartState.set(symbol,entry);
 entry.promise=yahooPage(m).then(v=>normYahoo(quoteFromYahoo(v,symbol),'Yahoo 股市'))
  .catch(async()=>({...normYahoo(await yahooChart(m,'1d','5m'),'Yahoo Finance'),delayed:true,sessionLabel:'國際版 Yahoo 台股 · 延遲來源'}))
  .then(q=>{entry.value=q;return q}).catch(()=>null).finally(()=>{entry.busy=false});
 return entry;
}
function attachChart(official,chart){
 const recent=chart&&twDate(chart.ts)===twDate(official.ts);
 return {...official,bars:recent?chart.bars:[],chartSource:recent?chart.source:null,barMinutes:recent?chart.barMinutes:null};
}
function futureSessionKey(ts){
 if(!Number.isFinite(ts))return '';
 const clock=twTime(ts);
 if(clock>='15:00:00'||clock<='05:00:00')return 'night:'+twDate(clock<='05:00:00'?ts-86400000:ts);
 if(clock>='08:45:00'&&clock<='13:45:00')return 'day:'+twDate(ts);
 return '';
}
function futuresSession(quote){
 if(quote.closing)return '日盤收盤資料';
 const key=futureSessionKey(quote.ts);
 return key.startsWith('night:')?'夜盤時段報價':key?'日盤時段報價':'交易時段未確認';
}
function futureQuote(m){
 const symbol=symbolFor(m),source='Yahoo 股市 · '+futuresProducts[m.id].name;
 return memo('future-quote:'+symbol,14000,async()=>{
  let quote;
  try{quote=normYahoo(quoteFromYahoo(await memo('future-page',14000,()=>yahooBridge('future')),symbol),source);}
  catch{
   const path=encodeURIComponent(symbol);
   try{quote=normYahoo(quoteFromYahoo(await yahooBridge('future-quote/'+path),symbol),source);}
   catch{quote=normYahoo(quoteFromYahoo(await yahooBridge('yquote/'+path),symbol),source);}
  }
  return {...quote,sessionLabel:futuresSession(quote)};
 });
}
const mainIndex={id:'TAIEX',name:'加權指數',exchange:'tse'};
async function liveQuote(m,misBatch,fastCash=false,chartWanted=true){
 if(isUS(m)){
  const r=await memo('us-quote:'+m.id,29000,()=>yahooChart(m,'1d','5m'));
  const delay=number(r.meta.exchangeDataDelayedBy),hours=r.meta.currentTradingPeriod?.regular;
  return {...normYahoo(r,'Yahoo Finance'),currency:'USD',instrumentType:r.meta.instrumentType,
   regularStart:number(hours?.start)*1000,regularEnd:number(hours?.end)*1000,
   sessionLabel:Number.isFinite(delay)?delay>0?'美股 · 延遲 '+delay+' 分':'美股 · 來源標示即時':'美股 · 延遲未標示'};
 }
 if(m.exchange==='esb'){
  const html=await yahooPage(m).catch(()=>null);
  const visible=html&&yahooVisibleQuote(html);
  let chart;
  try{if(html)chart=normYahoo(quoteFromYahoo(html,symbolFor(m)),'Yahoo 股市 · 興櫃');}catch{}
  if(visible&&valid(visible.price)&&(!chart||visible.ts>=chart.ts-59000)){
   const sameDay=chart&&twDate(chart.ts)===twDate(visible.ts);
   return {...visible,activityVolume:visible.volume,bars:sameDay?chart.bars:[],barMinutes:sameDay?chart.barMinutes:null,source:'Yahoo 股市 · 興櫃'};
  }
  if(chart)return chart;
  try{return normYahoo(await memo('esb-quote:'+m.id,29000,()=>yahooChart(m,'1d','5m')),'Yahoo Finance · 興櫃');}catch{}
  const {bars,source}=await dailySeries(m),last=bars.at(-1),prev=bars.at(-2)?.c;
  return {price:last.c,prev,ts:last.t,open:last.o,high:last.h,low:last.l,volume:last.v,bars:[],source,closing:true};
 }
 if(isFuture(m)){
  try{return await futureQuote(m);}
  catch{
   const {bars,source}=await dailySeries(m);
   const last=bars.at(-1),prev=bars.at(-2)?.c;
   return {price:last.c,prev,ts:last.t,open:last.o,high:last.h,low:last.l,volume:last.v,bars:[],source,closing:true,sessionLabel:'日盤收盤資料'};
  }
 }
 const official=misQuote(await (misBatch||batchMIS([m])),m);
 if(official){
  const chart=chartWanted?backgroundChart(m):chartState.get(symbolFor(m));
  return attachChart(official,chart?.value);
 }
 if(fastCash){
  const busyCharts=[...chartState.values()].filter(entry=>entry.busy).length;
  const chart=busyCharts<4?backgroundChart(m):chartState.get(symbolFor(m));
  if(chart?.value)return chart.value;
  throw new Error('MIS 暫無報價，正在等待備援資料');
 }
 const chart=backgroundChart(m);
 const y=await chart.promise||chart.value;
 if(!y){
  const {bars,source}=await dailySeries(m);
  const last=bars.at(-1),prev=bars.at(-2)?.c;
  return {price:last.c,prev,ts:last.t,open:last.o,high:last.h,low:last.l,volume:last.v,bars:[],source,closing:true};
 }
 return y;
}
function calendarMonths(count){
 const [year,month]=twDate(Date.now()).split('-').map(Number);
 return Array.from({length:count},(_,i)=>{
  const d=new Date(Date.UTC(year,month-i-1,1));
  return [d.getUTCFullYear(),String(d.getUTCMonth()+1).padStart(2,'0')];
 });
}
function rocDate(s){
 const parts=String(s).trim().split('/').map(Number);
 if(parts.length!==3||parts.some(x=>!x))return NaN;
 return Date.UTC(parts[0]<1900?parts[0]+1911:parts[0],parts[1]-1,parts[2],5,30);
}
function officialBars(data,index,otc){
 return (Array.isArray(data)?data:[]).flatMap(row=>{
  const t=rocDate(row[0]),o=number(row[index?1:3]),h=number(row[index?2:4]),l=number(row[index?3:5]),c=number(row[index?4:6]);
  if(!valid(t)||![o,h,l,c].every(valid))return [];
  return [{t,o,h,l,c,v:index?NaN:number(row[1])*(otc?1000:1)}];
 });
}
function futureReportRows(doc,product){
 return [...doc.querySelectorAll('tr')].map(r=>[...r.cells].map(c=>c.textContent.trim()))
  .filter(row=>row[0]===product&&/^\d{6}$/.test(row[1])).sort((a,b)=>a[1].localeCompare(b[1]));
}
function parseFutureReport(doc,wanted,product='TX',night=false){
 const d=doc.querySelector('input[name=queryDate]')?.value;
 if(!d)return null;
 const rows=futureReportRows(doc,product);
 const row=wanted?rows.find(r=>r[1]===wanted):rows[0];
 if(!row)return null;
 const [,contract,op,hi,lo,cl, ,change]=row,[o,h,l,c]=[op,hi,lo,cl].map(number);
 if(![o,h,l,c].every(valid))return null;
 const date=twDate(rocDate(d)),dayTime=Date.parse(date+'T13:45:00+08:00');
 const reportedNight=night&&/(\d{4}\/\d{1,2}\/\d{1,2})\s*15:00\s*[~～]/.exec(doc.body?.textContent||'');
 if(night&&!reportedNight)return null;
 const nightDate=night&&twDate(rocDate(reportedNight[1]));
 const delta=number(change.replace(/[▲△]/g,'').replace(/[▼▽−]/g,'-').replace('%',''));
 return {t:night?Date.parse(nightDate+'T15:00:00+08:00')+14*3600000:dayTime,o,h,l,c,
  v:number(row[night?8:10]),contract,settlement:night?NaN:number(row[11]),oi:night?NaN:number(row[12]),delta,
  sessionKey:(night?'night:'+nightDate:'day:'+date)};
}
function futureReport(m,date,night=false){
 const day=date.replaceAll('-','/');
 return memo('future-report:'+m.id+':'+day+':'+night,10*60000,async()=>{
  const doc=new DOMParser().parseFromString(await bridge('tf-report/'+kv({queryType:2,marketCode:night?1:0,commodity_id:m.id,queryDate:day})),'text/html');
  if(doc.querySelector('input[name=queryDate]')?.value!==day||!futureReportRows(doc,m.id).length)
   throw new Error('該日尚無期貨報表');
  return doc;
 });
}
async function recentFutureNight(m,contract,day){
 const dates=[twDate(Date.now()),twDate(Date.now()-86400000),day].filter(Boolean);
 for(const date of new Set(dates)){
  try{
   const result=parseFutureReport(await futureReport(m,date,true),contract,m.id,true);
   if(result&&result.t<=Date.now())return result;
  }catch{}
 }
 return null;
}
async function futureHistory(m){
 const dates=[];
 const today=twDate(Date.now());
 for(let i=0;i<14&&dates.length<8;i++){
  const date=new Date(Date.parse(today+'T12:00:00Z')-i*86400000);
  if(date.getUTCDay()!==0&&date.getUTCDay()!==6)dates.push(date.toISOString().slice(0,10).replaceAll('-','/'));
 }
 let wanted=null,bars=[];
 for(let i=0;i<dates.length;i+=3){
  const block=await Promise.allSettled(dates.slice(i,i+3).map(date=>futureReport(m,date)));
  for(const result of block){
   if(result.status!=='fulfilled'||!result.value)continue;
   if(!wanted){
    if(m.contract==='次月'){
     const contracts=futureReportRows(result.value,m.id);
     wanted=[...new Set(contracts.map(r=>r[1]))].sort()[1];
     if(!wanted)continue;
    }else wanted=parseFutureReport(result.value,null,m.id)?.contract;
   }
   const bar=wanted?parseFutureReport(result.value,wanted,m.id):null;
   if(bar)bars.push(bar);
  }
 }
 if(!bars.length)throw new Error('期交所日行情暫無資料');
 return {bars:bars.sort((a,b)=>a.t-b.t),months:0,source:'期交所日行情 · '+wanted};
}
const dailyCloseTime='13:30:00';
const dailyRefreshTime='13:35:00';
function dailyDataSession(now=Date.now()){
 return twDate(now)+(twTime(now)>=dailyRefreshTime?'|after-close':'|before-close');
}
function dailySeries(m,months=5){
 const now=Date.now(),session=isFuture(m)?twDate(now)+(twTime(now)>='14:00:00'?'|after-close':'|before-close'):dailyDataSession(now);
 const currentMonth=twDate(now).slice(0,7).replace('-','');
 return memo('daily:'+m.id+':'+(m.contract||m.exchange||'')+':'+months+':'+session,30*60000,async()=>{
  if(isFuture(m))return futureHistory(m);
  if(isUS(m)||m.exchange==='esb'){
   const r=await memo('yahoo-daily:'+m.id,15*60000,()=>yahooChart(m,'2y','1d'));
   const today=marketDate(m,now),end=number(r.meta.currentTradingPeriod?.regular?.end)*1000;
   const closed=isUS(m)?Number.isFinite(end)&&marketDate(m,end)===today&&now>=end:twTime(now)>='15:00:00';
   const bars=chartBars(r).filter(b=>b.complete&&b.t<=now&&(marketDate(m,b.t)<today||closed));
   if(!bars.length)throw new Error('Yahoo Finance 無可用的日 K');
   return {bars,months:24,source:'Yahoo Finance 日行情'};
  }
  const index=m.id==='TAIEX',otc=m.exchange==='otc';
  const periods=calendarMonths(months), all=new Map();
  for(let i=0;i<periods.length;i+=5){
   const results=await Promise.allSettled(periods.slice(i,i+5).map(([year,month])=>memo('official-month:'+m.id+':'+m.exchange+':'+year+month+(year+month===currentMonth?':'+session:''),30*60000,async()=>{
    const path=index?'index/'+kv({date:year+month+'01',response:'json'}):otc?
     'otc-day/'+kv({code:m.id,date:year+'/'+month+'/01',response:'json'}):
     'daily/'+kv({stockNo:m.id,date:year+month+'01',response:'json'});
    const r=await json(path);
    const rows=officialBars(otc?r.tables?.[0]?.data:r.data,index,otc);
    if(!rows.length)throw new Error('此月份無可用資料');
    return rows;
   })));
   for(const result of results)if(result.status==='fulfilled')for(const bar of result.value)all.set(bar.t,bar);
  }
  const bars=[...all.values()].sort((a,b)=>a.t-b.t);
  if(!bars.length)throw new Error('交易所無可用日 K 資料');
  return {bars,months,source:otc?'櫃買中心日行情':'證交所日行情'};
 });
}
function periodText(value){
 const raw=String(value||'').trim();
 const m=/^(\d{3,4})(\d{2})(\d{2})?$/.exec(raw);
 if(!m)return raw;
 const y=Number(m[1]);return (y<1900?y+1911:y)+'-'+m[2]+(m[3]?'-'+m[3]:'');
}
function institutionalSupported(m){
 return ['tse','otc'].includes(m.exchange)&&/^\d{4,6}[A-Z]?$/.test(m.id);
}
function institutionalDates(bars,limit,now=Date.now()){
 const today=twDate(now),settled=twTime(now)>=dailyRefreshTime;
 return (bars||[]).map(b=>twDate(b.t)).filter(d=>d<today||d===today&&settled).slice(-limit);
}
function institutionalTable(payload,otc){
 const table=otc?payload?.tables?.find(t=>t.fields?.length===24&&Array.isArray(t.data)):payload;
 if(!Array.isArray(table?.fields)||!Array.isArray(table?.data))return new Map();
 const fields=table.fields.map(x=>String(x).replace(/\s+/g,'').replaceAll('（','(').replaceAll('）',')'));
 const indexes=otc?[0,2,3,4,11,12,13,20,21,22,23]:
  ['證券代號','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)','外陸資買賣超股數(不含外資自營商)',
   '投信買進股數','投信賣出股數','投信買賣超股數','自營商買賣超股數','三大法人買賣超股數',
   '自營商買進股數(自行買賣)','自營商買進股數(避險)','自營商賣出股數(自行買賣)','自營商賣出股數(避險)'].map(name=>fields.indexOf(name));
 if(indexes.includes(-1))return new Map();
 const out=new Map();
 for(const row of table.data){
  if(!Array.isArray(row)||row.length!==fields.length)continue;
  const code=String(row[indexes[0]]).trim();
  const [fb,fs,fn,tb,ts,tn,...rest]=indexes.slice(1).map(i=>number(row[i]));
  const [db,ds,dn,total]=otc?rest:[rest[2]+rest[3],rest[4]+rest[5],rest[0],rest[1]];
  if(!/^\d{4,6}[A-Z]?$/.test(code)||![fb,fs,fn,tb,ts,tn,db,ds,dn,total].every(Number.isSafeInteger))continue;
  if(fb-fs!==fn||tb-ts!==tn||db-ds!==dn||fn+tn+dn!==total)continue;
  out.set(code,{foreign:{buy:fb,sell:fs,net:fn},trust:{buy:tb,sell:ts,net:tn},dealer:{buy:db,sell:ds,net:dn},total});
 }
 return out;
}
async function institutionalFor(m,dates){
 const otc=m.exchange==='otc',source=otc?'櫃買中心':'臺灣證券交易所',rows=[];
 for(let i=dates.length;i>0;i-=3){
  const batch=dates.slice(Math.max(0,i-3),i);
  const results=await Promise.allSettled(batch.map(date=>memo('institutional:'+m.exchange+':'+date,date===twDate(Date.now())?15*60000:60*60000,async()=>{
   const args=otc?{type:'Daily',sect:'EW',date:date.replaceAll('-','/'),id:'',response:'json'}:
    {date:date.replaceAll('-',''),selectType:'ALL',response:'json'};
   const payload=await json((otc?'inst-otc/':'inst-tse/')+kv(args));
   const rawDate=String(payload?.date??'').trim();
   const reported=rawDate.includes('/')||rawDate.includes('-')?rocDate(rawDate.replaceAll('-','/')):
    /^\d{8}$/.test(rawDate)?rocDate(rawDate.slice(0,4)+'/'+rawDate.slice(4,6)+'/'+rawDate.slice(6)):NaN;
   if(Number.isFinite(reported)&&twDate(reported)!==date)throw new Error('法人報表日期不符');
   const table=institutionalTable(payload,otc);
   if(!table.size)throw new Error('未取得有效法人報表');
   return table;
  })));
  for(const [j,result] of results.entries()){
   const values=result.status==='fulfilled'?result.value.get(m.id):null;
   rows.push({date:batch[j],values:values||null});
  }
 }
 return {source,rows:rows.sort((a,b)=>a.date.localeCompare(b.date))};
}
async function fundamentalsFor(m){
 if(!/^\d{4}$/.test(m.id)||m.id.startsWith('00')||m.type==='ETF')return {unsupported:true};
 const otc=m.exchange==='otc';
 const revenueRoute=m.exchange==='esb'?'revenue-esb':otc?'revenue-otc':'revenue';
 const routes=revenueRoute==='revenue'?['valuation',revenueRoute]:[revenueRoute];
 const results=await Promise.allSettled(routes.map(route=>memo('fund:'+route,3600000,
  ()=>route==='revenue-esb'?bridge(route).then(csvRecords):json(route))));
 const row=(route,keys)=>{
  const data=results[routes.indexOf(route)]?.value;
  return Array.isArray(data)?data.find(x=>keys.some(k=>String(x[k]||'').trim()===m.id))||{}:{};
 };
 const value=row('valuation',['Code']);
 const rev=row(revenueRoute,['公司代號','SecuritiesCompanyCode','CompanyCode']);
 const dataset=m.exchange==='esb'?'公開資訊觀測站':otc?'櫃買中心':'證交所';
 return {source:dataset+'公開資料',valuationDate:periodText(value.Date),
  pe:number(value.PEratio),pb:number(value.PBratio),yield:number(value.DividendYield),
  month:periodText(rev['資料年月']),yoy:number(rev['營業收入-去年同月增減(%)']),
  mom:number(rev['營業收入-上月比較增減(%)']),revenue:number(rev['營業收入-當月營收'])};
}
function csvRecords(text){
 const rows=[],row=[];let value='',quoted=false;
 const data=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')+'\n';
 for(let i=0;i<data.length;i++){
  const ch=data[i];
  if(ch==='"'){
   if(quoted&&data[i+1]==='"'){value+='"';i++;}
   else quoted=!quoted;
  }else if(!quoted&&(ch===','||ch==='\n')){
   row.push(value.trim());value='';
   if(ch==='\n'&&row.length)rows.push(row.splice(0));
  }else value+=ch;
 }
 const columns=rows.shift()||[];
 return rows.filter(r=>r.length===columns.length).map(r=>Object.fromEntries(columns.map((name,i)=>[name,r[i]])));
}
function revenueRows(html){
 const template=document.createElement('template');
 template.innerHTML=html;
 const out=new Map();
 for(const row of template.content.querySelectorAll('tr')){
  const cells=[...row.cells];
  if(cells.length!==11||cells.some(c=>c.tagName!=='TD'))continue;
  const [id,,revenue,previous,lastYear,mom,yoy]=cells.map(c=>c.textContent.trim());
  const value=number(revenue);
  if(/^\d{4}$/.test(id)&&Number.isFinite(value)&&value>=0)
   out.set(id,{revenue:value,previous:number(previous),lastYear:number(lastYear),mom:number(mom),yoy:number(yoy)});
 }
 return out;
}
function revenueMonths(latest,now=Date.now()){
 const hasMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(latest||'');
 const [year,month]=(hasMonth?latest:twDate(now).slice(0,7)).split('-').map(Number);
 return Array.from({length:12},(_,i)=>new Date(Date.UTC(year,month-1-(hasMonth?0:1)-(11-i),1)).toISOString().slice(0,7));
}
async function revenueHistoryFor(m,months){
 const market=m.exchange==='esb'?'rotc':m.exchange==='otc'?'otc':'sii',out=[];
 const forStock=async month=>{
  for(const group of [0,1]){
   try{
    const [y,n]=month.split('-').map(Number);
    const path='revenue-history/'+market+'/t21sc03_'+(y-1911)+'_'+n+'_'+group+'.html';
    const table=await memo('revenue-file:'+path,6*3600000,async()=>revenueRows(await bridge(path,{},'big5')));
    const row=table.get(m.id);
    if(row)return {month,...row};
   }catch{}
  }
  return {month,revenue:NaN};
 };
 for(let i=months.length;i>0;i-=3)out.push(...await Promise.all(months.slice(Math.max(0,i-3),i).map(forStock)));
 return out.sort((a,b)=>a.month.localeCompare(b.month));
}
const catalogStorage='market-watch-catalog-v1';
const catalogMarkets=[
 {exchange:'tse',market:'證交所 · 上市',routes:['names','listed-names','listed-names-csv']},
 {exchange:'otc',market:'櫃買中心 · 上櫃',routes:['otc','otc-names','otc-names-csv']},
 {exchange:'esb',market:'櫃買中心 · 興櫃',routes:['esb-names','esb-names-csv','esb']}
];
const catalogState={rows:[],missing:[],fresh:{},at:0,pending:null};
function catalogRows(data,exchange){
 const info=catalogMarkets.find(m=>m.exchange===exchange);
 if(!info||!Array.isArray(data))return [];
 const pick=(row,keys)=>keys.map(key=>row[key]).find(value=>value!==undefined&&String(value).trim()!=='');
 return data.flatMap(row=>{
  if(!row||typeof row!=='object')return [];
  row=Object.fromEntries(Object.entries(row).map(([key,value])=>[key.trim(),value]));
  const id=String(pick(row,['公司代號','證券代號','代號','SecuritiesCompanyCode','Code'])??'').trim().toUpperCase();
  const name=String(pick(row,['公司簡稱','Name','SecuritiesCompanyName','CompanyName','公司名稱','名稱'])??'').trim();
  return /^\d{4,6}[A-Z]?$/.test(id)&&name&&name!==id?[{id,name,exchange,type:id.startsWith('00')?'ETF':'個股',market:info.market}]:[];
 });
}
function cachedCatalog(){
 try{
  const saved=JSON.parse(localStorage.getItem(catalogStorage)||'null');
  if(!saved||!Number.isFinite(saved.at)||Date.now()-saved.at>7*86400000||saved.at>Date.now())return [];
  return catalogMarkets.flatMap(m=>{
   const at=saved.fresh?.[m.exchange]||saved.at;
   if(!Number.isFinite(at)||Date.now()-at>7*86400000||at>Date.now())return [];
   catalogState.fresh[m.exchange]=at;
   return catalogRows(saved.rows?.filter(row=>row.exchange===m.exchange),m.exchange);
  });
 }catch{return [];}
}
function mergeCatalog(...groups){
 const map=new Map();
 for(const row of groups.flat())map.set(row.id,row);
 return [...map.values()];
}
function saveCatalog(rows){
 try{localStorage.setItem(catalogStorage,JSON.stringify({at:Date.now(),fresh:{...catalogState.fresh},rows:rows.map(row=>({...row,Code:row.id,Name:row.name}))}));}catch{}
}
async function fullCatalog(onUpdate){
 if(catalogState.pending)return catalogState.pending;
 const ttl=catalogState.missing.length?60000:6*3600000;
 if(catalogState.at&&Date.now()-catalogState.at<ttl)return catalogState.rows;
 const previous=catalogState.rows.length?catalogState.rows:cachedCatalog();
 catalogState.rows=previous;catalogState.missing=[];
 catalogState.pending=(async()=>{
  await Promise.allSettled(catalogMarkets.map(async market=>{
   for(const route of market.routes){
    try{
     const data=route.endsWith('-csv')?csvRecords(await bridge(route)):await json(route);
     const rows=catalogRows(data,market.exchange);
     if(!rows.length)continue;
     catalogState.rows=mergeCatalog(catalogState.rows.filter(r=>r.exchange!==market.exchange),rows);
     catalogState.fresh[market.exchange]=Date.now();
     try{onUpdate?.(catalogState.rows);}catch{}
     return;
    }catch{}
   }
   catalogState.missing.push(market.exchange);
  }));
  catalogState.at=Date.now();
  saveCatalog(catalogState.rows);
  return catalogState.rows;
 })().finally(()=>{catalogState.pending=null;});
 return catalogState.pending;
}
function resolveTaiwanCode(id){
 if(!/^\d{4,6}[A-Z]?$/.test(id))return Promise.resolve(null);
 return memo('resolve-code:'+id,60000,async()=>{
  const payload=await json('mis/'+kv({ex_ch:'tse_'+id+'.tw|otc_'+id+'.tw',json:1,delay:0,_:Date.now()}));
  const matches=(payload?.msgArray||[]).flatMap(row=>{
   if(row.c!==id||!['tse','otc'].includes(row.ex))return [];
   return catalogRows([{Code:id,Name:row.n}],row.ex);
  });
  return matches.length===1?matches[0]:null;
 }).then(row=>{
  if(!row)cache.delete('resolve-code:'+id);
  return row;
 });
}
function safeUrl(url){
 try{const u=new URL(url);return u.protocol==='https:'?u.href:null}catch{return null}
}
function parseNews(text,defaultSource){
 const doc=new DOMParser().parseFromString(text,'application/xml');
 return [...doc.querySelectorAll('item')].flatMap(e=>{
  const get=k=>e.querySelector(k)?.textContent.trim()||'';
  const title=get('title'),link=safeUrl(get('link'));
  const summary=get('description').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
  return title&&link?[{title,link,summary,source:get('source')||defaultSource,pub:Date.parse(get('pubDate'))}]:[];
 });
}
function newsFor(m){
 return memo('news:'+m.id,10*60000,async()=>{
  const term=m.id==='TAIEX'?'台股 加權指數':isFuture(m)?hasTaiexBasis(m)?'台指期 OR 台股期貨':m.name:isUS(m)?symbolFor(m)+' stock':m.name;
  const r=await Promise.allSettled([
   bridge('news/'+kv({q:term+' when:7d',hl:isUS(m)?'en-US':'zh-TW',gl:isUS(m)?'US':'TW',ceid:isUS(m)?'US:en':'TW:zh-Hant'})).then(t=>parseNews(t,'Google 新聞')),
   ...(isUS(m)?[]:[bridge('ynews/'+encodeURIComponent(m.id==='TAIEX'?'^TWII':m.id)).then(t=>parseNews(t,'Yahoo 股市')).then(xs=>xs.filter(x=>x.title.includes(term)||x.title.includes(m.name)))])
  ]);
  const seen=new Set();
  const items=r.flatMap(x=>x.status==='fulfilled'?x.value:[]).filter(x=>{if(seen.has(x.title))return false;seen.add(x.title);return true})
   .sort((a,b)=>(b.pub||0)-(a.pub||0)).slice(0,12);
  if(!items.length&&r.every(x=>x.status==='rejected'))throw new Error('新聞來源連線失敗');
  return items;
 });
}
