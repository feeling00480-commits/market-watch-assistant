const root=document.getElementById('cas-design');
let exited=false;
const el=key=>root.querySelector('[data-el="'+key+'"]');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const signed=n=>Number.isFinite(n)?(n>0?'+':n<0?'−':'')+Math.abs(n).toFixed(2)+'%':'—';
const toneFor=n=>n>0?'up':n<0?'down':'neutral';
const review=(text,tone='neutral')=>'<p class="data-review '+tone+'">'+esc(text)+'</p>';
const defaults=[
 {id:'TAIEX',name:'加權指數',market:'臺灣證券交易所 · 現貨指數',type:'大盤',exchange:'tse'},
 ...Object.entries(futuresProducts).map(([id,product])=>({id,name:product.name,market:'臺灣期貨交易所 · 期貨',type:'期貨',contract:'近月'})),
 {id:'2330',name:'台積電',market:'證交所 · 上市',type:'個股',exchange:'tse'},
 {id:'0050',name:'元大台灣50',market:'證交所 · 上市',type:'ETF',exchange:'tse'},
 {id:'2884',name:'玉山金',market:'證交所 · 上市',type:'個股',exchange:'tse'},
 {id:'2890',name:'永豐金',market:'證交所 · 上市',type:'個股',exchange:'tse'}
];
const intervals=[0,15,30,60,300,600,900];
const fastPollSeconds={mis:10,futures:15,us:30,esb:60};
const quoteGroup=m=>isFuture(m)?'futures':isUS(m)?'us':m.exchange==='esb'?'esb':'mis';
const intervalLabel=seconds=>seconds===0?'最快（依來源）':seconds<60?seconds+' 秒':seconds/60+' 分鐘';
const defaultTargetNear=1;
const pricePlanKeys=new Set(['stop','stopNear','entry','entryNear','cost','costNear','costRecovered','costLost','targetNear','target']);
function suggestedRule(m,mode='balanced'){
 const index=m.id==='TAIEX', modeKey=marketMode(m), market=alertModes[modeKey], future=modeKey==='futures';
 const profile={
  quiet:{move:index?2.5:future?3:5,volume:3,relative:3,cooldown:15,tech:false,band:false},
  balanced:{move:index?1.5:future?2:3,volume:2,relative:2,cooldown:10,tech:true,band:false},
  active:{move:index?1:future?1.5:2,volume:1.8,relative:1.5,cooldown:5,tech:true,band:true}
 }[mode];
 if(!profile)return null;
 const multiplier=mode==='quiet'?1.5:mode==='active'?.75:1;
 const round=x=>Math.round(x*10)/10;
 return {...profile,move:profile.move+(modeKey==='esb'?2:modeKey==='us'?1:0),burst:round(market.burst*multiplier),
  volume:index?0:modeKey==='stock'?profile.volume:round(market.volume*multiplier),
  sidePct:canAlertTradeSides(m)&&mode==='active'?65:0,spread:modeKey==='esb'?round(2*multiplier):0,
  relative:modeKey==='stock'&&!index?profile.relative:0,tech:future?false:profile.tech,band:modeKey==='stock'&&profile.band};
}
const defaultRules=Object.fromEntries(defaults.slice(0,2).map(m=>[m.id,suggestedRule(m)]));
const chartPeriods={line:'走勢圖','1m':'1 分 K','5m':'5 分 K','30m':'30 分 K','60m':'60 分 K',day:'日 K',week:'週 K',month:'月 K',profile:'分價圖'};
const minutePeriods={'1m':1,'5m':5,'30m':30,'60m':60};
const chartLevels=['1m','5m','30m','60m','day'];
const chartRanges=[1,3,6,12];
const chartRangeNames={1:'1 個月',3:'1 季',6:'半年',12:'1 年'};
const chartHistoryMonths=13;
const storage='market-watch-assistant-v02';
const watchSorts=['default','custom','up','down'];
let saved={},browserSettingsPresent=false;
try{
 const raw=JSON.parse(localStorage.getItem(storage)||'null');
 if(raw?.watch){saved=cleanSettings(raw);browserSettingsPresent=true;}
}catch{}
settingsChangedAt=saved.updatedAt||0;
const initialPeriod=Object.hasOwn(chartPeriods,saved.chartPeriod)?saved.chartPeriod:'line';
let chartPreferredPeriod=initialPeriod;
const state={
 watch:Array.isArray(saved.watch)?saved.watch:defaults.slice(0,2),
 watchSort:watchSorts.includes(saved.watchSort)?saved.watchSort:'default',
 watchOrder:Array.isArray(saved.watchOrder)?[...new Set(saved.watchOrder)]:[],
 watchPins:Array.isArray(saved.watchPins)?[...new Set(saved.watchPins)]:[],
 rules:saved.rules||defaultRules,seconds:intervals.includes(saved.seconds)?saved.seconds:intervals.includes(saved.minutes*60)?saved.minutes*60:30,
 backup:saved.backup||{enabled:true,minutes:5},update:saved.update||{enabled:true,autoDownload:true},
 notify:saved.notify!==false,snapshot:saved.snapshot||'詳細',appearance:normalizeAppearance(saved.appearance),
 snapshotFields:saved.snapshotFields||{time:true,range:true,volume:true},id:null,k:!['line','profile'].includes(initialPeriod),period:initialPeriod,
 months:chartRanges.includes(saved.chartMonths)?saved.chartMonths:3,profileDays:profileRanges.includes(saved.profileDays)?saved.profileDays:20,run:false,tab:'research',alerts:false,modal:'',
 last:0,next:0,busy:false,items:new Map(),details:new Map(),tracking:new Map(),events:[],session:'',snapSlots:new Set()
};
state.id=state.watch[0]?.id||null;
const selected=()=>state.watch.find(x=>x.id===state.id);
const quoteFor=m=>state.items.get(m.id);
const pct=q=>valid(q?.prev)&&valid(q?.price)?(q.price/q.prev-1)*100:NaN;
const digit=m=>isFuture(m)?futuresProducts[m.id].digits:2;
const maxAge=2*60000;
let telegram={chat:'',enabled:false};
const sessionReady=localMode&&/^[0-9a-f]{32}$/.test(bridgeSession);
async function loadTelegramStatus(){
 try{telegram=await json('telegram-status')}catch{}
}
async function telegramSend(text,silent){
 if(!telegram.enabled)return;
 try{
  await bridge('telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,3900),disable_notification:!!silent})});
 }catch(e){log({title:'Telegram 發送失敗',body:message(e),kind:'error'});}
}
const fresh=q=>q&&!q.closing&&!q.delayed&&Number.isFinite(q.ts)&&q.ts<=Date.now()+60000&&Date.now()-q.ts<=maxAge;
const message=e=>String(e?.message||e||'失敗');
const pressed=(act,on)=>root.querySelector('[data-act="'+act+'"]').setAttribute('aria-pressed',String(on));
function persist(){
 settingsChangedAt=Date.now();storeBrowserSettings(settingsData());queueSettingsBackup();
}

function log(e){
 state.events.unshift({at:Date.now(),...e});
 state.events=state.events.slice(0,72);
 drawFeed();
}
async function showNotice(text,preview=false){
 const vars=appearanceVars(state.appearance);
 const colors={background:vars['--paper'],foreground:vars['--ink'],accent:vars['--accent'],border:vars['--line']};
 const status=preview?el('noticeTestStatus'):null;
 if(status)status.textContent='正在送出測試警報…';
 try{
  const body=await bridge('desktop-notice',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text:text.slice(0,280),colors})});
  const channel=body?JSON.parse(body)?.channel:null;
  if(channel!=='popup'&&channel!=='queued')throw new SyntaxError('Invalid desktop notice response');
  if(preview){
   const result=channel==='popup'?'Windows 桌面小窗已開啟。':'測試警報已排隊。';
   if(status)status.textContent=result;
   log({title:'測試通知',body:result});
  }
  return channel;
 }catch(e){
  const reason=e.status===503?'Windows 桌面小窗未能顯示，請查看啟動視窗。':
   e.status===429?'桌面小窗的警報佇列已滿。':
   e.status===403?'請從啟動器開出的頁面操作。':
   e.status===400?'本機服務未能讀取警報內容。':
   e instanceof SyntaxError?'本機服務未回傳有效的通知狀態。':'無法連到本機通知服務（'+message(e)+'）。';
  if(status)status.textContent=reason;
  log({title:'Windows 桌面警報未送出',body:reason,kind:'error'});
  return null;
 }
}
function previewNotice(){
 return showNotice('【測試】這是看盤小助手的警報。',true);
}
function securityInfo(q){
 if(!q)return '等待行情';
 const ts=Number.isFinite(q.ts)?twDate(q.ts)+' '+twTime(q.ts):'時間未知';
 return q.source+(q.sessionLabel?' · '+q.sessionLabel:'')+' · '+ts+(fresh(q)?'':' · 非最新盤中報價')+(q.error?' · 更新失敗':'');
}
function metrics(m,q,days){
 const bars=q?.bars||[], date=q&&Number.isFinite(q.ts)?marketDate(m,q.ts):null;
 const hist=(days||[]).filter(b=>!date||marketDate(m,b.t)<date);
 const closes=hist.map(b=>b.c), ma=n=>closes.length>=n?mean(closes.slice(-n)):NaN;
 const startOfSession=date&&!isFuture(m)&&!isUS(m)?Date.parse(date+'T09:00:00+08:00'):NaN;
 const openMinutes=startOfSession+15*60000;
 const opening=bars[0]?.t<=startOfSession+5*60000?bars.filter(x=>x.t>=startOfSession&&x.t<openMinutes):[];
 const dayVolume=mean(hist.slice(-20).map(x=>x.v).filter(valid));
 const start=bars[0]?.t;
 const span=valid(start)?Math.max(1,(q.ts-start)/60000):0;
 const length=isFuture(m)?0:270;
 const volumeRatio=length&&span>=15&&span<=length+4&&valid(dayVolume)&&valid(q?.volume)
  ? ((m.id==='TAIEX'?NaN:q.volume*1000)/dayVolume)/Math.min(1,span/length):NaN;
 return {
  ma5:ma(5),ma20:ma(20),ma60:ma(60),
  openLow:opening.length?Math.min(...opening.map(x=>x.l)):NaN,
  openHigh:opening.length?Math.max(...opening.map(x=>x.h)):NaN,
  bandReady:opening.length>1&&q.ts>=openMinutes,
  ratio:q?.source==='證交所 MIS'?volumeRatio:NaN,
  hi:valid(q?.high)?q.high:bars.length?Math.max(...bars.map(x=>x.h)):NaN,
  lo:valid(q?.low)?q.low:bars.length?Math.min(...bars.map(x=>x.l)):NaN
 };
}
function pricePlanHit(m,q,rule,previous){
 if(!valid(q?.price)||rule.enabled===false)return null;
 const price=q.price, digits=digit(m), unit=isUS(m)?'US$ ':'';
 const near=rule.targetNear??defaultTargetNear;
 const closeTo=value=>valid(near)&&near<=100&&Math.abs(value-price)/value*100<=near+1e-9;
 const gap=value=>fmt(Math.abs(value-price)/value*100,2)+'%';
 const levels=[
  ['stop','停損價',rule.stop,1,-1],
  ['target','目標價',rule.target,2,1],
  ['entry','計畫進場價',rule.entry,2,-1]
 ].filter(([, ,value])=>valid(value));
 for(const [key,name,value,level,side] of levels){
  if(side*(price-value)>=0){
   const action=price===value?'觸及':side>0?'已高於':'已低於';
   return [key,action+name+' '+unit+fmt(value,digits),level];
  }
  if(closeTo(value))return [key+'Near','接近'+name+' '+unit+fmt(value,digits)+'，差 '+gap(value),2];
 }
 if(!valid(rule.entry)&&valid(rule.cost)){
  const cost=rule.cost;
  if(price===cost)return ['cost','觸及成本參考價 '+unit+fmt(cost,digits),2];
  if(valid(previous?.price)&&previous.source===q.source){
   if(previous.price<cost&&price>cost)return ['costRecovered','較上筆回升越過成本 '+unit+fmt(cost,digits),2];
   if(previous.price>cost&&price<cost)return ['costLost','較上筆跌破成本 '+unit+fmt(cost,digits),2];
  }
  if(closeTo(cost))return ['costNear','接近成本參考價 '+unit+fmt(cost,digits)+'，目前'+(price<cost?'低於':'高於')+'成本 '+gap(cost),2];
 }
 return null;
}
function conditions(m,q,days,includePlan=true){
 const rule=state.rules[m.id]||{}, out=[], delta=pct(q), v=metrics(m,q,days);
 if(!q||rule.enabled===false)return out;
 const plan=pricePlanHit(m,q,rule);
 if(includePlan&&plan)out.push(plan);
 if(plan?.[0]!=='stop'&&rule.warn>0&&q.price<rule.warn)out.push(['warn','跌破警戒 '+fmt(rule.warn,digit(m)),2]);
 if(rule.move>0&&Math.abs(delta)>=rule.move)out.push([delta<0?'fall':'rise',(delta<0?'跌幅':'漲幅')+'達警戒 '+signed(delta),2]);
 if(rule.tech&&valid(v.ma60)&&q.price<v.ma60)out.push(['ma60','價格低於季線',2]);
 else if(rule.tech&&valid(v.ma20)&&q.price<v.ma20)out.push(['ma20','價格低於月線',3]);
 if(rule.band&&v.bandReady&&(q.price<v.openLow||q.price>v.openHigh))
  out.push(q.price<v.openLow?['below','跌破開盤低點',3]:['above','突破開盤高點',3]);
 const activity=marketAlertSignals(m,q,rule,state.details.get(m.id));
 if(rule.volume>0&&v.ratio>=rule.volume&&!activity.hits.some(h=>h[0]==='turnover'))out.push(['volume','盤中估算量比 '+fmt(v.ratio,1)+' 倍',3]);
 const index=state.items.get('TAIEX');
 if(rule.relative>0&&m.id!=='TAIEX'&&marketMode(m)==='stock'&&fresh(index)&&fresh(q)&&pct(index)-delta>=rule.relative)out.push(['relative','比大盤弱 '+(pct(index)-delta).toFixed(2)+' 個百分點',3]);
 return [...out,...activity.hits];
}
function alertTone(key){
 if(['rise','above','target','targetNear','spikeUp','buyPressure','costRecovered'].includes(key))return 'rising';
 return ['stop','stopNear','warn','fall','ma60','ma20','below','relative','spikeDown','sellPressure','costLost'].includes(key)?'falling':'';
}
function resetPricePlanTracking(){
 for(const tracking of state.tracking.values()){
  tracking.planStamp=0;tracking.planQuote=null;
  for(const key of pricePlanKeys){
   tracking.active.delete(key);
   tracking.lastSent.delete(key);
  }
 }
}
function evaluated(m,q,planOnly=false){
 if(!valid(q?.price)||state.rules[m.id]?.enabled===false)return;
 const session=alertSession(m,q);
 if(!session)return;
 let t=state.tracking.get(m.id);
 if(!t||t.session!==session){t={session,stamp:0,active:new Map(),lastSent:new Map()};state.tracking.set(m.id,t)}
 const stamp=planOnly?'planStamp':'stamp';
 if((t[stamp]||0)>=q.ts)return;
 t[stamp]=q.ts;
 const detail=getDetail(m),days=detail.daily?.bars;
 if(!planOnly)observeAlertActivity(m,q,detail,session);
 const plan=planOnly?pricePlanHit(m,q,state.rules[m.id]||{},t.planQuote):null;
 if(planOnly)t.planQuote={price:q.price,source:q.source};
 if(planOnly&&!plan&&![...pricePlanKeys].some(key=>t.active.has(key)))return;
 const hits=planOnly?(plan?[plan]:[]):conditions(m,q,days,false),keys=new Set(hits.map(h=>h[0]));
 const priceKey=plan?.[0]?.replace(/Near$/,'');
 if(priceKey){
  for(const key of [priceKey,priceKey+'Near'])if(t.active.has(key))keys.add(key);
 }
 const newHits=[];
 for(const [key,body,level] of hits){
  if(t.active.has(key)){t.active.get(key).clears=0;continue}
  if(key.endsWith('Near')&&t.active.has(key.slice(0,-4)))continue;
  const item={body,clears:0,notified:false};
  const cooldown=key==='stop'||key==='target'?0:(state.rules[m.id]?.cooldown??10)*60000;
  const last=t.lastSent.get(key);
  if(last!==undefined&&q.ts-last<cooldown){
   continue;
  }
  t.active.set(key,item);
  t.lastSent.set(key,q.ts);item.notified=true;
  newHits.push({body,level,key});
 }
 const clears=[], v=metrics(m,q,days), index=state.items.get('TAIEX');
 const measurable={...marketAlertSignals(m,q,state.rules[m.id]||{},detail).measurable,rise:Number.isFinite(pct(q)),fall:Number.isFinite(pct(q)),ma60:valid(v.ma60),ma20:valid(v.ma20),above:v.bandReady,below:v.bandReady,volume:Number.isFinite(v.ratio),relative:fresh(index)&&Number.isFinite(pct(index))&&Number.isFinite(pct(q))};
 for(const [key,item] of t.active){
  if(pricePlanKeys.has(key)!==planOnly)continue;
  if(keys.has(key)){item.clears=0;continue}
  if(measurable[key]!==false&&++item.clears>=2){
   t.active.delete(key);
   if(item.notified&&(!planOnly||key==='stop'))clears.push(item.body);
  }
 }
 if(newHits.length){
  const body=newHits.map(x=>x.body).join('、');
  const level=Math.min(...newHits.map(x=>x.level));
  const mode=marketMode(m), market=alertModes[mode].label;
  const label='【'+market+(mode==='futures'?' '+(m.contract||'近月')+' '+(futureSessionKey(q.ts).startsWith('night:')?'夜盤':'日盤'):'')+'】';
  const price=(mode==='us'?'US$ ':'')+fmt(q.price,digit(m));
  const stamp=mode==='us'?modeET.format(q.ts)+' 美東':twDate(q.ts)+' '+twTime(q.ts)+' 台北';
  addEvent(m,q,label+' '+body,'alert',level,alertTone(newHits.find(x=>x.level===level).key));
  if(state.notify&&newHits.some(x=>x.level<=2))showNotice(label+m.name+' '+price+'｜'+body);
  const volume=Number.isFinite(v.ratio)?'｜量比 '+fmt(v.ratio,1)+'×（估算）':'';
  telegramSend(label+m.name+' '+price+'（'+signed(pct(q))+'）\n'+body+volume+'\n'+stamp,newHits.every(x=>x.level>2));
 }
 if(clears.length)addEvent(m,q,clears.join('、')+'已解除（連續兩筆確認）','clear');
}
function addEvent(m,q,body,kind,level,tone){
 const v=metrics(m,q,state.details.get(m.id)?.daily?.bars);
 log({id:m.id,title:m.name+' '+fmt(q.price,digit(m))+'（'+signed(pct(q))+'）',body,kind,level,tone,
  quoteAt:q.ts,range:rangeText(v,m),ohlc:quoteRange(q,v,m),volume:v.ratio,volumeText:quoteVolume(q,m),source:q.source+(q.sessionLabel?' · '+q.sessionLabel:''),fresh:fresh(q)});
}
function rangeText(v,m){
 return v.bandReady&&valid(v.openLow)&&valid(v.openHigh)?fmt(v.openLow,digit(m))+'～'+fmt(v.openHigh,digit(m)):'—';
}
function quoteVolume(q,m){
 if(!Number.isFinite(q?.volume))return '—';
 if(isFuture(m))return fmt(q.volume,0)+' 口';
 if(isUS(m))return fmt(q.volume,0)+' 股';
 return q.source==='證交所 MIS'||q.volumeUnit==='張'?fmt(q.volume,0)+' 張':fmt(q.volume/1000,0)+' 張';
}
function quoteRange(q,v,m){
 return [q?.open,v.hi,v.lo].map(x=>fmt(x,digit(m))).join('／');
}
function drawFeed(){
 const visible=state.events.filter(e=>!state.alerts||e.kind==='alert'||e.kind==='clear');
 el('feed').innerHTML=visible.slice(0,32).map(e=>
  '<li><time>'+esc(twTime(e.at))+'</time><div class="event '+(e.kind==='alert'?'alert '+(e.tone||''):'')+'">'+
  (e.id&&state.watch.some(m=>m.id===e.id)?'<button class="clean event-link" data-act="select" data-id="'+esc(e.id)+'">'+esc(e.title)+'</button>':'<b>'+esc(e.title)+'</b>')+
  (e.id?'<p class="sub">開／高／低 '+esc(e.ohlc)+'<br>開盤區間 '+esc(e.range)+' · 成交量 '+esc(e.volumeText)+'<br>量比 '+(Number.isFinite(e.volume)?fmt(e.volume,1)+'×（估算）':'—')+'</p>':'')+
  '<p class="'+(e.kind==='alert'?'reason':'sub')+'">'+esc((e.level?'L'+e.level+' · ':'')+e.body)+'</p>'+
  (e.source?'<p class="event-status">'+esc(e.source)+' · '+twDate(e.quoteAt)+' '+twTime(e.quoteAt)+(e.fresh?'':' · 非最新盤中')+'</p>':'')+'</div></li>'
 ).join('')||'<li><span></span><p class="sub">暫無監控動態</p></li>';
}
function watchRisk(m,price){
 const rule=state.rules[m.id]||{};
 if(rule.enabled===false)return '';
 if(valid(rule.stop)&&price<=rule.stop)return '觸及停損價';
 return valid(rule.warn)&&price<rule.warn?'跌破警戒價':'';
}
function isCashClose(q,days,now){
 if(!Number.isFinite(q?.ts)||q.ts>now)return false;
 if(q.closing)return true;
 const last=days?.at(-1),time=twTime(q.ts),date=twDate(q.ts);
 if(date===twDate(now)&&twTime(now)<dailyRefreshTime)return false;
 return (last?.t<=now&&twDate(last.t)===date&&last.c===q.price)||
  (q.source==='證交所 MIS'&&time>=dailyCloseTime&&time<dailyRefreshTime);
}
function closingWatchSituation(m,q,days,now,risk){
 const date=twDate(q.ts),delta=pct(q);
 const prior=(days||[]).filter(b=>twDate(b.t)<date);
 const ma=n=>prior.length>=n?mean(prior.slice(-n).map(b=>b.c)):NaN;
 const levels=[['季線',60],['月線',20]].map(([name,n])=>{
  const previous=ma(n),current=prior.length>=n-1?mean([...prior.slice(1-n).map(b=>b.c),q.price]):NaN;
  return {name,previous,current};
 });
 const crossed=valid(q.prev)&&levels.find(x=>valid(x.previous)&&valid(x.current)&&(q.prev>=x.previous)!==(q.price>=x.current));
 const change=crossed?(q.price>=crossed.current?'收復':'失守')+crossed.name:'';
 const below=levels.find(x=>valid(x.current)&&q.price<x.current);
 const index=state.items.get('TAIEX'),indexDays=state.details.get('TAIEX')?.daily?.bars;
 const relative=m.id!=='TAIEX'&&!index?.error&&isCashClose(index,indexDays,now)&&twDate(index.ts)===date?
  delta-pct(index):NaN;
 const volume=researchVolume(null,days||[],NaN,now);
 const largeVolume=volume&&twDate(volume.at)===date&&volume.ratio>=1.5;
 const move=!Number.isFinite(delta)?'漲跌未確認':Math.abs(delta)<.1?'近乎持平':
  (largeVolume?'放量'+(delta>0?'上漲':'下跌'):
   Math.abs(delta)>=3?(delta>0?'大漲':'大跌'):delta>0?'走強':'走弱');
 const range=valid(q.low)&&valid(q.high)&&q.high>q.low&&q.price>=q.low&&q.price<=q.high?(q.price-q.low)/(q.high-q.low):NaN;
 const rangeNote=range>=.85?'接近日高':range<=.15?'接近日低':'';
 const context=change||(Math.abs(relative)>=1?(relative>0?'領先':'落後')+'大盤 '+fmt(Math.abs(relative),1)+' 個百分點':
  rangeNote||(below?'仍低於'+below.name:levels.every(x=>valid(x.current))?'守在月線與季線上方':''));
 const today=date===twDate(now);
 if(!today||q.error)risk='';
 const prefix=(q.error?'報價未更新 · ':'')+(today?'':date.slice(5)+' ')+'收盤';
 return {text:[risk,prefix+move,context].filter(Boolean).slice(0,2).join('，'),attention:!!risk};
}
function watchSituation(m,q,days,now=Date.now()){
 if(!q||!valid(q.price))return {text:'等待行情',attention:false};
 const risk=watchRisk(m,q.price);
 if(isFuture(m)){
  const x=futureContext(m,q,state.details.get(m.id)||{},now);
  return {text:risk&&fresh(q)&&!q.error?risk+'，'+x.review.text:x.review.text,attention:!!risk&&fresh(q)&&!q.error};
 }
 if(!isFuture(m)&&!isUS(m)&&(m.exchange!=='esb'||q.closing||twTime(now)>='15:00:00')&&isCashClose(q,days,now))
  return closingWatchSituation(m,q,days,now,risk);
 const current=!q.error&&!q.delayed&&!q.closing&&Number.isFinite(q.ts)&&q.ts<=now+60000&&now-q.ts<=maxAge;
 const stats=metrics(m,q,days);
 const trend=valid(stats.ma60)&&q.price<stats.ma60?'在季線下方':
  valid(stats.ma20)&&q.price<stats.ma20?'在月線下方':
  valid(stats.ma60)&&valid(stats.ma20)&&q.price>stats.ma20&&stats.ma20>stats.ma60?'站在月線與季線上方':'';
 const delta=pct(q);
 const move=valid(q.open)?100*(q.price/q.open-1):delta;
 const volume=Number.isFinite(stats.ratio)&&stats.ratio>=1.5;
 if(!current){
  const moveLabel=!Number.isFinite(delta)?'漲跌未確認':Math.abs(delta)<.1?'近乎持平':
   Math.abs(delta)>=3?(delta>0?'大漲':'大跌'):delta>0?'走強':'走弱';
  const date=Number.isFinite(q.ts)&&twDate(q.ts)!==twDate(now)?twDate(q.ts).slice(5)+' ':'';
  const label=q.sessionLabel||'上筆報價';
  return {text:[(q.error?'報價未更新 · ':'')+date+label+(isUS(m)?' · ':'')+moveLabel,trend].filter(Boolean).join('，'),attention:false};
 }
 const cross=trend==='在季線下方'&&valid(q.prev)&&q.prev>=stats.ma60?'跌破季線':
  trend==='在月線下方'&&valid(q.prev)&&q.prev>=stats.ma20?'跌破月線':trend;
 const session=q.sessionLabel==='夜盤時段報價'?'夜盤':'盤中';
 const flow=!Number.isFinite(move)||Math.abs(move)<.2?session+'震盪':
  move>0?(volume?'量能放大、價格走強':session+'走強'):
  (volume?'量能放大、價格走弱':session+'走弱');
 const d=state.details.get(m.id),volumeProfile=d?.profilePreview;
 const nearby=volumeProfile&&profileReadout(volumeProfile,q.price,m);
 const extra=nearby?.active?'位於成交密集區':nearby?.gap<=1?'接近成交密集區':'';
 return {text:[risk||extra||cross,flow].filter(Boolean).join('，'),attention:!!risk};
}
const watchPanel=el('watch');
const pinIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3l6 6-2 1-2 4 1 2-1 1-5-2-6 6-2-2 6-6-2-5 1-1 2 1 4-2z"/></svg>';
let watchDrag=null;
function customWatchIds(){
 const current=state.watch.map(m=>m.id);
 return [...new Set([...state.watchOrder.filter(id=>current.includes(id)),...current])];
}
function watchList(){
 const lookup=new Map(state.watch.map(m=>[m.id,m]));
 const pinned=state.watchPins.map(id=>lookup.get(id)).filter(Boolean);
 const unpinned=state.watch.filter(m=>!state.watchPins.includes(m.id));
 if(state.watchSort==='custom'){
  const order=customWatchIds();
  unpinned.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
 }else if(state.watchSort==='up'||state.watchSort==='down'){
  const direction=state.watchSort==='down'?1:-1;
  unpinned.sort((a,b)=>{
   const aa=pct(quoteFor(a)),bb=pct(quoteFor(b));
   return Number.isFinite(aa)&&Number.isFinite(bb)?direction*(aa-bb):Number.isFinite(aa)?-1:Number.isFinite(bb)?1:0;
  });
 }
 return [...pinned,...unpinned];
}
function drawWatch(){
 el('count').textContent=state.watch.length+' 檔';
 if(watchDrag)return;
 const active=document.activeElement;
 const custom=state.watchSort==='custom';
 el('watchSortHint').hidden=!custom;
 const focus=watchPanel.contains(active)?active.dataset:null;
 watchPanel.innerHTML=watchList().map(m=>{
  const q=quoteFor(m),delta=pct(q),dir=delta<0?'down':delta>0?'up':'flat',pinned=state.watchPins.includes(m.id);
  const situation=watchSituation(m,q,state.details.get(m.id)?.daily?.bars);
  const id=esc(m.id),name=esc(m.name),pinLabel=(pinned?'取消釘選':'釘選')+name;
  return '<div class="tile '+(m.id===state.id?'selected':'')+'" data-watch-id="'+id+'">'+
   (custom?'<button type="button" class="clean watch-grip" draggable="true" data-act="watchGrip" data-id="'+id+'" aria-label="移動'+name+'" title="拖曳或用上下方向鍵移動">⠿</button>':'')+
   '<button class="pick" data-act="select" data-id="'+id+'" aria-pressed="'+(m.id===state.id)+'"><strong><span class="quote-dot '+dir+'"></span>'+name+'</strong>'+
   '<span class="quote num"><b>'+(isUS(m)?'US$ ':'')+fmt(q?.price,digit(m))+'</b><span class="'+dir+'">（'+signed(delta)+'）</span></span>'+
   '<span class="watch-summary'+(situation.attention?' attention':'')+'">'+esc(situation.text)+'</span></button>'+
   '<div class="watch-actions"><button class="clean watch-pin" data-act="watchPin" data-id="'+id+'" aria-label="'+pinLabel+'" title="'+pinLabel+'" aria-pressed="'+pinned+'">'+pinIcon+'</button>'+
   '<button class="clean more" data-act="manage" data-id="'+id+'" aria-label="管理'+name+'">⋯</button></div></div>';
 }).join('');
 if(focus)Array.from(watchPanel.querySelectorAll('button')).find(b=>b.dataset.act===focus.act&&b.dataset.id===focus.id)?.focus({preventScroll:true});
}
function moveWatch(id,target,after){
 if(state.watchSort!=='custom'||id===target)return;
 const pinned=state.watchPins.includes(id);
 if(pinned!==state.watchPins.includes(target))return;
 const list=pinned?[...state.watchPins]:watchList().filter(m=>!state.watchPins.includes(m.id)).map(m=>m.id);
 if(!list.includes(id)||!list.includes(target))return;
 list.splice(list.indexOf(id),1);
 list.splice(list.indexOf(target)+(after?1:0),0,id);
 if(pinned)state.watchPins=list;
 else{
  let index=0;
  state.watchOrder=customWatchIds().map(item=>state.watchPins.includes(item)?item:list[index++]);
 }
 persist();
 drawWatch();
}
function focusWatchGrip(id){
 [...watchPanel.querySelectorAll('.watch-grip')].find(button=>button.dataset.id===id)?.focus({preventScroll:true});
}
watchPanel.addEventListener('keydown',e=>{
 const grip=e.target.closest('.watch-grip');
 if(!sessionReady||!grip||!['ArrowUp','ArrowDown'].includes(e.key))return;
 const id=grip.dataset.id,pinned=state.watchPins.includes(id),down=e.key==='ArrowDown';
 const list=watchList().filter(m=>state.watchPins.includes(m.id)===pinned);
 const target=list[list.findIndex(m=>m.id===id)+(down?1:-1)];
 e.preventDefault();
 if(target){moveWatch(id,target.id,down);focusWatchGrip(id);}
});
watchPanel.addEventListener('dragstart',e=>{
 const grip=e.target.closest('.watch-grip');
 if(!sessionReady||!grip||state.watchSort!=='custom'){e.preventDefault();return;}
 watchDrag={id:grip.dataset.id,hover:null,after:false};
 e.dataTransfer.effectAllowed='move';
 e.dataTransfer.setData('text/plain',watchDrag.id);
 grip.closest('[data-watch-id]').classList.add('watch-dragging');
});
watchPanel.addEventListener('dragover',e=>{
 if(!watchDrag)return;
 const tile=e.target.closest('[data-watch-id]'),target=tile?.dataset.watchId;
 const allowed=target&&target!==watchDrag.id&&state.watchPins.includes(target)===state.watchPins.includes(watchDrag.id);
 watchDrag.hover?.classList.remove('watch-drop-before','watch-drop-after');
 watchDrag.hover=null;
 if(!allowed)return;
 e.preventDefault();
 e.dataTransfer.dropEffect='move';
 const bounds=tile.getBoundingClientRect();
 watchDrag.after=e.clientY>=bounds.top+bounds.height/2;
 watchDrag.hover=tile;
 tile.classList.add(watchDrag.after?'watch-drop-after':'watch-drop-before');
});
watchPanel.addEventListener('dragleave',e=>{
 if(watchDrag?.hover&&!watchDrag.hover.contains(e.relatedTarget)){
  watchDrag.hover.classList.remove('watch-drop-before','watch-drop-after');
  watchDrag.hover=null;
 }
});
watchPanel.addEventListener('drop',e=>{
 if(!watchDrag)return;
 const target=e.target.closest('[data-watch-id]');
 if(!target||target!==watchDrag.hover)return;
 e.preventDefault();
 const {id,after}=watchDrag;
 watchDrag=null;
 moveWatch(id,target.dataset.watchId,after);
 focusWatchGrip(id);
});
watchPanel.addEventListener('dragend',()=>{
 if(!watchDrag)return;
 watchDrag=null;drawWatch();
});
function getDetail(m){if(!state.details.has(m.id))state.details.set(m.id,{});return state.details.get(m.id)}
const intradaySamples=new Map();
function recordIntraday(m,q){
 if((q.source!=='證交所 MIS'&&m.exchange!=='esb')||q.closing||!Number.isFinite(q.ts)||!valid(q.price))return;
 const day=twDate(q.ts);
 let entry=intradaySamples.get(m.id);
 if(!entry||entry.day!==day){
  entry={day,bars:[]};intradaySamples.set(m.id,entry);
 }
 const last=entry.bars.at(-1);
 if(last&&last.t>=q.ts)return;
 entry.bars.push({t:q.ts,c:q.price,snapshot:true});
 if(entry.bars.length>1400)entry.bars.shift();
}
function intradayPlot(m,q){
 if(!q)return {bars:[],label:''};
 const entry=intradaySamples.get(m.id), history=q.bars||[];
 if(!entry||entry.day!==twDate(q.ts)||(m.exchange==='esb'?history.length>0:q.source!=='證交所 MIS'))return {bars:history,label:q.chartSource||q.source};
 const samples=entry.bars, first=samples[0].t, bucket=(q.barMinutes||1)*60000;
 const prior=history.filter(b=>b.t+bucket<=first);
 return {bars:[...prior,...samples],label:(prior.length?(q.chartSource||'歷史分時')+'補前段 · ':'')+q.source+' 快照自 '+twTime(first)};
}
const isMinute=()=>Object.hasOwn(minutePeriods,state.period);
const barTime=t=>isMinute()?twDate(t)+' '+twTime(t):state.period==='line'?twTime(t):twDate(t);
const plot=el('chart');
let chartCursor=null,chartZoom=null,chartHover=null,chartWheelSize=null,chartPending=null,chartDrag=null;
const chartKey=m=>[m.id,m.contract,state.period,state.months,isFuture(m)?getDetail(m).futureChartSession:''].join('|');
function chartRangePressed(months){
 for(const button of root.querySelectorAll('[data-act="range"]'))button.setAttribute('aria-pressed',String(Number(button.dataset.id)===months));
}
function showChartDetail(bar,i){
 const detail=el('chartDetail');
 if(!bar){detail.textContent='';return;}
 if(bar.snapshot){detail.textContent=twTime(bar.t)+' · 快照成交價 '+fmt(bar.c);return;}
 const m=selected(), prev=chartCursor?.previous[i], n=digit(m), x=chartCursor?.computed[i];
 const delta=valid(prev)?(bar.c/prev-1)*100:NaN;
 const volume=Number.isFinite(bar.v)?fmt(isFuture(m)||isUS(m)?bar.v:bar.v/1000,0)+(isFuture(m)?' 口':isUS(m)?' 股':' 張'):'—';
 detail.textContent=[barTime(bar.t)+(bar.end&&twDate(bar.end)!==twDate(bar.t)?'～'+twDate(bar.end):''),'開 '+fmt(bar.o,n),'高 '+fmt(bar.h,n),'低 '+fmt(bar.l,n),'收 '+fmt(bar.c,n),'漲跌 '+signed(delta),'量 '+volume].join(' · ');
 el('maLegend').innerHTML=x?x.ma.map((v,k)=>'<span style="color:'+maColors[k]+'">MA'+maPeriods[k]+' '+fmt(v,n)+'</span>').join(''):'';
}
function nearestChartBar(cursor){
 return chartCursor.positions.reduce((nearest,x,j)=>Math.abs(x-cursor)<Math.abs(chartCursor.positions[nearest]-cursor)?j:nearest,0);
}
function showChartCursor(cursor){
 if(!chartCursor)return;
 const {bars,positions}=chartCursor;
 const i=nearestChartBar(cursor),bar=bars[i],x=positions[i],y=chartCursor.y(bar.c);
 showChartDetail(bar,i);
 for(const line of root.querySelectorAll('[data-crosshair]')){
  line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('visibility','visible');
 }
 const marker=plot.querySelector('[data-chart-marker]');
 if(!marker)return;
 const time=chartCursor.multiday?twDate(bar.t).slice(5)+' '+twTime(bar.t).slice(0,5):
  !state.k||isMinute()?twTime(bar.t):twDate(bar.end||bar.t);
 const labelX=Math.max(42,Math.min(chartCursor.end-42,x));
 marker.innerHTML='<path d="M0 '+y+'H'+chartCursor.end+'" stroke="var(--cursor-line)" stroke-dasharray="3 3"/>'+
  '<g transform="translate('+(chartCursor.end+2)+' '+Math.max(10,y)+')"><rect y="-9" width="66" height="18" rx="3"/>'+
  '<text x="33" y="0">'+esc(fmt(bar.c,digit(selected())))+'</text></g>'+
  '<g transform="translate('+labelX+' '+(chartCursor.height-10)+')"><rect x="-41" y="-9" width="82" height="18" rx="3"/>'+
  '<text x="0" y="0">'+esc(time)+'</text></g>';
 marker.setAttribute('visibility','visible');
}
function moveCursor(event){
 if(!chartCursor)return;
 const x=event.clientX-plot.getBoundingClientRect().left;
 if(x<0||x>chartCursor.end){clearCursor();return;}
 chartHover=x;showChartCursor(x);
}
function clearCursor(){
 chartHover=null;
 if(chartCursor)showChartDetail(chartCursor.bars.at(-1),chartCursor.bars.length-1);
 for(const line of root.querySelectorAll('[data-crosshair]'))line.setAttribute('visibility','hidden');
 plot.querySelector('[data-chart-marker]')?.setAttribute('visibility','hidden');
}
function setChartPeriod(period){
 endChartPan();
 state.period=period;state.k=!['line','profile'].includes(period);
 chartPending=null;
}
function zoomWindow(raw,base,count,anchor,fraction){
 const start=Math.max(base,Math.min(raw.length-count,anchor-Math.round(fraction*(count-1))));
 return {start,stop:start+count,from:raw[start].t,to:raw[start+count-1].t};
}
function chartZoomLimit(end){
 return Math.max(12,Math.ceil(end/48)+1);
}
const minuteHistoryDue=d=>!d.minuteAttemptAt||Date.now()-d.minuteAttemptAt>=5*60000;
function transitionChart(m,d,q,period,view,anchor,fraction,x,finer){
 const target=period==='day'?d.daily?.bars||[]:minuteSeries(q,d,minutePeriods[period]).raw;
 const targetDay=twDate(anchor.t),matchingDay=target.some(b=>twDate(b.t)===targetDay);
 const latestDaily=state.period==='day'&&anchor.t===view.raw.at(-1).t&&target.length&&twDate(target.at(-1).t)>targetDay;
 if(minutePeriods[period]>=30&&!isFuture(m)&&!d.minuteHistory&&(d.minuteLoading||minuteHistoryDue(d))){
  if(!chartPending){
   const pending={key:view.key};
   chartPending=pending;
   loadMinuteHistory(m,d)?.then(()=>{
    if(chartPending!==pending||selected()!==m||chartKey(m)!==pending.key)return;
    chartPending=null;
    transitionChart(m,d,quoteFor(m),period,view,anchor,fraction,x,finer);
   });
  }
  return;
 }
 if(!target.length||finer&&!matchingDay&&!latestDaily){
  const hint=' · 這段日期沒有可用的 '+chartPeriods[period];
  const source=el('chartSource');
  if(!source.textContent.endsWith(hint))source.textContent+=hint;
  return;
 }
 const bucket=minutePeriods[period]*60000;
 const stamp=latestDaily&&!matchingDay?target.at(-1).t:bucket?Math.floor(anchor.t/bucket)*bucket:anchor.t;
 const index=target.reduce((nearest,b,i)=>Math.abs(b.t-stamp)<Math.abs(target[nearest].t-stamp)?i:nearest,0);
 const from=view.bars[0].t,to=view.bars.at(-1).t;
 const contains=period==='day'||state.period==='day'?
  b=>twDate(b.t)>=twDate(from)&&twDate(b.t)<=twDate(to):b=>b.t>=from&&b.t<=to;
 const overlap=target.filter(contains).length;
 const count=Math.min(target.length,Math.max(chartZoomLimit(view.end)+4,overlap));
 const window=zoomWindow(target,0,count,index,fraction);
 setChartPeriod(period);
 chartZoom={key:chartKey(m),from:window.from,to:window.to};
 chartWheelSize=null;chartHover=x;
 render();loadDetails(m);
}
function startChartPan(event){
 if(event.button!==0||event.isPrimary===false||!chartCursor||state.period==='profile')return;
 const x=event.clientX-plot.getBoundingClientRect().left;
 if(x<0||x>chartCursor.end)return;
 const {bars,positions,key}=chartCursor;
 const step=positions.length>1?(positions.at(-1)-positions[0])/(positions.length-1):0;
 if(step<=0)return;
 chartDrag={pointerId:event.pointerId,area:event.currentTarget,key,x:event.clientX,
  from:bars[0].t,count:bars.length,step,moved:false};
 event.currentTarget.setPointerCapture(event.pointerId);
}
function moveChartPan(event){
 const drag=chartDrag,view=chartCursor,m=selected();
 if(!drag||event.pointerId!==drag.pointerId)return;
 if(!view||!m||chartKey(m)!==drag.key){endChartPan();return;}
 const delta=event.clientX-drag.x;
 if(!drag.moved&&Math.abs(delta)<4)return;
 drag.moved=true;
 event.preventDefault();
 const anchor=view.raw.findIndex(b=>b.t===drag.from);
 if(anchor<0){endChartPan();return;}
 const count=Math.min(drag.count,view.raw.length-view.base);
 const window=zoomWindow(view.raw,view.base,count,anchor-Math.round(delta/drag.step),0);
 chartPending=null;chartHover=null;
 plot.classList.add('is-panning');
 if(view.first!==window.start||view.bars.length!==count){
  chartZoom=window.start===view.defaultFirst&&window.stop===view.raw.length?null:
   {key:drag.key,from:window.from,to:window.to};
  chartWheelSize=null;
  clearCursor();drawChart();
 }
 const detail=getDetail(m);
 if(delta>0&&window.start===view.base&&state.k&&!isMinute()&&!isFuture(m)&&
  !detail.chartWide&&(detail.daily?.months||0)<chartHistoryMonths){
  detail.chartWide=true;loadDetails(m);
 }
}
function endChartPan(event){
 const drag=chartDrag;
 if(!drag||event&&event.pointerId!==drag.pointerId)return;
 chartDrag=null;
 plot.classList.remove('is-panning');
 if(drag.area.hasPointerCapture(drag.pointerId))drag.area.releasePointerCapture(drag.pointerId);
 if(drag.moved)clearCursor();
}
function chartWheel(event){
 if(state.period==='profile'||!event.deltaY||event.ctrlKey||event.metaKey||event.target?.closest?.('[data-el="tradeSides"]'))return;
 event.preventDefault();
 endChartPan();
 const m=selected();
 if(!m)return;
 const d=getDetail(m),q=quoteFor(m),out=event.deltaY>0;
 if(out)chartPending=null;
 if(!chartCursor)return;
 const {raw,first,base,defaultFirst,end,bars,key}=chartCursor;
 const x=Math.max(0,Math.min(end,event.clientX-plot.getBoundingClientRect().left));
 const count=bars.length,total=raw.length-base;
 const minimum=Math.min(total,state.k?chartZoomLimit(end):1);
 const level=chartLevels.indexOf(state.period);
 const near=nearestChartBar(x),left=chartCursor.positions[0],right=chartCursor.positions.at(-1);
 const fraction=Math.max(0,Math.min(1,(x-left)/Math.max(1,right-left)));
 const unit=event.deltaMode===1?16:event.deltaMode===2?plot.clientHeight:1;
 const delta=Math.max(-240,Math.min(240,event.deltaY*unit));
 const previousSize=chartWheelSize?.key===key?chartWheelSize.size:count;
 const size=Math.max(minimum,Math.min(total,(previousSize+3)*Math.exp(delta/760)-3));
 chartWheelSize={key,size};
 const next=Math.round(size);
 if(!out&&level>0&&count<=minimum&&size===minimum){
  transitionChart(m,d,q,chartLevels[level-1],chartCursor,bars[near],fraction,x,true);
  return;
 }
 if(!out&&state.period==='day'&&next<=minimum*2&&!d.minuteHistory)loadMinuteHistory(m,d);
 if(out&&isMinute()&&count>=Math.min(total,Math.max(72,Math.floor(end/6)))){
  transitionChart(m,d,q,chartLevels[level+1],chartCursor,bars[near],fraction,x,false);
  return;
 }
 const extendHistory=out&&state.k&&!isMinute()&&!isFuture(m)&&!d.chartWide&&(d.daily?.months||0)<chartHistoryMonths&&
  (next>=total*.85||count>=raw.length-defaultFirst);
 if(next===count&&!extendHistory)return;
 if(next!==count){
  const window=zoomWindow(raw,base,next,first+near,fraction);
  chartZoom=window.start===defaultFirst&&window.stop===raw.length?null:{key,from:window.from,to:window.to};
 }
 if(extendHistory){d.chartWide=true;loadDetails(m);}
 chartHover=x;drawChart();
}
for(const area of [el('quotePanel'),el('indicatorPanel')])area.addEventListener('wheel',chartWheel,{passive:false});
for(const area of [plot,el('indicatorPanel')]){
 area.addEventListener('pointerdown',startChartPan);
 area.addEventListener('pointermove',event=>chartDrag?moveChartPan(event):moveCursor(event));
 area.addEventListener('pointerleave',()=>{if(!chartDrag)clearCursor();});
 area.addEventListener('pointerup',endChartPan);
 area.addEventListener('pointercancel',endChartPan);
 area.addEventListener('lostpointercapture',endChartPan);
}
for(const key of ['movingAverage','showKD','showMACD','showRSI'])el(key).addEventListener('change',drawChart);
el('watchSort').value=state.watchSort;
el('watchSort').addEventListener('change',e=>{
 if(!watchSorts.includes(e.target.value))return;
 watchDrag=null;state.watchSort=e.target.value;persist();drawWatch();
});
el('priceProfile').addEventListener('wheel',e=>{
 if(e.ctrlKey||e.metaKey||!e.deltaY||!e.target.closest('[data-el="profileBoard"]'))return;
 const m=selected();
 if(!m)return;
 e.preventDefault();
 const d=getDetail(m),now=Date.now();
 if(now-(d.profileWheelAt||0)<135)return;
 d.profileWheelAt=now;
 zoomPriceProfile(m,d,e.deltaY<0?1:-1);
},{passive:false});
function minuteBars(q,target){
 const source=q?.barMinutes;
 if(!source||source>target||target%source!==0)return [];
 return aggregateBars((q.bars||[]).filter(b=>b.complete),target+'m');
}
function minuteSeries(q,d,target){
 const recent=minuteBars(q,target);
 const history=target>=30?minuteBars(d.minuteHistory,target):[];
 const last=history.at(-1)?.t;
 const raw=history.length?[...history,...recent.filter(b=>b.t>last)]:recent;
 return {raw,source:history.length?d.minuteHistory.source+' · '+target+' 分 K':
  raw.length?(q.chartSource||q.source)+' · '+target+' 分 K':'分 K'};
}
function chartData(m,q,d){
 const intraday=state.period==='line'||isMinute();
 if(intraday&&isFuture(m))q=futureChartQuote(q,d);
 if(state.period==='line'){
  const series=intradayPlot(m,q);
  return {raw:series.bars,source:series.label||'盤中走勢',quote:q};
 }
 if(isMinute()){
  const target=minutePeriods[state.period],series=minuteSeries(q,d,target);
  return {...series,quote:q,empty:d.minuteLoading?'正在載入歷史分 K…':'行情來源未提供可用的 '+target+' 分鐘 OHLC。'};
 }
 return {raw:aggregateBars(d.daily?.bars||[],state.period),source:d.daily?.source||'日行情',
  empty:d.dailyError||'正在讀取交易所歷史行情…'};
}
function drawQuoteDetails(m,q,d){
 const df=digit(m), volumeUnit=q?.source==='證交所 MIS'||q?.volumeUnit==='張'?'張':isFuture(m)?'口':'股';
 const cells=[[m.exchange==='esb'?'昨參考':'昨收',q?.prev],['開盤',q?.open],['最高',q?.high],['最低',q?.low]];
 if(m.id==='TAIEX'){
  const report=Number.isFinite(q?.ts)&&d.marketReports?.find(r=>r.date===twDate(q.ts))?.close;
  cells.push(['上市成交金額（億元）',report?.totalValue/1e8,0]);
 }else cells.push(['成交量（'+volumeUnit+'）',q?.volume,0]);
 el('quoteStats').innerHTML=cells.map(([name,value,n])=>'<div><small class="sub">'+name+'</small><b class="num">'+fmt(value,n??df)+'</b></div>').join('');
 el('chartRange').hidden=!state.k||isMinute();
 el('movingAverageControl').hidden=!state.k;
 const book=el('orderBook');
 if(m.id==='TAIEX'||marketMode(m)!=='stock'){book.innerHTML='';return;}
 if(!q?.bids?.some(r=>valid(r.price))&&!q?.asks?.some(r=>valid(r.price))){
  book.innerHTML='<strong>五檔委買／委賣</strong>'+review('來源未提供五檔資料，暫無評語。');return;
 }
 const sizes=rows=>(rows||[]).filter(r=>valid(r.price)&&Number.isFinite(r.size)&&r.size>=0).map(r=>r.size);
 const bids=sizes(q.bids),asks=sizes(q.asks),sum=xs=>xs.reduce((a,b)=>a+b,0);
 const buy=sum(bids),sell=sum(asks),imbalance=buy+sell>0?(buy-sell)/(buy+sell):0;
 const assessment=bids.length!==5||asks.length!==5?review('五檔資料不完整，暫無評語。'):
  review((fresh(q)?'':'上筆快照 · ')+(imbalance>=.2?'委買掛量偏多':imbalance<=-.2?'委賣掛量偏多':'委買與委賣掛量差距不大')+'，反映掛單快照。',toneFor(Math.abs(imbalance)>=.2?imbalance:0));
 book.innerHTML='<strong>五檔委買／委賣</strong>'+assessment+'<table class="book num"><caption>證交所 MIS</caption><thead><tr><th>買量</th><th>買價</th><th>賣價</th><th>賣量</th></tr></thead><tbody>'+
 Array.from({length:5},(_,i)=>'<tr><td>'+fmt(q.bids?.[i]?.size,0)+'</td><td>'+fmt(q.bids?.[i]?.price,df)+'</td><td>'+fmt(q.asks?.[i]?.price,df)+'</td><td>'+fmt(q.asks?.[i]?.size,0)+'</td></tr>').join('')+'</tbody></table>';
}
const tradeSideThreshold=55;
function tradeSideReview(m,q,data){
 const direction=data.outsidePct>=tradeSideThreshold?1:data.insidePct>=tradeSideThreshold?-1:0;
 if(!direction)return review('內外盤接近，買賣雙方的主動成交量差距不大。');
 const lead=direction>0?'主動買進成交較多':'主動賣出成交較多';
 const aligned=!q?.error&&Number.isFinite(q?.ts)&&Math.abs(q.ts-data.ts)<=2*60000&&twDate(q.ts)===twDate(data.ts);
 const delta=aligned?pct(q):NaN;
 if(!Number.isFinite(delta))return review(lead+'。',toneFor(direction));
 const baseline=m.exchange==='esb'?'前一日參考價':'昨收';
 if(Math.abs(delta)<.3)return review(lead+'，股價仍接近'+baseline+'。');
 const price='股價'+(delta>0?'高於':'低於')+baseline;
 return Math.sign(delta)===direction?review(lead+'，'+price+'。',toneFor(direction)):
  review(lead+'，但'+price+'，兩者方向分歧。');
}
function drawTradeSides(m,q,d){
 const box=el('tradeSides');
 box.hidden=state.period!=='line'||!hasTradeSides(m)||m.exchange==='esb';
 if(box.hidden)return;
 const guideOpen=box.querySelector('[data-trade-guide]')?.open;
 const data=(q?.sides?.ts||0)>=(d.tradeSides?.ts||0)?q?.sides:d.tradeSides;
 const usable=data&&(!Number.isFinite(q?.ts)||twDate(data.ts)===twDate(q.ts)&&q.ts-data.ts<=15*60000);
 const heading='<h3>內外盤成交</h3>';
 if(!usable){
  box.innerHTML=heading+'<p class="sub">'+(d.tradeSidesLoading?'讀取成交分類…':
   data?'內外盤資料時間與報價相差較久，等待更新。':'目前沒有可用的內外盤資料。')+'</p>';
  return;
 }
 const value=n=>fmt(n,Number.isInteger(n)?0:3);
 box.innerHTML=heading+tradeSideReview(m,q,data)+'<dl class="trade-pair num"><div class="down"><dt>內盤</dt><dd>'+fmt(data.insidePct,2)+'%</dd><dd>'+value(data.inside)+' 張</dd></div>'+
  '<div class="up"><dt>外盤</dt><dd>'+fmt(data.outsidePct,2)+'%</dd><dd>'+value(data.outside)+' 張</dd></div></dl>'+
  '<div class="trade-split" aria-hidden="true"><span style="width:'+data.insidePct+'%"></span><span style="width:'+data.outsidePct+'%"></span></div>'+
  '<p class="sub">'+esc(data.source)+' · '+twDate(data.ts)+' '+twTime(data.ts).slice(0,5)+'</p>'+
  '<details class="trade-guide sub" data-trade-guide'+(guideOpen?' open':'')+'><summary>怎麼看內外盤？</summary>'+
  '<p>外盤是買方主動成交，內盤是賣方主動成交。本工具以任一側達 '+tradeSideThreshold+'% 判為該側較多。</p></details>';
}
function drawIndicators(w,end,positions,data,width){
 const panel=el('indicatorPanel');
 const sections=[
  {key:'showKD',title:'KD（9,3,3）',lines:[['K','k','#ff9775'],['D','d','#82baf5']],domain:[0,100],levels:[20,50,80]},
  {key:'showMACD',title:'MACD（12,26,9）',lines:[['DIF','macd','#ffc864'],['訊號','signal','#78b4fa']],hist:true,levels:[0]},
  {key:'showRSI',title:'RSI（14）',lines:[['RSI','rsi','#c49bf9']],domain:[0,100],levels:[30,50,70]}
 ];
 panel.innerHTML=sections.filter(s=>el(s.key).checked).map(s=>{
  const values=data.flatMap(x=>s.lines.map(([,k])=>x[k]).concat(s.hist?[x.hist]:[])).filter(Number.isFinite);
  if(!values.length)return '<div class="indicator"><strong>'+s.title+'</strong>'+review('資料不足，暫無評語。')+'</div>';
  const limit=Math.max(.001,...values.map(Math.abs))*1.12,[lo,hi]=s.domain||[-limit,limit],y=v=>5+(hi-v)/(hi-lo)*51;
  const grid=s.levels.map(v=>'<path d="M0 '+y(v)+'H'+end+'" stroke="var(--line)" stroke-dasharray="3 3"/><text x="'+(end+4)+'" y="'+(y(v)+3)+'" fill="var(--quiet)">'+v+'</text>').join('');
  const lines=s.lines.map(([,k,color])=>'<polyline points="'+data.flatMap((x,i)=>Number.isFinite(x[k])?[positions[i]+','+y(x[k])]:[]).join(' ')+'" stroke="'+color+'" stroke-width="1.35" fill="none"/>').join('');
  const hist=s.hist?data.map((x,i)=>Number.isFinite(x.hist)?'<rect x="'+(positions[i]-width/2)+'" y="'+Math.min(y(0),y(x.hist))+'" height="'+Math.max(1,Math.abs(y(0)-y(x.hist)))+'" width="'+width+'" fill="var(--candle-'+(x.hist>=0?'up':'down')+')" opacity=".85"/>':'').join(''):'';
  const legend=s.lines.map(([name,k,color])=>'<span style="color:'+color+'">'+name+' '+fmt(data.at(-1)?.[k],2)+'</span>').join(' ');
  return '<div class="indicator"><div class="row wrap"><strong>'+s.title+'</strong>'+legend+'</div>'+indicatorReview(s.key,data.at(-1))+'<svg role="img" aria-label="'+s.title+'" viewBox="0 0 '+w+' 62">'+grid+hist+lines+'<line data-crosshair="" x1="0" x2="0" y2="62" stroke="#9b9ba4" visibility="hidden"/></svg></div>';
 }).join('');
}
function indicatorReview(key,data){
 if(key==='showKD'&&Number.isFinite(data?.k)&&Number.isFinite(data?.d)){
  const gap=data.k-data.d;
  return review(data.k>=80?'KD 位於高檔，留意強勢後波動。':data.k<=20?'KD 位於低檔，留意賣壓是否緩和。':
   Math.abs(gap)<2?'K、D 線接近，短線方向未明。':gap>0?'K 值高於 D 值，短線動能偏強。':'K 值低於 D 值，短線動能偏弱。',
   data.k>=80? 'up':data.k<=20?'down':toneFor(Math.abs(gap)<2?0:gap));
 }
 if(key==='showMACD'&&Number.isFinite(data?.hist))return review(data.hist>0?'MACD 柱為正，短線動能偏強。':
  data.hist<0?'MACD 柱為負，短線動能偏弱。':'MACD 柱接近零，動能方向不明。',toneFor(data.hist));
 if(key==='showRSI'&&Number.isFinite(data?.rsi))return review(data.rsi>=70?'RSI 高於或等於 70，走勢偏強且位於高檔。':
  data.rsi<=30?'RSI 低於或等於 30，走勢偏弱且位於低檔。':'RSI 在 30 至 70 之間，未見極端讀數。',
  data.rsi>=70?'up':data.rsi<=30?'down':'neutral');
 return review('資料不足，暫無評語。');
}
function chartReview(m,q,d,raw){
 if(!state.k||isMinute()){
  if(!q)return review('走勢資料尚未取得。');
  const s=watchSituation(m,q,d.daily?.bars),delta=pct(q);
  return review(s.text,toneFor(s.attention?-1:Math.abs(delta)>=.1?delta:0));
 }
 const last=raw.at(-1),prev=raw.at(-2),label=chartPeriods[state.period];
 if(!last||!prev)return review(label+'資料不足，暫無評語。');
 const delta=(last.c/prev.c-1)*100;
 const direction=Math.abs(delta)<.1?0:delta,mean20=raw.length>=20?mean(raw.slice(-20).map(b=>b.c)):NaN;
 const ma=valid(mean20)?last.c>mean20?'，位於 20 期均線上方':last.c<mean20?'，位於 20 期均線下方':'，貼近 20 期均線':'';
 const volume=state.period==='day'?researchVolume(null,raw,NaN,Date.now()):null;
 const volumeNote=volume?.at===last.t&&volume.ratio>=1.5?'，成交量為前 20 日均量 '+fmt(volume.ratio,1)+' 倍':'';
 return review(twDate(last.end||last.t)+' · '+label+(direction>0?'走強 '+signed(delta):direction<0?'走弱 '+signed(delta):'近乎持平')+ma+volumeNote+'。',toneFor(direction));
}
function drawChart(){
 const m=selected();
 if(!m)return;
 const d=getDetail(m),q=quoteFor(m);
 const profileMode=state.period==='profile';
 el('priceProfile').hidden=!profileMode;
 el('quotePanel').hidden=profileMode;
 if(chartDrag&&chartDrag.key!==chartKey(m))endChartPan();
 if(profileMode){chartCursor=null;drawPriceProfile(m,q,d);return;}
 drawTradeSides(m,q,d);
 const w=Math.round(plot.clientWidth),h=plot.clientHeight;
 if(!w||!h)return;
 const series=chartData(m,q,d),raw=series.raw,chartQuote=Object.hasOwn(series,'quote')?series.quote:q;
 const label=el('ticks');
 plot.setAttribute('viewBox','0 0 '+w+' '+h);
 el('chartReview').innerHTML=isFuture(m)&&(!state.k||isMinute())&&d.futureChartSession?
  review((d.futureChartSession==='night'?'夜盤':'日盤')+(raw.length?' · '+modeStamp(raw.at(-1).t):' · 目前沒有可顯示的分時資料。')):
  chartReview(m,q,d,raw);
 if(!raw.length){
  chartCursor=null;showChartDetail(null,0);
  chartRangePressed(state.months);
  el('maLegend').textContent='';el('indicatorPanel').innerHTML='';el('chartSource').textContent=series.source;
  el('chartReset').hidden=state.period===chartPreferredPeriod;
  plot.innerHTML='<text x="8" y="32" font-size="12" fill="var(--quiet)">'+esc(series.empty||(q?'來源未提供分時明細':'等待行情…'))+'</text>';label.textContent='';return;
 }
 const history=state.k&&!isMinute(),key=chartKey(m),latest=raw.at(-1).end||raw.at(-1).t;
 const startOf=months=>{
  const cutoff=rangeStart(latest,months);
  return Math.max(0,raw.findIndex(b=>(b.end||b.t)>=cutoff));
 };
 const base=history?startOf(12):0,defaultFirst=history?startOf(state.months):
  minutePeriods[state.period]>=30?Math.max(0,raw.length-64):0;
 if(chartZoom?.key!==key)chartZoom=null;
 if(chartWheelSize?.key!==key)chartWheelSize=null;
 let first=defaultFirst,last=raw.length;
 if(chartZoom){
  const left=raw.findIndex(b=>b.t>=chartZoom.from),right=raw.findIndex(b=>b.t>chartZoom.to);
  const stop=right<0?raw.length:right;
  if(left>=0&&Math.max(base,left)<stop){first=Math.max(base,left);last=stop;}else{chartZoom=null;chartWheelSize=null;}
 }
 el('chartReset').hidden=!chartZoom&&state.period===chartPreferredPeriod;
 const bars=raw.slice(first,last), computed=state.k?indicators(raw).slice(first,last):[];
 const visibleEnd=bars.at(-1).end||bars.at(-1).t;
 const scale=history&&chartZoom?(chartRanges.find(n=>rangeStart(visibleEnd,n)<=bars[0].t)||12):state.months;
 chartRangePressed(scale);
 const prior=bars.map((b,i)=>state.k?(raw[first+i-1]?.c??(isMinute()?chartQuote?.prev:NaN)):chartQuote?.prev);
 const end=Math.max(18,w-70),top=10,bottom=h-78,edge=state.k?Math.min(24,end/4):6,span=Math.max(1,end-edge*2),vBottom=h-23;
 const mas=state.k&&el('movingAverage').checked?maPeriods.map((_,k)=>computed.map(x=>x.ma[k])):[];
 const ref=!state.k&&valid(chartQuote?.prev)?[chartQuote.prev]:[];
 const extras=mas.flat().filter(valid).concat(ref),hi=Math.max(...bars.map(b=>state.k?b.h:b.c),...extras),lo=Math.min(...bars.map(b=>state.k?b.l:b.c),...extras),pad=Math.max((hi-lo)*.075,hi*.0003,.01);
 const y=v=>top+(hi+pad-v)/(hi-lo+2*pad)*(bottom-top);
 const t0=bars[0].t,duration=bars.at(-1).t-t0;
 const spacing=Math.min(48,span/Math.max(1,bars.length-1)),offset=(end-spacing*(bars.length-1))/2;
 const x=i=>state.k?offset+i*spacing:edge+(bars.length===1?span/2:duration>0?(bars[i].t-t0)/duration*span:i*span/(bars.length-1));
 const positions=bars.map((_,i)=>x(i));
 const multiday=isMinute()&&twDate(t0)!==twDate(visibleEnd);
 chartCursor={bars,positions,previous:prior,computed,y,end,height:h,raw,first,base,defaultFirst,key,multiday};
 showChartDetail(bars.at(-1),bars.length-1);
 if(!state.k)el('maLegend').textContent='';
 const timeLabel=t=>history?twDate(t):(multiday?twDate(t)+' ':'')+twTime(t).slice(0,5);
 const from=timeLabel(t0),to=timeLabel(visibleEnd);
 el('chartSource').textContent=series.source+' · '+from+'～'+to+' · '+bars.length+' 筆'+
  (history&&chartZoom?' · 尺度 '+chartRangeNames[scale]:'')+
  (history&&d.chartWide&&d.dailyLoading?' · 載入更早的日行情…':'')+
  (d.minuteLoading&&(minutePeriods[state.period]>=30||state.period==='day')?' · 載入歷史分 K…':'')+
  (isFuture(m)&&history?' · 僅顯示同契約已取得日行情':'');
 const grid=Array.from({length:5},(_,i)=>{
  const yy=top+i*(bottom-top)/4,val=hi+pad-i*(hi-lo+2*pad)/4;
  return '<path d="M0 '+yy+'H'+end+'" stroke="var(--line)" stroke-dasharray="3 4"/><text x="'+(end+4)+'" y="'+(yy+4)+'" font-size="10" fill="var(--quiet)">'+fmt(val,hi<100?2:0)+'</text>';
 }).join('');
 const reference=ref.length?'<path d="M0 '+y(ref[0])+'H'+end+'" stroke="#cda354" stroke-dasharray="4 4"/>':'';
 const width=Math.max(1,Math.min(30,state.k?spacing*.65:span/bars.length*.69)),vMax=Math.max(1,...bars.map(b=>valid(b.v)?b.v:0));
 const color=(b,i)=>'var(--candle-'+((state.k?b.c>=b.o:b.c>=(bars[i-1]?.c||chartQuote?.prev||b.c))?'up':'down')+')';
 const volume=bars.map((b,i)=>valid(b.v)?'<rect x="'+(x(i)-width/2)+'" y="'+(vBottom-43*b.v/vMax)+'" width="'+width+'" height="'+(43*b.v/vMax)+'" fill="'+color(b,i)+'" opacity=".83"/>':'').join('');
 const volLabel=volume?'<path d="M0 '+(vBottom-44)+'H'+end+'" stroke="var(--line)"/><text x="'+(end+4)+'" y="'+(vBottom-30)+'" fill="var(--quiet)" font-size="10">成交量</text>':'';
 const segments=[];
 bars.forEach((b,i)=>{
  if(!i||b.t-bars[i-1].t>15*60000)segments.push([]);
  segments.at(-1).push(x(i)+','+y(b.c));
 });
 const candles=state.k?bars.map((b,i)=>{
  const c=color(b,i);
  return '<g><path d="M'+x(i)+' '+y(b.h)+'V'+y(b.l)+'" stroke="'+c+'" stroke-width="1.2"/><rect x="'+(x(i)-width/2)+'" y="'+Math.min(y(b.o),y(b.c))+'" width="'+width+'" height="'+Math.max(1,Math.abs(y(b.c)-y(b.o)))+'" fill="'+c+'"/></g>';
 }).join(''):'';
 const lines=mas.map((line,i)=>{
  const points=line.flatMap((v,j)=>valid(v)?[x(j)+','+y(v)]:[]);
  return points.length?'<polyline points="'+points.join(' ')+'" stroke="'+maColors[i]+'" stroke-width="1.25" fill="none"/>':'';
 }).join('');
 const trend=segments.map(points=>'<polyline points="'+points.join(' ')+'" stroke="var(--accent)" stroke-width="1.8" fill="none"/>').join('');
 plot.innerHTML=grid+reference+volLabel+volume+(state.k?candles+lines:trend+'<circle cx="'+x(bars.length-1)+'" cy="'+y(bars.at(-1).c)+'" r="3" fill="var(--accent)"/>')+'<line data-crosshair="" y1="0" y2="'+(h-19)+'" stroke="var(--cursor-line)" visibility="hidden"/><g class="chart-marker" data-chart-marker="" visibility="hidden"></g>';
 const n=Math.min(5,bars.length);
 label.innerHTML=Array.from({length:n},(_,i)=>{
  const index=Math.round(i*(bars.length-1)/Math.max(1,n-1)),t=bars[index].t;
  const text=history||multiday?twDate(t).slice(5).replace('-','/'):twTime(t).slice(0,5);
  return '<span style="left:'+Math.max(16,Math.min(end-16,x(index)))+'px">'+esc(text)+'</span>';
 }).join('');
 if(state.k&&state.tab==='quotes')drawIndicators(w,end,positions,computed,width);else el('indicatorPanel').innerHTML='';
 if(chartHover!==null&&chartHover<=end)showChartCursor(chartHover);
}
function researchEvidence(result,source){
 const [trend,momentum]=result.rows;
 const volume=result.volume;
 const volumeLine=!volume?'量價待補齊同日盤中量比或 21 根有效日 K。':volume.mode==='daily'?
  '收盤量價 '+twDate(volume.at)+' · '+source+' · 量比 '+fmt(volume.ratio)+' 倍 · 收盤漲跌 '+signed(volume.delta):
  '盤中量價 '+twTime(volume.at)+' · 估算量比 '+fmt(volume.ratio)+' 倍 · 漲跌 '+signed(volume.delta);
 const score=row=>row.score===null?'—':row.score+'/5';
 const days=result.days?'日 K 截至 '+twDate(result.dailyAt)+' · '+result.days+' 根':'尚未取得日 K';
 return '<div class="research-evidence"><p class="sub">'+days+'</p>'+
  '<p class="sub"><b>趨勢 '+score(trend)+'</b> · 日 K 收盤 '+fmt(result.close)+' · MA20 '+fmt(result.ma20)+' · MA60 '+fmt(result.ma60)+'</p>'+
  '<p class="sub"><b>動能 '+score(momentum)+'</b> · RSI14 '+fmt(result.rsi,1)+' · MACD 柱 '+fmt(result.macdHist,4)+'</p>'+
  '<p class="sub">'+esc(volumeLine)+'</p>'+
  (trend.score===null||momentum.score===null?'<p class="sub">至少需 60 根日 K 才能完成兩項評估。</p>':'')+
  '</div>';
}
function signalView(result,d){
 const daily=d.daily?.bars||[],f=d.fund,positive=[],negative=[];
 const add=(direction,up,down)=>{
  if(direction>0)positive.push(up);
  if(direction<0)negative.push(down);
 };
 if(valid(result.close)&&valid(result.ma20))add(result.close-result.ma20,'收盤高於月線','收盤低於月線');
 const closes=daily.slice(-4).map(b=>b.c);
 if(closes.length===4){
  const moves=closes.slice(1).map((c,i)=>c-closes[i]);
  add(moves.every(v=>v>0)?1:moves.every(v=>v<0)?-1:0,'連 3 日收盤上漲','連 3 日收盤下跌');
 }
 if(Number.isFinite(result.rsi))add(result.rsi>=55&&result.macdHist>0?1:result.rsi<=45&&result.macdHist<0?-1:0,
  'RSI、MACD 動能偏強','RSI、MACD 動能偏弱');
 if(result.volume?.ratio>=1.5){
  const label=result.volume.mode==='intraday'?'盤中估量放大':'收盤量能放大';
  add(result.volume.delta,label+'上漲',label+'下跌');
 }
 if(Number.isFinite(f?.yoy))add(f.yoy>=10?1:f.yoy<=-10?-1:0,'月營收年增 ≥10%','月營收年減 ≥10%');
 const flow=d.flow?.rows||[],last=flow.findLastIndex(r=>r.values);
 const recent=last>=2?flow.slice(last-2,last+1):[];
 if(recent.length===3){
  const nets=recent.map(r=>r.values?.total);
  add(nets.every(n=>n>0)?1:nets.every(n=>n<0)?-1:0,
   '三大法人連 3 日買超','三大法人連 3 日賣超');
 }
 const list=(label,items,tone)=>'<div class="signal-list '+tone+'"><b>'+label+'</b>'+
  (items.length?'<ul>'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p class="sub">目前無命中條件</p>')+'</div>';
 return '<aside class="radar-signals" aria-label="多空觀察">'+list('偏多條件',positive,'up')+list('偏空條件',negative,'down')+
  (last>=0?'<p class="sub">法人截至 '+esc(flow[last].date)+'</p>':'')+'</aside>';
}
function researchView(m,q,d,stats,showNotes){
 const f=d.fund||{}, daily=d.daily?.bars||[];
 const result=assessment(q,daily,f,fresh(q)&&!q?.error?stats.ratio:NaN);
 const metric=result.rows[d.radarMetric];
 const metricNote=metric?'<b>'+esc(metric.name)+' '+(metric.score===null?'資料不足':metric.score+'／5')+'</b> · '+esc(radarMeaning[metric.name]):
  '點選名稱或分數看解釋。評分為 1–5 分，「—」表示資料不足。';
 const priced=Number.isFinite(f.pe)||Number.isFinite(f.pb)||Number.isFinite(f.yield);
 const money=Number.isFinite(f.revenue)?fmt(f.revenue/100000,2)+' 億元':'—';
 const change=n=>Number.isFinite(n)?'<strong class="research-'+(n>0?'positive':n<0?'risk':'neutral')+'">'+signed(n)+'</strong>':'—';
 return '<div class="row between wrap insight-head"><strong>行情研究</strong><strong class="technical-mood '+result.moodTone+'">'+esc(result.mood)+'</strong></div>'+
  '<div class="research-body" tabindex="0" role="region" aria-label="雷達、基本面與持倉試算">'+
  outlookView(m,q,d)+'<h3 class="radar-title">研究雷達</h3><div class="radar-layout"><div class="radar-board">'+radar(result.rows,d.radarMetric)+'<p class="sub radar-description" aria-live="polite">'+metricNote+'</p></div>'+signalView(result,d)+'</div>'+
  '<details class="research-data-fold" data-research-detail="numbers"><summary>查看技術與基本面數據</summary>'+researchEvidence(result,d.daily?.source||'交易所日行情')+(d.dailyError?'<p class="sub">日 K 更新未完成。'+(daily.length?'目前顯示上次取得的資料。':'請稍後再試。')+'</p>':'')+
  '<details class="radar-notes" data-el="radarNotes"'+(showNotes?' open':'')+'><summary>查看評分依據</summary><ul>'+result.rows.map(x=>'<li><strong>'+esc(x.name)+'</strong> · '+esc(x.detail)+'</li>').join('')+'</ul></details>'+
  '<div class="insight-row"><b>公司基本面</b>'+(!f.unsupported&&d.fund?revenueReview(f):'')+
  (f.unsupported?'<p class="sub">此商品沒有適用的公司營收與估值資料。</p>':
   !d.fund?'<p class="sub">正在讀取營收與估值…</p>':
   '<p>月營收 <b>'+money+'</b> · 年增 '+change(f.yoy)+' · 月增 '+change(f.mom)+' <span class="sub">· '+esc(f.month||'資料月份未取得')+'</span></p>'+
   '<p>本益比 <b>'+fmt(f.pe,2)+'</b> · 股價淨值比 <b>'+fmt(f.pb,2)+'</b> · 殖利率 <b>'+(Number.isFinite(f.yield)?fmt(f.yield,2)+'%':'—')+'</b> <span class="sub">· '+esc(priced?(f.valuationDate||'日期未取得'):'估值未取得')+'</span></p>'+
   '<p class="sub">來源：'+esc(f.source||'—')+'</p>')+'</div></details>'+positionView(m,q,state.rules[m.id])+'</div>';
}
function analysisStock(m){
 return isFuture(m)?(m.id+(m.contract==='次月'?'-NEXT':'-NEAR')):isUS(m)?'US-'+symbolFor(m):m.id;
}
function analysisId(at){
 const suffix=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('');
 return new Date(at).toISOString().replace(/[-:.]/g,'')+'_'+suffix;
}
function analysisTimestamp(id){
 return Date.parse(id.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z_[0-9a-f]{16}$/,'$1-$2-$3T$4:$5:$6.$7Z'));
}
function analysisDate(id){
 const at=analysisTimestamp(id);
 return Number.isFinite(at)?twDate(at)+' '+twTime(at):'時間未確認';
}
function addAnalysisIds(d,ids){
 d.aiHistory=[...new Set([...(d.aiHistory||[]),...ids])].sort().reverse();
}
async function loadAnalysisHistory(m,d,cursor=''){
 if(d.aiListBusy)return;
 d.aiListBusy=true;d.aiListError='';render();
 try{
  const data=await json('ai-history/'+analysisStock(m)+(cursor?'/'+cursor:''));
  addAnalysisIds(d,data.ids.filter(id=>Number.isFinite(analysisTimestamp(id))));
  d.aiCursor=data.next;
  if(!d.aiId&&d.aiHistory.length)await openAnalysisRecord(m,d,d.aiHistory[0]);
 }catch{d.aiListError='無法讀取本機分析紀錄。';}
 finally{d.aiListBusy=false;render();}
}
async function openAnalysisRecord(m,d,id){
 if(!d.aiHistory?.includes(id))return;
 d.aiId=id;d.aiRecordError='';render();
 if(d.aiRecords?.has(id))return;
 try{
  const record=await json('ai-record/'+analysisStock(m)+'/'+id);
  (d.aiRecords??=new Map()).set(id,record);
 }catch{if(d.aiId===id)d.aiRecordError='無法開啟這筆紀錄。檔案可能已移動或損毀。';}
 finally{render();}
}
async function saveAnalysisRecord(stock,d,record){
 const writing=d.aiWriting??=new Set();
 if(writing.has(record.id))return;
 writing.add(record.id);render();
 try{
  await bridge('ai-record',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({stock,id:record.id,provider:record.provider,text:record.text})});
  d.aiUnsaved.delete(record.id);
 }catch{d.aiUnsaved.add(record.id);}
 finally{writing.delete(record.id);render();}
}
function researchAIView(q,d){
 const ids=d.aiHistory||[], id=d.aiId, analysis=d.aiRecords?.get(id);
 const options=ids.map(item=>'<option value="'+esc(item)+'"'+(item===id?' selected':'')+'>'+esc(analysisDate(item))+(d.aiUnsaved?.has(item)?' · 未備份':'')+'</option>').join('');
 const status=d.aiListError?'<p class="sub">'+esc(d.aiListError)+' <button data-act="aiHistoryRetry">重讀紀錄</button></p>':
  d.aiListBusy?'<p class="sub">正在讀取本機紀錄…</p>':'';
 return '<div class="row between wrap insight-head"><strong>AI 研究摘要</strong><button class="primary" data-act="ai"'+(valid(q?.price)?'':' disabled')+'>'+(ids.length?'重新分析':'AI 分析')+'</button></div>'+
  (ids.length?'<div class="row wrap ai-history-controls"><label>分析紀錄 <select data-el="aiHistoryPicker">'+options+'</select></label>'+
   (d.aiCursor?'<button data-act="aiHistoryMore"'+(d.aiListBusy?' disabled':'')+'>載入更早紀錄</button>':'')+'</div>':'')+
  '<div class="research-body" tabindex="0" role="region" aria-label="AI 分析內容">'+status+
  (d.aiRecordError?'<p class="sub">'+esc(d.aiRecordError)+' <button data-act="aiRecordRetry">重新開啟</button></p>':
   analysis?'<div class="ai-result"><p class="sub">'+esc(analysis.provider)+' · '+esc(analysisDate(id))+' · 產生當下快照，非逐筆自動更新</p>'+
    (d.aiWriting?.has(id)?'<p class="sub">正在寫入本機備份…</p>':d.aiUnsaved?.has(id)?
     '<p class="sub">這筆尚未寫入本機。請確認程式資料夾有寫入權限。 <button data-act="aiSaveRetry">重新儲存</button></p>':'')+
    aiReport(analysis.text)+'</div>':
   id?'<p class="sub ai-empty">正在開啟分析紀錄…</p>':
   '<div class="ai-empty"><p>AI 會依現有數據與新聞，摘要短線、波段與長線的可能走勢、支持理由和失效條件。</p><p class="sub">成功的 API 分析會自動備份，日後可在這裡切換紀錄。</p></div>')+'</div>';
}
const researchCardMarkup=new WeakMap();
function updateResearchCard(card,content,key){
 const old=researchCardMarkup.get(card);
 if(old?.key===key&&old.content===content)return;
 const opened=old?.key===key?[...card.querySelectorAll('details[open][data-outlook-detail],details[open][data-research-detail]')].map(e=>[e.hasAttribute('data-outlook-detail')?'data-outlook-detail':'data-research-detail',e.getAttribute('data-outlook-detail')||e.getAttribute('data-research-detail')]):[];
 const focus=document.activeElement?.closest?.('details[data-outlook-detail],details[data-research-detail]');
 const focusKey=old?.key===key&&focus&&card.contains(focus)?[focus.hasAttribute('data-outlook-detail')?'data-outlook-detail':'data-research-detail',focus.getAttribute('data-outlook-detail')||focus.getAttribute('data-research-detail')]:null;
 const previous=card.querySelector('.research-body');
 const offset=old?.key===key?previous?.scrollTop||0:0;
 const restoreFocus=old?.key===key&&previous&&document.activeElement===previous;
 card.innerHTML=content;
 for(const [attr,value] of opened)card.querySelector('details['+attr+'="'+value+'"]')?.setAttribute('open','');
 if(focusKey)card.querySelector('details['+focusKey[0]+'="'+focusKey[1]+'"] > summary')?.focus({preventScroll:true});
 researchCardMarkup.set(card,{key,content});
 const body=card.querySelector('.research-body');
 if(body){
  if(restoreFocus)body.focus({preventScroll:true});
  body.scrollTop=offset;
 }
}
const investorGroups=[['foreign','外資','#8bbaff'],['trust','投信','#c6a1ff'],['dealer','自營商','#ffb784']];
const shares=n=>Number.isFinite(n)?(n>0?'+':'')+fmt(n,0):'—';
function institutionalReview(flow){
 const last=flow?.rows.findLast(r=>r.values);
 if(!last)return review('暫無可評估的法人資料。');
 const {total}=last.values;
 const opposing=investorGroups.some(([key])=>Math.sign(last.values[key].net)===-Math.sign(total)&&total!==0);
 return review(last.date+' · '+(total>0?'法人合計買超 ':total<0?'法人合計賣超 ':'法人合計買賣相抵')+
  (total?fmt(Math.abs(total),0)+' 股'+(opposing?'，各類法人方向分歧。':'。'):'，仍可分別查看各類法人。'),toneFor(total));
}
function institutionalView(m,d){
 const heading='<div class="row between wrap insight-head"><strong>法人買賣</strong><button data-act="retryFlow">重新整理</button></div>';
 if(!institutionalSupported(m))return '<strong>法人買賣</strong>'+review('此商品沒有個股三大法人買賣超資料。');
 const flow=d.flow,rows=flow?.rows||[],last=rows.findLast(r=>r.values);
 if(!last)return heading+review('暫無可評估的法人資料。')+'<p class="sub">'+
  (d.flowLoading||d.dailyLoading?'正在讀取官方法人報表…':'尚未取得官方報表，可能尚未發布或連線未完成。')+'</p>';
 const max=Math.max(1,...rows.flatMap(r=>r.values?investorGroups.map(([key])=>Math.abs(r.values[key].net)):[]));
 const band=540/rows.length,bar=Math.min(13,band/4);
 const graph=rows.map((r,i)=>r.values?investorGroups.map(([key,label,color],j)=>{
  const n=r.values[key].net,h=Math.abs(n)*50/max,x=30+band*i+band/2+(j-1.5)*bar;
  return '<rect x="'+x+'" y="'+(n>0?60-h:60)+'" width="'+Math.max(1,bar-2)+'" height="'+h+'" fill="'+color+
   '"><title>'+esc(r.date+' '+label+' '+shares(n)+' 股')+'</title></rect>';
 }).join(''):'').join('');
 const legend=investorGroups.map(([,label,color])=>'<span><i style="background:'+color+'"></i>'+label+'</span>').join('');
 const signedCell=n=>'<td class="'+toneFor(n)+'">'+shares(n)+'</td>';
 const latest=investorGroups.map(([key,label])=>{
  const r=last.values[key];
  return '<tr><th scope="row">'+label+'</th><td>'+fmt(r.buy,0)+'</td><td>'+fmt(r.sell,0)+'</td>'+signedCell(r.net)+'</tr>';
 }).join('')+'<tr><th scope="row">三大法人合計</th><td colspan="2">—</td>'+signedCell(last.values.total)+'</tr>';
 const recent=rows.slice().reverse().map(({date,values})=>'<tr><th scope="row">'+esc(date)+'</th>'+
  (values?investorGroups.map(([key])=>signedCell(values[key].net)).join('')+signedCell(values.total):'<td colspan="4">未取得</td>')+'</tr>').join('');
 return heading+institutionalReview(flow)+'<p class="sub">資料截至 '+esc(last.date)+' · '+esc(flow.source)+' · 單位：股，外資不含外資自營商</p>'+
  (d.flowLoading?'<p class="sub">正在更新資料…</p>':'')+
  '<div class="row wrap data-legend">'+legend+'</div><svg class="graph flow-chart" viewBox="0 0 600 140" role="img" aria-label="三大法人逐日買賣超">'+
  '<path d="M30 60H570" stroke="var(--quiet)"/><text x="13" y="64" fill="var(--quiet)" font-size="12">0</text>'+graph+
  '<text x="30" y="133">'+esc(rows[0].date)+'</text><text x="570" y="133" text-anchor="end">'+esc(rows.at(-1).date)+'</text></svg>'+
  '<div class="data-table"><table class="book num"><caption>最新一日買賣明細</caption><thead><tr><th>法人</th><th>買進</th><th>賣出</th><th>買賣超</th></tr></thead><tbody>'+latest+'</tbody></table>'+
  '<table class="book num"><caption>逐日買賣超</caption><thead><tr><th>日期</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th></tr></thead><tbody>'+recent+'</tbody></table></div>';
}
function revenueReview(row){
 const yoy=row?.yoy,mom=row?.mom;
 if(!Number.isFinite(yoy)&&!Number.isFinite(mom))return review('營收增減資料不足，暫無評語。');
 const change=(v,period)=>!Number.isFinite(v)?'':Math.abs(v)<3?'較'+period+'大致持平':
  '較'+period+(v>0?'成長 ':'下滑 ')+fmt(Math.abs(v),1)+'%';
 const year=change(yoy,'去年同期'),month=change(mom,'上月');
 const tag=yoy>=20?'營收年增強勁':yoy<=-20?'營收年減明顯':year||'營收'+month;
 const text=tag+(year&&tag!==year?' '+signed(yoy):'')+(year&&month?'，'+month:'')+'。';
 return review(text,toneFor(Math.abs(yoy)>=3?yoy:Math.abs(mom)>=3?mom:0));
}
function financialView(d){
 const f=d.fund,history=d.revenueHistory||[];
 if(f?.unsupported)return '<strong>營收</strong>'+review('此商品沒有適用的公司營收資料。');
 const latest=Number.isFinite(f?.revenue)&&f.month?f:null;
 const rows=history.map(row=>row.month===latest?.month?{...row,revenue:latest.revenue,
  yoy:Number.isFinite(latest.yoy)?latest.yoy:row.yoy,mom:Number.isFinite(latest.mom)?latest.mom:row.mom}:row);
 if(latest&&!rows.some(r=>r.month===latest.month))rows.push(latest);
 const published=rows.filter(r=>Number.isFinite(r.revenue));
 const current=published.at(-1);
 const max=Math.max(1,...published.map(r=>r.revenue));
 const rateLimit=Math.max(5,...published.flatMap(r=>[r.yoy,r.mom]).filter(Number.isFinite).map(Math.abs));
 const growth=[['yoy','年增率','#f0c475'],['mom','月增率','#b3a1ff']];
 const bar=540/Math.max(1,rows.length);
 const chart=rows.map((r,i)=>{
  if(!Number.isFinite(r.revenue))return '';
  const x=30+bar*i+bar*.19,h=105*r.revenue/max;
  return '<rect x="'+x+'" y="'+(118-h)+'" width="'+(bar*.62)+'" height="'+h+'" rx="2" fill="var(--accent)"><title>'+
   esc(r.month+' · '+fmt(r.revenue/100000)+' 億元 · 年增 '+signed(r.yoy)+' · 月增 '+signed(r.mom))+'</title></rect>';
 }).join('');
 const rateLines=growth.map(([key,label,color])=>{
  const segments=[];
  rows.forEach((r,i)=>{
   if(!Number.isFinite(r[key]))return;
   if(!Number.isFinite(rows[i-1]?.[key]))segments.push([]);
   segments.at(-1).push((30+bar*(i+.5))+','+(66-46*r[key]/rateLimit));
  });
  return segments.map(points=>'<polyline points="'+points.join(' ')+'" stroke="'+color+'" fill="none" stroke-width="2"/>').join('');
 }).join('');
 const legend='<div class="row wrap data-legend"><span><i style="background:var(--accent)"></i>營收</span>'+
  growth.map(([,name,color])=>'<span><i style="background:'+color+'"></i>'+name+'</span>').join('')+'</div>';
 const table=rows.slice().reverse().map(r=>'<tr><th scope="row">'+esc(r.month)+'</th><td>'+fmt(r.revenue/100000)+'</td>'+
  '<td class="'+toneFor(r.yoy)+'">'+signed(r.yoy)+'</td><td class="'+toneFor(r.mom)+'">'+signed(r.mom)+'</td></tr>').join('');
 return '<div class="insight-head"><strong>近 12 個月營收</strong></div>'+revenueReview(current||f)+
  (current?'<p class="sub">最近一期 '+esc(current.month)+' · '+fmt(current.revenue/100000)+' 億元 · 公開資訊觀測站</p>':'')+
  (d.revenueLoading||d.fundLoading?'<p class="sub">正在讀取月營收資料…</p>':'')+
  (current?legend+'<svg class="graph flow-chart" viewBox="0 0 625 147" role="img" aria-label="月營收與年增率、月增率歷史圖">'+
   '<path d="M30 118H570" stroke="var(--quiet)"/>'+chart+
   '<path d="M30 66H570" stroke="var(--quiet)" stroke-dasharray="4 4"/>'+rateLines+
   '<text x="576" y="25">+'+fmt(rateLimit,0)+'%</text><text x="576" y="70">0%</text><text x="576" y="116">−'+fmt(rateLimit,0)+'%</text>'+
   '<text x="30" y="139">'+esc(rows[0].month)+
   '</text><text x="570" y="139" text-anchor="end">'+esc(rows.at(-1).month)+'</text></svg>'+
   '<div class="data-table"><table class="book num"><caption>月營收明細（億元）</caption><thead><tr><th>月份</th><th>營收</th><th>年增率</th><th>月增率</th></tr></thead><tbody>'+table+'</tbody></table></div>':
   '<p class="sub">目前沒有可顯示的月營收。</p>');
}
function drawInsights(m,q,d){
 const mode=marketMode(m),tabs=marketTabs(m);
 if(!Object.hasOwn(tabs,state.tab))state.tab='research';
 const panel=el('insights'), details=state.tab==='quotes';
 panel.hidden=details;
 el('quoteDetails').hidden=!details;
 for(const tab of ['quotes','news','research','chips','financial','positions']){
  const button=root.querySelector('[data-act="'+tab+'"]');
  button.hidden=!Object.hasOwn(tabs,tab);
  if(!button.hidden)button.textContent=tabs[tab];
  pressed(tab,state.tab===tab);
 }
 if(state.tab==='positions'){
  panel.dataset.view='positions';panel.innerHTML=futurePositionsView(m,q,d);return;
 }
 if(details){drawExtraDetails(m,q,d);return;}
 if(state.tab==='chips'||state.tab==='financial'){
  panel.dataset.view=state.tab;
  panel.innerHTML=state.tab==='chips'?institutionalView(m,d):financialView(isFuture(m)?{fund:{unsupported:true}}:d);
  return;
 }
 if(state.tab==='news'){
  panel.dataset.view='news';
  panel.innerHTML='<div class="row between insight-head"><strong>相關新聞</strong><span class="example">來源與發布時間</span></div>'+
   (d.news?.length?d.news.map(item=>'<div class="insight-row"><a href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">'+esc(item.title)+'</a><p class="sub">'+esc(item.source)+(Number.isFinite(item.pub)?' · '+twDate(item.pub)+' '+twTime(item.pub).slice(0,5):'')+'</p></div>').join(''):'<p class="sub">'+esc(d.newsError||(d.news?'目前沒有相符的新聞。':'正在讀取新聞…'))+'</p>');
  return;
 }
 if(panel.dataset.view!=='research'){
  panel.innerHTML='<div class="research-columns"><section class="research-card research-market" data-el="researchMarket" aria-label="市場分析"></section><section class="research-card research-ai" data-el="researchAI" aria-label="AI 研究摘要"></section></div>';
  panel.dataset.view='research';
 }
 const market=el('researchMarket'), stock=analysisStock(m);
 const showNotes=researchCardMarkup.get(market)?.key===stock&&!!el('radarNotes')?.open;
 updateResearchCard(market,isFuture(m)?futureAnalysisView(m,q,d):mode==='stock'?(m.id==='TAIEX'||isTaiwanETF(m)?taiwanMarketResearch(m,q,d):researchView(m,q,d,metrics(m,q,d.daily?.bars),showNotes)):equityModeResearch(m,q,d),stock);
 updateResearchCard(el('researchAI'),researchAIView(q,d),stock+'/'+(d.aiId||''));
}
function drawExtraDetails(m,q,d){
 if(isUS(m)||m.exchange==='esb'){el('extraDetails').innerHTML=equityModeResearch(m,q,d,true);return;}
 const stats=metrics(m,q,d.daily?.bars), rule=state.rules[m.id]||{};
 const risk=conditions(m,q,d.daily?.bars).map(h=>h[1]).join('、')||'目前無觸發';
 const future=isFuture(m)?futureContext(m,q,d):null;
 const signals=indicators(d.daily?.bars||[]).at(-1)||{};
 const rows=[
  ['行情來源',securityInfo(q)],
  ['開盤區間／量比',stats.bandReady?fmt(stats.openLow,digit(m))+'～'+fmt(stats.openHigh,digit(m))+'／'+fmt(stats.ratio,1):'—'],
  ['5 日／月線／季線',[stats.ma5,stats.ma20,stats.ma60].map(x=>fmt(x,digit(m))).join('／')],
  ['RSI 14（日 K）',fmt(signals.rsi,1)],
  ['MACD／訊號線（日 K）',[signals.macd,signals.signal].map(x=>fmt(x)).join('／')],
  ['警報狀態',alertSession(m,q)?risk:'等待新行情']
 ];
 if(isFuture(m))rows.push([hasTaiexBasis(m)?'期現貨價差／契約':'契約',
  (hasTaiexBasis(m)?(future.basis?future.basis.label+' '+fmt(future.basis.points,digit(m)):'—')+'／':'')+(future.month||m.contract)],['未平倉量（期交所日行情）',fmt(d.daily?.bars?.at(-1)?.oi,0)]);
 const position=positionPlan(m,q,rule);
 if(position?.currentPnl!==null&&position?.currentPnl!==undefined)rows.push(['持有成本／股數',fmt(position.cost)+'／'+fmt(position.shares,0)],
  ['估計未扣費用損益',(isUS(m)?'US$ ':'')+fmt(position.currentPnl,isUS(m)?2:0)]);
 el('extraDetails').innerHTML=rows.map(([k,v])=>'<div class="insight-row"><b>'+esc(k)+'</b><p class="sub num">'+esc(v)+'</p></div>').join('');
}
function render(){
 if(exited)return;
 const m=selected();
 drawWatch();drawFeed();
 el('detail').hidden=!m;el('empty').hidden=!!m;
 if(m){
  const q=quoteFor(m), d=getDetail(m), delta=pct(q);
  el('name').innerHTML=esc(m.name)+' <small class="instrument-code">'+esc(isUS(m)?symbolFor(m):m.id)+'</small>';
  marketModeHeader(m,q,d);
  el('market').textContent=m.market+(m.contract?' · '+m.contract:'');
  el('price').textContent=(isUS(m)?'US$ ':'')+fmt(q?.price,digit(m));
  el('change').textContent=signed(delta);el('change').className=(delta<0?'down':delta>0?'up':'')+' num';
  el('quoteTime').textContent=q&&Number.isFinite(q.ts)?[isUS(m)||m.exchange==='esb'?twDate(q.ts)+' '+twTime(q.ts)+' 台北':twTime(q.ts),q.sessionLabel,
   (q.sessionLabel||m.exchange==='esb')&&!fresh(q)?'非最新報價':''].filter(Boolean).join(' · '):'';
  el('summary').textContent=state.k&&!isMinute()?(d.daily?.source||'歷史 K 線來源：交易所'):securityInfo(q);
  drawInsights(m,q,d);drawQuoteDetails(m,q,d);drawChart();
  for(const button of root.querySelectorAll('[data-act="period"]'))button.setAttribute('aria-pressed',String(button.dataset.id===state.period));
  el('indicatorControls').hidden=!state.k;
 }
 el('status').classList.toggle('paused',!state.run);
 el('statusText').textContent=state.busy?'更新中':state.run?'監控中':'已暫停';
 el('poll').textContent=state.seconds?'每 '+intervalLabel(state.seconds):intervalLabel(0);
 el('last').textContent=(state.last?'上次成功 '+twTime(state.last):'尚無成功更新')+(state.run&&state.next?'　下次 '+twTime(state.next):'');
 root.querySelector('[data-act=toggle]').textContent=state.run?'暫停監控':'開始監控';
 pressed('all',!state.alerts);pressed('alerts',state.alerts);
}
const detailMonths=d=>Math.max(d.chartWide?chartHistoryMonths:5,state.k&&!isMinute()?state.months+1:5);
const detailSession=(m,now)=>isFuture(m)?twDate(now)+(twTime(now)>='14:00:00'?'|after-close':'|before-close'):dailyDataSession(now);
function dailyNeedsRefresh(m,d,months,now=Date.now()){
 if(d.dailyLoading)return false;
 if(!d.dailyAttemptAt)return true;
 const needMore=!isFuture(m)&&(!d.daily||d.daily.months<months)&&months>d.dailyAttemptMonths;
 const sessionChanged=d.dailyAttemptSession!==detailSession(m,now);
 return needMore||sessionChanged||now-d.dailyAttemptAt>=30*60000;
}
function loadMinuteHistory(m,d){
 if(isFuture(m))return;
 if(d.minuteLoading)return d.minuteLoading;
 if(!minuteHistoryDue(d))return;
 d.minuteAttemptAt=Date.now();
 d.minuteLoading=intradayHistory(m).then(value=>{
  d.minuteHistory=value;d.minuteError='';
 }).catch(e=>{d.minuteError=message(e);}).finally(()=>{
  d.minuteLoading=null;
  if(selected()===m&&state.details.get(m.id)===d)drawChart();
 });
 return d.minuteLoading;
}
async function loadTradeSides(m,d){
 if(!hasTradeSides(m)||d.tradeSidesLoading||Date.now()-d.tradeSidesAttemptAt<60000)return;
 d.tradeSidesAttemptAt=Date.now();d.tradeSidesLoading=true;
 try{d.tradeSides=await tradeSidesFor(m);}
 catch{d.tradeSides=null;}
 finally{
  d.tradeSidesLoading=false;
  if(selected()===m&&state.details.get(m.id)===d&&state.period==='line')drawTradeSides(m,quoteFor(m),d);
 }
}
async function loadInstitutional(m,d,limit,force=false){
 if(!institutionalSupported(m)||d.flowLoading)return;
 const now=Date.now(),dates=institutionalDates(d.daily?.bars,Math.max(limit,d.flow?.rows.length||0),now);
 const key=dates.join('|');
 if(!dates.length||!force&&d.flowKey===key&&now-d.flowAt<15*60000)return;
 d.flowLoading=true;d.flowKey=key;d.flowAt=now;
 render();
 try{
  const next=await institutionalFor(m,dates),previous=new Map(d.flow?.rows.map(r=>[r.date,r.values]));
  d.flow={...next,rows:next.rows.map(r=>({...r,values:r.values||previous.get(r.date)||null}))};
 }finally{
  d.flowLoading=false;render();
  if(limit<10&&selected()===m&&state.tab==='chips')loadInstitutional(m,d,10);
 }
}
async function loadRevenueHistory(m,d){
 if(!d.fund||d.fund.unsupported||d.revenueLoading)return;
 const months=revenueMonths(d.fund.month),key=months.at(-1),now=Date.now();
 if(d.revenueKey===key&&now-d.revenueAt<60*60000)return;
 d.revenueKey=key;d.revenueAt=now;d.revenueLoading=true;render();
 try{d.revenueHistory=await revenueHistoryFor(m,months);}
 finally{d.revenueLoading=false;render();}
}
async function loadDetails(m){
 const d=getDetail(m);
 if(state.period==='line'&&m.exchange!=='esb')loadTradeSides(m,d);
 if(state.period==='profile')loadProfile(m,d);
 if(isFuture(m)&&['research','positions'].includes(state.tab))loadFuturePositions();
 if(isFuture(m)&&(state.tab==='research'||state.tab==='quotes'))loadFutureAnalysis(m,d);
 if(minutePeriods[state.period]>=30)loadMinuteHistory(m,d);
 const jobs=[];
 const research=state.tab==='research', news=state.tab==='news';
 if(research)jobs.push(loadOutlook(m,d));
 if(research&&!d.aiHistory&&!d.aiListError)jobs.push(loadAnalysisHistory(m,d));
 if(news||state.modal==='ai')jobs.push(ensureAINews(m,d));
 if(!isFuture(m)&&m.id!=='TAIEX'&&!isTaiwanETF(m)&&(research&&(marketMode(m)==='stock'||m.exchange==='esb')||state.tab==='financial')&&!d.fundLoading&&(!d.fund||Date.now()-d.fundAt>3600000)){
  d.fundLoading=true;
  jobs.push(fundamentalsFor(m).then(v=>{d.fund=v;d.fundAt=Date.now();}).finally(()=>{d.fundLoading=false;}));
 }
 if(isUS(m)&&(research||state.tab==='quotes')&&!d.usBenchmarkLoading&&Date.now()-(d.usBenchmarkAt||0)>=60000){
  d.usBenchmarkLoading=true;d.usBenchmarkAt=Date.now();
  jobs.push(usMarketContext().then(rows=>{d.usBenchmarks=rows;}).finally(()=>{d.usBenchmarkLoading=false;}));
 }
 const needsDaily=research||['quotes','chips','positions'].includes(state.tab)||(state.k&&!isMinute())||(isFuture(m)&&state.period==='profile');
 const months=detailMonths(d);
 if(needsDaily&&dailyNeedsRefresh(m,d,months)){
  d.dailyLoading=true;
  d.dailyAttemptAt=Date.now();d.dailyAttemptMonths=months;
  d.dailyAttemptSession=detailSession(m,d.dailyAttemptAt);
  const contract=m.contract;
  jobs.push(dailySeries(m,months).then(v=>{
   if(state.details.get(m.id)===d&&m.contract===contract){d.daily=v;d.dailyError='';}
  }).catch(e=>{d.dailyError=message(e);}).finally(()=>{
   d.dailyLoading=false;
   if(selected()===m&&state.details.get(m.id)===d){
    if(state.k&&!isMinute()&&detailMonths(d)>months)loadDetails(m);
    if(state.period==='profile')loadProfile(m,d);
    if(isFuture(m)&&(state.tab==='research'||state.tab==='quotes'))loadFutureAnalysis(m,d);
   }
   render();
  }));
 }
 if(jobs.length){await Promise.allSettled(jobs);render();}
 if(selected()!==m)return;
 if(state.tab==='financial')loadRevenueHistory(m,d);
 if(state.tab==='research'||(m.id==='TAIEX'&&state.tab==='quotes'))loadTaiwanResearchContext(m,d);
 if(['research','chips'].includes(state.tab))loadInstitutional(m,d,state.tab==='chips'?10:4);
}
function snapshot(slot,push=false){
 const lines=state.watch.map(m=>{
  const q=quoteFor(m), stats=metrics(m,q,getDetail(m).daily?.bars);
  const label=m.name+' '+fmt(q?.price,digit(m))+'（'+signed(pct(q))+'）';
  const short=q?.error?'更新失敗':!fresh(q)?'非最新盤中報價':conditions(m,q,getDetail(m).daily?.bars).map(h=>h[1]).join('、')||'未見警報';
  if(state.snapshot==='精簡')return label+' '+(q?short:'無報價');
  if(!q)return label+'｜無報價';
  const fields=state.snapshot==='自訂'?state.snapshotFields:{time:true,range:true,volume:true};
  return label+'｜'+short+(fields.time?'｜'+twTime(q.ts):'')+
   (fields.range&&stats.bandReady?'｜開盤 '+fmt(stats.openLow,digit(m))+'～'+fmt(stats.openHigh,digit(m)):'')+
   (fields.volume&&Number.isFinite(stats.ratio)?'｜量比 '+fmt(stats.ratio,1):'');
 });
 log({title:slot,body:lines.join('\n'),kind:'snapshot'});
 if(push)telegramSend(slot+'｜'+twTime(Date.now()).slice(0,5)+'\n'+lines.join('\n'),true);
}
function scheduledSnapshot(){
 const now=Date.now(),date=twDate(now),time=twTime(now).slice(0,5);
 if(!state.watch.some(m=>fresh(quoteFor(m))))return;
 for(const [begin,end,title] of [['09:30','09:45','開盤快照'],['11:30','11:45','午盤快照'],['13:00','13:15','尾盤快照']]){
  const key=date+begin;
  if(time>=begin&&time<end&&!state.snapSlots.has(key)){state.snapSlots.add(key);snapshot(title,true)}
 }
}
let schedule;
const pendingQuotes=new Map(), dueQuotes=new Map();
const enabledGroups=()=>state.seconds?['all']:[...new Set(state.watch.map(quoteGroup))];
function scheduleNext(){
 clearTimeout(schedule);
 state.next=0;
 if(!state.run||!state.watch.length)return;
 const groups=enabledGroups().filter(group=>!pendingQuotes.has('all')&&
  (group==='all'?!pendingQuotes.size:!pendingQuotes.has(group)));
 if(!groups.length)return;
 const now=Date.now();
 state.next=Math.min(...groups.map(group=>dueQuotes.get(group)??now));
 schedule=setTimeout(()=>{
  for(const group of enabledGroups()){
   if((dueQuotes.get(group)??0)<=Date.now())runQuoteGroup(group,true);
  }
 },Math.max(0,state.next-now));
}
function runQuoteGroup(group,monitor){
 if(pendingQuotes.has('all')||(group==='all'&&pendingQuotes.size)||pendingQuotes.has(group))return;
 const cadence=group==='all'?state.seconds:fastPollSeconds[group];
 const started=Date.now();
 const stocks=state.watch.filter(m=>group==='all'||quoteGroup(m)===group).map(m=>({...m}));
 if(!stocks.length)return;
 const task=Promise.resolve().then(()=>refreshQuotes(stocks,monitor,group));
 pendingQuotes.set(group,task);
 dueQuotes.set(group,started+cadence*1000);
 state.busy=true;
 scheduleNext();
 task.catch(e=>log({title:'行情檢查失敗',body:message(e),kind:'error'})).finally(()=>{
  pendingQuotes.delete(group);
  state.busy=!!pendingQuotes.size;
  if(group==='all'&&state.seconds===cadence)dueQuotes.set(group,Date.now()+cadence*1000);
  scheduleNext();render();
  const active=selected();
  if(active&&(state.tab!=='news'||state.k&&!isMinute()||state.period==='profile'))loadDetails(active);
 });
}
function refresh(monitor){
 for(const group of enabledGroups())runQuoteGroup(group,monitor);
}
async function refreshQuotes(stocks,monitor,group){
 const failures=[];let ok=0;
 const mis=batchMIS(stocks),width=group==='mis'?20:group==='futures'?6:4;
 for(let i=0;i<stocks.length;i+=width){
  await Promise.all(stocks.slice(i,i+width).map(async m=>{
    const current=()=>state.watch.find(x=>x.id===m.id&&x.contract===m.contract&&x.exchange===m.exchange);
    try{
     const rule=state.rules[m.id],fastCash=group==='mis';
     const q=await liveQuote(m,mis,fastCash,!fastCash||m.id===state.id||rule?.band||rule?.volume>0);
     if(!current())return;
     const existing=quoteFor(m);
     if(existing&&existing.ts>q.ts){existing.error='來源回傳較舊資料';failures.push(m.name+'（'+existing.error+'）');return}
     recordIntraday(m,q);
     if(isFuture(m))observeFutureQuote(m,q);
     state.items.set(m.id,q);ok++;
     if(state.run)evaluated(m,q,true);
     if(monitor&&state.run&&rule?.sidePct>=51&&rule.enabled!==false&&canAlertTradeSides(m)&&alertSession(m,q))loadTradeSides(m,getDetail(m));
     if(q.source==='證交所 MIS'){
      if(state.id===m.id)render();
      else drawWatch();
     }
     if(q.source==='證交所 MIS'&&!q.bars.length){
      const chart=chartState.get(symbolFor(m));
      chart?.promise.then(y=>{
       const latest=quoteFor(m);
       if(y&&current()&&latest?.source==='證交所 MIS'&&!latest.bars.length&&twDate(latest.ts)===twDate(y.ts)){
        state.items.set(m.id,attachChart(latest,y));render();
       }
      });
     }
    }catch(e){
     if(!current())return;
     failures.push(m.name+'（'+message(e)+'）');
     const q=quoteFor(m);
     if(q)q.error=message(e);
    }
   }));
  }
  if(ok)state.last=Date.now();
  for(const m of stocks){
   if(!state.watch.some(current=>current.id===m.id&&current.contract===m.contract&&current.exchange===m.exchange))continue;
   const q=quoteFor(m);
   if(!q||q.error)continue;
   const previous=state.events.find(e=>e.kind==='quote'&&e.id===m.id);
   if(previous?.quoteAt===q.ts)continue;
   if(previous)state.events=state.events.filter(e=>e!==previous);
   const detail=getDetail(m), hits=conditions(m,q,detail.daily?.bars);
   addEvent(m,q,!fresh(q)?'最近可取得行情，等待新的盤中報價':hits.map(h=>'L'+h[2]+' '+h[1]).join('、')||'本次沒有觸發警報','quote');
  }
  if(monitor&&state.run){
   for(const m of stocks){
    if(!state.watch.some(current=>current.id===m.id&&current.contract===m.contract&&current.exchange===m.exchange))continue;
    const q=quoteFor(m),rule=state.rules[m.id],detail=getDetail(m);
    if(alertSession(m,q)){
     if((rule?.tech||rule?.volume>0||isFuture(m)&&rule?.profileAlert)&&dailyNeedsRefresh(m,detail,5)){
      detail.dailyLoading=true;detail.dailyAttemptAt=Date.now();detail.dailyAttemptSession=detailSession(m,detail.dailyAttemptAt);detail.dailyAttemptMonths=5;
      dailySeries(m).then(v=>{if(state.details.get(m.id)===detail){detail.daily=v;render()}}).catch(()=>{}).finally(()=>{detail.dailyLoading=false});
     }
     evaluated(m,q);
     if(alertSession(m,q)&&rule?.enabled!==false&&rule?.profileAlert){loadProfile(m,detail);checkProfileAlert(m,q,detail);}
    }
   }
   scheduledSnapshot();
  }
  if(stocks.length){
   const latest=stocks.filter(m=>{const q=quoteFor(m);return q&&!q.error&&fresh(q);}).length;
   state.events=state.events.filter(e=>e.kind!=='round'||e.group!==group);
   log({title:failures.length?'本輪更新有缺漏':'本輪行情檢查完成',body:({mis:'證交所 MIS',futures:'期貨',us:'美股',esb:'興櫃'}[group]?'【'+{mis:'證交所 MIS',futures:'期貨',us:'美股',esb:'興櫃'}[group]+'】':'')+'取得 '+ok+'／'+stocks.length+' 檔 · 兩分鐘內報價 '+latest+' 檔'+(failures.length?'\n失敗：'+failures.join('、'):'')+(monitor&&state.run?'\n警報依新報價時間與各股規則判定。':''),kind:'round',group});
  }
}
function select(id){
 if(!state.watch.some(m=>m.id===id))return;
 if(state.id!==id)setChartPeriod(chartPreferredPeriod);
 state.id=id;state.tab='research';render();loadDetails(selected());
}
const aiGuide={
 gemini:{key:'https://aistudio.google.com/apikey',web:'https://gemini.google.com/',label:'Gemini',button:'前往 Google AI Studio 取得金鑰',help:'登入 Google 帳號，按「建立 API 金鑰」，選擇或建立專案，再把金鑰貼到下方。'},
 groq:{key:'https://console.groq.com/keys',web:'https://console.groq.com/playground',label:'Groq',button:'前往 Groq Console 取得金鑰',help:'登入 Groq Console 後建立 API Key，再貼到下方。'},
 openai:{key:'https://platform.openai.com/api-keys',web:'https://chatgpt.com/',label:'ChatGPT',button:'前往 OpenAI API 平台取得金鑰',help:'登入 API 平台後建立金鑰。API 用量與 ChatGPT 訂閱分開。'}
};
function updateAIGuide(){
 const provider=el('dialog').querySelector('[data-field=provider]').value;
 const guide=aiGuide[provider]||aiGuide.gemini;
 const keyLink=el('keyLink'),webLink=el('aiWeb');
 keyLink.href=guide.key;keyLink.textContent=guide.button;
 el('keyHelp').textContent=guide.help;
 webLink.href=guide.web;webLink.textContent='開啟 '+guide.label+' 網頁';
}
let modalId=null,prevFocus=null, aiBusy=false;
function closeModal(){
 el('overlay').hidden=true;el('dialog').oninput=null;clearInterval(updatePoll);updatePoll=null;state.modal='';
 if(prevFocus?.isConnected)prevFocus.focus();
}
function modal(type,id){
 const m=state.watch.find(x=>x.id===(id||state.id));modalId=m?.id;state.modal=type;
 const rule=state.rules[modalId]||{};
 const form=(title,body)=>'<div class="row between"><h2>'+esc(title)+'</h2><button class="clean" data-act="close" aria-label="關閉">×</button></div>'+body;
 const field=(k,label,value,step='.01',max)=>'<label>'+esc(label)+'<input type="number" min="0"'+
  (max===undefined?'':' max="'+max+'"')+' step="'+step+'" data-field="'+k+'" value="'+esc(value??'')+'" placeholder="未設定"></label>';
 const check=(k,label,on)=>'<label><input type="checkbox" data-field="'+k+'" '+(on?'checked':'')+'> '+esc(label)+'</label>';
 const listOption=(values,sel)=>values.map(v=>'<option '+(String(v)===String(sel)?'selected ':'')+'value="'+esc(v)+'">'+esc(v)+'</option>').join('');
 const save='<button class="primary" data-act="save">儲存</button>';
 let html='';
 if(type==='add')html=form('加入股票','<label>股票名稱或代號<input data-field="search" placeholder="例如 2330、興櫃 7796、AAPL"></label><div class="items search-results" data-el="results"></div>');
 else if(type==='backups')html=form('備份與更新',backupsBody());
 else if(type==='appearance')html=form('外觀個人化',appearanceBody(state.appearance));
 else if(type==='settings')html=form('設定',
  '<div class="appearance-entry row between"><div><b>使用者資料與程式更新</b><p class="sub">備份自選股、持倉、警報與介面設定</p></div><button data-act="backups">備份與更新</button></div>'+
  '<div class="appearance-entry row between"><div><b>外觀</b><p class="sub">調整主題、色彩、字級和對比</p></div><button data-act="appearance">個人化</button></div><h3>監控</h3>'+
  '<div class="fields"><label>檢查間隔<select data-field="seconds">'+intervals.map(n=>'<option value="'+n+'" '+(state.seconds===n?'selected':'')+'>'+intervalLabel(n)+'</option>').join('')+'</select></label><label>定時快照詳細程度<select data-field="snapshot">'+listOption(['精簡','詳細','自訂'],state.snapshot)+'</select></label></div>'+
  '<p class="sub">最快模式依來源獨立檢查。證交所 10 秒、Yahoo 台期 15 秒、美股 30 秒、興櫃 60 秒。遇來源限流會暫停重試，收到新價才檢查警報。</p>'+
  '<div class="row wrap" data-el="snapshotFields" '+(state.snapshot==='自訂'?'':'hidden')+'>'+
  check('snapTime','時間',state.snapshotFields.time)+check('snapRange','開盤區間',state.snapshotFields.range)+check('snapVolume','量比',state.snapshotFields.volume)+'</div>'+
  check('notify','在 Windows 桌面顯示重大警報',state.notify)+
  '<div class="testing"><button data-act="test">測試警報彈窗</button><p class="sub">小窗沿用已儲存的介面主題。</p><p class="sub" data-el="noticeTestStatus" role="status"></p></div>'+
  check('telegram','本次工作階段啟用 Telegram',telegram.enabled)+
  '<label>Telegram Chat ID<input data-field="tgChat" autocomplete="off" value="'+esc(telegram.chat)+'" placeholder="群組或個人的 Chat ID"></label>'+
  '<label>Bot Token<input type="password" data-field="tgToken" autocomplete="off" maxlength="160" placeholder="'+(telegram.enabled?'留白保留目前設定':'貼上 Telegram Bot Token')+'"></label>'+
  '<p class="sub">Token 只供本次本機服務使用。變更 Chat ID 時請重新輸入，停用或結束服務即清除設定。</p>'+
  '<p class="sub" data-el="settingsStatus" aria-live="polite"></p>'+
  '<div class="row between wrap dialog-actions"><button data-act="exit">結束看盤小助手</button>'+save+'</div>');
 else if(type==='rule'||type==='manage'){
  if(!m)return closeModal();
  html=form(m.name+' · 監控設定',
   (isFuture(m)?'<label>契約<select data-field="contract">'+listOption(['近月','次月'],m.contract)+'</select></label>'+
   '<p class="sub">警報使用目前選擇的契約。切換近月／次月後，請確認填寫的價位仍適用。</p>':'')+
   '<div class="row wrap" aria-label="警報預設"><button data-act="preset" data-id="quiet">保守</button><button data-act="preset" data-id="balanced">恢復建議值</button><button data-act="preset" data-id="active">敏銳</button></div><p class="sub" data-el="presetHint">套用後仍可修改，按儲存才生效。停損與持有資料需自行填寫。</p>'+
   '<div class="fields">'+field('move','漲跌幅（%）',rule.move,'.1')+field('cooldown','同類警報冷卻（分鐘）',rule.cooldown??10,'1')+field('stop','停損價',rule.stop)+field('warn','警戒價',rule.warn)+
   field('burst','短時間急漲急跌（%）',rule.burst,'.1')+
   (m.id==='TAIEX'?'':field('volume','成交量突增門檻（倍）',rule.volume,'.1'))+
   (canAlertTradeSides(m)?field('sidePct','內／外盤放量偏向（51–100%，0 關閉）',rule.sidePct,'1',100):'')+
   (m.exchange==='esb'?field('spread','雙邊報價中點價差（%）',rule.spread,'.1'):'')+
   (m.id==='TAIEX'||isFuture(m)?'':
    field('cost',isUS(m)?'平均成本（美元）':'平均成本',rule.cost)+field('lots',isUS(m)?'持有股數':'持有張數',rule.lots,isUS(m)?'1':'.001')+
    field('riskBudget',isUS(m)?'單筆虧損預算（美元）':'單筆虧損預算（元）',rule.riskBudget,'1')+
    (marketMode(m)!=='stock'?'':field('relative','落後大盤（百分點）',rule.relative,'.1')))+
   field('entry','計畫進場價',rule.entry)+field('target','計畫目標價',rule.target)+
   field('targetNear','接近價位預警（%）',rule.targetNear??defaultTargetNear,'.01',100)+'</div>'+
   '<p class="sub">'+esc(alertModes[marketMode(m)].guide)+' 接近價位預警預設 1%，填 0 關閉。成本只在接近、觸及或相鄰報價跨越時提醒。短時間急漲急跌採同來源近期成交價，量能以近期成交速度作比較。</p>'+
   check('enabled','啟用此商品警報',rule.enabled!==false)+check('tech','跌破月線／季線',rule.tech)+check('band','突破／跌破開盤區間',rule.band)+
   (m.id==='TAIEX'?'':check('profileAlert','近 20 日主要成交密集區突破／跌破提醒',rule.profileAlert)+
   '<p class="sub">預設關閉。使用前 20 個交易日資料，收到連續兩筆跨出密集區的新報價才提醒。</p>')+
   '<div class="row between wrap dialog-actions"><button data-act="remove" data-id="'+esc(m.id)+'">移除追蹤</button>'+save+'</div>');
 }else if(type==='ai'&&m){
  html=form('AI 分析 · '+m.name,
   '<p class="sub">'+(isFuture(m)?'送出行情、日夜盤、價差、部位與新聞摘要。':'送出行情、指標、公開資料與新聞摘要。')+'金鑰只用於此次分析。</p>'+
   (positionPlan(m,quoteFor(m),rule)?'<label class="portfolio-optin"><input type="checkbox" data-field="includePosition"> 納入持倉與交易計畫</label><p class="sub">勾選後，API 請求或複製的資料會包含你已填寫的成本、張數及交易計畫。AI 回覆仍會備份在本機。</p>':'')+
   '<label>服務<select data-field="provider"><option value="gemini">Gemini Flash-Lite（有免費額度）</option><option value="groq">Groq GPT-OSS（有免費額度）</option><option value="openai">OpenAI API（另計費）</option></select></label>'+
   '<div class="api-guide"><a data-el="keyLink" target="_blank" rel="noopener noreferrer"></a><span class="sub ai-guide-note" data-el="keyHelp"></span></div>'+
   '<label>API 金鑰<input type="password" data-field="apiKey" autocomplete="off" maxlength="255" placeholder="貼上此次使用的 API 金鑰"></label>'+
   '<div class="row wrap dialog-actions"><button class="primary" data-act="ask">送出 API 分析</button></div>'+
   '<div class="api-guide"><b>還沒有金鑰？</b><p class="sub">複製這檔股票的研究資料，再到 AI 網頁貼上。</p><div class="row wrap"><button data-act="copy">複製分析資料</button><a class="ai-web" data-el="aiWeb" target="_blank" rel="noopener noreferrer"></a></div></div>'+
   '<textarea class="ai-copy-fallback" aria-label="可手動複製的分析資料" data-el="aiCopyFallback" readonly hidden></textarea>'+
   '<div class="ai-output sub" data-el="aiOutput" aria-live="polite"></div>');
 }
 if(el('overlay').hidden)prevFocus=document.activeElement;
 el('dialog').oninput=null;el('dialog').innerHTML=html;el('overlay').hidden=false;
 (el('dialog').querySelector('input:not([type=checkbox])')||el('dialog').querySelector('button'))?.focus();
 clearInterval(updatePoll);updatePoll=null;
 if(type==='backups'){
  backupStatus();loadSettingsBackupList();showUpdateStatus();
  el('backupFile').onchange=()=>readSettingsImport(el('backupFile'));
  updatePoll=setInterval(()=>{if(state.modal==='backups')showUpdateStatus();},2500);
 }
 if(type==='settings'){
  const snapshotMode=el('dialog').querySelector('[data-field=snapshot]');
  snapshotMode.onchange=()=>{el('snapshotFields').hidden=snapshotMode.value!=='自訂'};
 }
 if(type==='add')loadSearch();
 if(type==='ai'&&m){
  const provider=el('dialog').querySelector('[data-field=provider]');
  provider.onchange=()=>{
   el('dialog').querySelector('[data-field=apiKey]').value='';
   updateAIGuide();
  };
  updateAIGuide();state.tab='research';render();loadDetails(m);
 }
 if(type==='appearance'){
  el('dialog').oninput=event=>{
   if(state.modal==='appearance'&&event.target!==appearanceField('appearanceTheme'))previewAppearance();
  };
  appearanceField('appearanceTheme').onchange=()=>{
   const theme=appearanceField('appearanceTheme').value;
   fillAppearance({...appearanceDraft(),...appearancePresets[theme],theme});
  };
  fillAppearance(state.appearance);
 }
}
let searchMatches=[],searchSession=0;
function extraMarketCandidate(query,all){
 const esb=/^(?:興櫃\s*|ESB[:：]\s*)(\d{4,6}[A-Z]?)$/.exec(query);
 if(esb)return all.get(esb[1])||null;
 const ticker=usTicker(query);
 if(ticker&&(!all.has(query)||/^US[:：]/.test(query)))
  return {id:'US:'+ticker,name:ticker,exchange:'us',type:'個股',market:'美股 · USD'};
 return null;
}
function reconcileCatalogWatch(rows){
 const catalog=new Map(rows.map(row=>[row.id,row]));
 let changed=false,reload=false;
 for(const m of state.watch){
  const known=catalog.get(m.id);
  if(!known||isFuture(m)||isUS(m)||m.id==='TAIEX')continue;
  if(m.exchange!==known.exchange){
   state.items.delete(m.id);state.details.delete(m.id);state.tracking.delete(m.id);intradaySamples.delete(m.id);
   reload=true;
  }
  if(['name','exchange','market','type'].some(key=>m[key]!==known[key])){
   Object.assign(m,known);changed=true;
  }
 }
 if(changed){persist();render();}
 if(reload)Promise.allSettled([...pendingQuotes.values()]).then(()=>{
  if(exited)return;
  refresh(false);
  const m=selected();if(m)loadDetails(m);
 });
}
function loadSearch(force=false){
 const input=el('dialog').querySelector('[data-field=search]'),session=++searchSession;
 let catalog=catalogState.rows.length?catalogState.rows:cachedCatalog(),loading=true,timer,inputRevision=0,checking='',lookupError='';
 const lookups=new Map();
 const current=()=>state.modal==='add'&&input.isConnected&&session===searchSession;
 if(force)catalogState.at=0;
 function draw(){
  if(!current())return;
  const query=input.value.trim().toUpperCase();
  const all=new Map([...defaults,...state.watch,...catalog,...[...lookups.values()].filter(Boolean)].map(m=>[m.id,m]));
  const code=/^(?:(?:興櫃|ESB[:：])\s*)?(\d{4,6}[A-Z]?)$/.exec(query)?.[1];
  searchMatches=[...all.values()].filter(x=>(x.id+' '+x.name+' '+(isFuture(x)?'期貨 '+futuresProducts[x.id].aliases:'')).toUpperCase().includes(query)).slice(0,12);
  const extra=extraMarketCandidate(query,all);
  if(extra)searchMatches=[extra,...searchMatches.filter(x=>x.id!==extra.id)];
  const unresolved=code&&(!all.has(code)||all.get(code).name===code||String(all.get(code).market||'').includes('代號查詢'));
  if(unresolved)searchMatches=searchMatches.filter(x=>x.id!==code);
  if(unresolved&&checking!==code&&!lookups.has(code)){
   checking=code;lookupError='';
   const revision=inputRevision;
   const active=()=>current()&&revision===inputRevision;
   timer=setTimeout(async()=>{
    try{
     const row=await resolveTaiwanCode(code);
     if(!active())return;
     if(row){
      lookups.set(code,row);catalog=mergeCatalog(catalog,row);reconcileCatalogWatch([row]);
     }else{lookups.set(code,null);lookupError='尚未確認 '+code+' 的市場資料，可重新載入清單。';}
    }catch{if(active()){lookups.set(code,null);lookupError='單檔查詢暫時未完成，可重新載入清單。';}}
    finally{if(active()){checking='';draw();}}
   },250);
  }
  const missing=catalogState.missing.map(ex=>catalogMarkets.find(m=>m.exchange===ex).market.split(' · ').at(-1)).join('、');
  const status=[loading?'正在載入股票清單…':'',unresolved&&checking===code?'正在確認 '+code+' 的名稱與市場…':'',lookupError,
   !loading&&missing?missing+'清單尚未完整載入，已保留可用資料。':''].filter(Boolean).join(' ');
  el('results').innerHTML=searchMatches.map(m=>'<div class="row between"><span>'+esc(m.name)+' <small class="sub">'+
   esc(isUS(m)?m.market:m.id+' · '+m.market)+'</small></span><button data-act="include" data-id="'+esc(m.id)+'">'+
   (state.watch.some(x=>x.id===m.id)?'查看':'加入')+'</button></div>').join('')+
   (status?'<p class="sub" role="status">'+esc(status)+'</p>':!searchMatches.length?'<p class="sub">查無相符商品，可重新載入清單。</p>':'')+
   '<button data-act="retryCatalog">重新載入清單</button>';
 }
 input.oninput=()=>{inputRevision++;clearTimeout(timer);checking='';lookupError='';draw();};
 draw();
 fullCatalog(rows=>{catalog=rows;draw();}).then(rows=>{
  if(!current())return;
  catalog=rows;reconcileCatalogWatch(rows);
 }).catch(()=>{lookupError='股票清單暫時無法取得，可重新載入。';}).finally(()=>{loading=false;draw();});
}
let settingsBusy=false;
async function changeRules(){
 if(settingsBusy)return;
 const get=k=>el('dialog').querySelector('[data-field="'+k+'"]');
 const v=k=>get(k)?.value;
 if(![...el('dialog').querySelectorAll('input,select')].every(x=>x.reportValidity()))return;
 if(state.modal==='settings'){
  const enabled=get('telegram').checked,chat=v('tgChat').trim(),tokenField=get('tgToken');
  const token=tokenField.value.trim();
  const status=el('settingsStatus');
  if(enabled&&!(/^-?\d+$/.test(chat)||/^@[a-zA-Z0-9_]{5,}$/.test(chat))){
   status.textContent='請確認 Telegram Chat ID。';return;
  }
  if(enabled&&(token||!telegram.enabled||chat!==telegram.chat)&&!/^\d{5,18}:[A-Za-z0-9_-]{20,128}$/.test(token)){
   status.textContent='請輸入有效的 Telegram Bot Token。';return;
  }
  tokenField.value='';
  settingsBusy=true;
  try{
   if(enabled&&token){
    await bridge('telegram-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat,token})});
   }else if(!enabled&&telegram.enabled){
    await bridge('telegram-clear',{method:'POST'});
   }
   telegram={enabled,chat:enabled?chat:''};
  }catch(e){status.textContent='無法更新 Telegram 設定（'+message(e)+'）。';return}
  finally{settingsBusy=false}
  if(state.modal!=='settings'||!status.isConnected)return;
  const cadence=+v('seconds');
  if(state.seconds!==cadence)dueQuotes.clear();
  state.seconds=cadence;state.snapshot=v('snapshot');state.snapshotFields={time:get('snapTime').checked,range:get('snapRange').checked,volume:get('snapVolume').checked};state.notify=get('notify').checked;
  scheduleNext();
 }else{
  const m=state.watch.find(x=>x.id===modalId);
  if(!m)return;
  if(+v('sidePct')>0&&+v('sidePct')<51){get('sidePct').setCustomValidity('填 0 或 51 至 100。');get('sidePct').reportValidity();get('sidePct').setCustomValidity('');return;}
  state.rules[m.id]=Object.fromEntries(['move','stop','warn','volume','cost','lots','entry','target','riskBudget','relative','cooldown','burst','sidePct','spread'].map(k=>[k,Number(v(k))||0]));
  const near=v('targetNear');
  if(near!==undefined)state.rules[m.id].targetNear=near===''?defaultTargetNear:Number(near);
  Object.assign(state.rules[m.id],{enabled:get('enabled').checked,tech:get('tech').checked,band:get('band').checked,profileAlert:!!get('profileAlert')?.checked});
  delete getDetail(m).profileAlert;
  state.tracking.delete(m.id);
  if(get('contract')&&m.contract!==v('contract')){
   m.contract=v('contract');state.items.delete(m.id);
   const imported=getDetail(m).profileTrades;
   state.details.delete(m.id);
   if(imported)getDetail(m).profileTrades=imported;
   if(!state.run)refresh(false);
  }
  if(state.rules[m.id].tech){const target=getDetail(m);dailySeries(m).then(data=>{if(state.details.get(m.id)===target){target.daily=data;render()}}).catch(()=>{});}
  if(state.run)refresh(true);
 }
 persist();closeModal();render();
}
function buildPrompt(m,includePosition=false){return buildMarketPrompt(m,includePosition);}
function geminiModelCandidates(models){
 if(!Array.isArray(models))return [];
 const candidates=models.flatMap(model=>{
  const match=/^models\/(gemini-(\d{1,2})\.(\d{1,2})-flash-lite(?:-(\d{3}))?)$/.exec(model?.name||'');
  return match&&Array.isArray(model.supportedGenerationMethods)&&model.supportedGenerationMethods.includes('generateContent')?
   [{name:match[1],major:+match[2],minor:+match[3],revision:+(match[4]||0)}]:[];
 });
 candidates.sort((a,b)=>b.major-a.major||b.minor-a.minor||a.revision-b.revision);
 return [...new Set(candidates.map(model=>model.name))];
}
async function geminiAnalysis(key,body,out){
 out.textContent='正在查詢此金鑰可用的 Gemini 模型…';
 const headers={'Content-Type':'application/json','X-CAS-Provider-Key':key};
 let catalog;
 try{catalog=JSON.parse(await bridge('gemini-models',{method:'POST',headers}));}
 catch(e){throw Object.assign(new Error(message(e)),{status:e.status,phase:'gemini-list'});}
 const models=geminiModelCandidates(catalog?.models);
 if(!models.length)throw Object.assign(new Error('此專案沒有列出支援文字生成的 Gemini Flash-Lite 模型'),{phase:'gemini-empty'});
 for(const model of models.slice(0,4)){
  out.textContent='正在以 '+model+' 分析…';
  try{
   const result=JSON.parse(await bridge('gemini',{method:'POST',headers:{...headers,'X-CAS-Gemini-Model':model},body:JSON.stringify(body)}));
   return {result,model};
  }catch(e){
   if(e.status!==404)throw e;
  }
 }
 throw Object.assign(new Error('HTTP 404'),{status:404,phase:'gemini-generate'});
}
let aiPreparing=false;
async function askAI(copy){
 if(aiBusy||aiPreparing)return;
 const m=state.watch.find(x=>x.id===modalId),dialog=el('dialog'),out=el('aiOutput');
 if(!m||!out||!valid(quoteFor(m)?.price))return;
 const contract=m.contract,exchange=m.exchange;
 aiPreparing=true;out.textContent='正在整理最新報價、歷史觀察與新聞…';
 try{
  const d=getDetail(m);
  await Promise.allSettled([ensureAINews(m,d),loadOutlook(m,d)]);
  if(state.modal!=='ai'||modalId!==m.id||el('dialog')!==dialog||!dialog.isConnected||m.contract!==contract||m.exchange!==exchange)return;
  await performAIRequest(copy);
 }catch(e){if(out.isConnected)out.textContent='無法準備分析資料（'+message(e)+'）。';}
 finally{aiPreparing=false;}
}
async function performAIRequest(copy){
 if(aiBusy)return;
 const m=state.watch.find(x=>x.id===modalId),q=m&&quoteFor(m);
 if(!q||!valid(q.price))return;
 const out=el('aiOutput'), provider=el('dialog').querySelector('[data-field=provider]').value,
  prompt=buildPrompt(m,!!el('dialog').querySelector('[data-field=includePosition]')?.checked);
 if(copy){
  const fallback=el('aiCopyFallback');
  try{
   await navigator.clipboard.writeText(prompt);
   fallback.hidden=true;out.textContent='已複製，請開啟 AI 網頁貼上。';
  }catch{
   fallback.value=prompt;fallback.hidden=false;fallback.select();
   out.textContent='瀏覽器未授權自動複製，請按 Ctrl+C 複製選取的文字。';
  }
  return;
 }
 const keyField=el('dialog').querySelector('[data-field=apiKey]'),key=keyField.value.trim();
 const keyPattern=provider==='gemini'?/^[A-Za-z0-9_.-]{16,255}$/:/^[A-Za-z0-9_-]{16,255}$/;
 if(!keyPattern.test(key)){out.textContent='請輸入所選服務的 API 金鑰。';return}
 const analysisDetail=getDetail(m), stock=analysisStock(m);
 keyField.value='';
 aiBusy=true;out.textContent='正在請求分析…';
 try{
  const body=provider==='openai'?{model:'gpt-4.1-mini',input:prompt,max_output_tokens:2600,store:false}:
   provider==='groq'?{model:'openai/gpt-oss-20b',messages:[{role:'user',content:prompt}],max_completion_tokens:2800,reasoning_effort:'low'}:
   {contents:[{parts:[{text:prompt}]}]};
  const {result,model}=provider==='gemini'?await geminiAnalysis(key,body,out):
   {result:JSON.parse(await bridge(provider,{method:'POST',headers:{'Content-Type':'application/json','X-CAS-Provider-Key':key},body:JSON.stringify(body)}))};
  const value=provider==='openai'?result.output?.flatMap(o=>o.content||[]).map(c=>c.text).filter(Boolean).join('\n'):
   provider==='groq'?result.choices?.[0]?.message?.content:
   result.candidates?.flatMap(c=>c.content?.parts||[]).map(p=>p.text).filter(Boolean).join('\n');
  out.textContent=value||'服務沒有回傳分析內容。';
  if(typeof value==='string'&&value.trim()){
   const record={id:analysisId(Date.now()),provider:model||provider,text:value};
   (analysisDetail.aiRecords??=new Map()).set(record.id,record);
   (analysisDetail.aiUnsaved??=new Set()).add(record.id);
   addAnalysisIds(analysisDetail,[record.id]);
   analysisDetail.aiId=record.id;analysisDetail.aiRecordError='';
   if(selected()?.id===m.id&&state.details.get(m.id)===analysisDetail&&state.modal==='ai'&&modalId===m.id&&out.isConnected){
    closeModal();state.tab='research';
   }
   await saveAnalysisRecord(stock,analysisDetail,record);
  }
 }catch(e){
  const detail=message(e);
  const hint=e.phase==='gemini-empty'?'可到 Google AI Studio 的模型清單確認專案是否開放 Flash-Lite。':
   e.phase==='gemini-generate'?'已取得模型清單，但列出的 Flash-Lite 模型回傳找不到。可在 AI Studio 以同一個專案試跑，或先用網頁分析。':
   e.status===429?'已達服務用量或請求上限，請稍後再試。':
   [401,403].includes(e.status)||(e.phase==='gemini-list'&&e.status===400)?'請核對服務商、金鑰及專案權限。':
   e.phase==='gemini-list'?'未能取得模型清單。請確認新版程式已啟動，並確認電腦能連到 Gemini API。':'請確認模型可用性、額度及網路。';
  out.textContent='分析失敗（'+detail+'）。'+hint;
 }finally{aiBusy=false}
}
root.addEventListener('change',e=>{
 if(!sessionReady)return;
 const m=selected();
 if(!m)return;
 if(e.target===el('aiHistoryPicker'))openAnalysisRecord(m,getDetail(m),e.target.value);
 else if(e.target===el('profileFile'))importProfileFiles(m,getDetail(m),[...e.target.files]);
 else if(e.target===el('profileContract')){
  getDetail(m).profileImportMonth=e.target.value;
  drawChart();
 }
});
function explainRadarMetric(button){
 const m=selected(),index=Number(button.dataset.id);
 if(!m||!Number.isInteger(index)||index<0||index>=Object.keys(radarMeaning).length)return;
 const restoreFocus=document.activeElement===button;
 getDetail(m).radarMetric=index;
 render();
 if(restoreFocus)root.querySelector('.radar-axis[data-id="'+index+'"]')?.focus({preventScroll:true});
}
root.addEventListener('keydown',e=>{
 if(e.key==='Escape'){endChartPan();if(state.modal&&!settingsBusy)closeModal();}
 if(!sessionReady||!['Enter',' '].includes(e.key))return;
 const button=e.target.closest('[data-act="radarMetric"]');
 if(button){e.preventDefault();explainRadarMetric(button);}
});
root.addEventListener('click',async e=>{
 if(appBooting)return;
 const b=e.target.closest('[data-act]');
 if(!b||!root.contains(b))return;
 if(!sessionReady)return;
 const a=b.dataset.act,id=b.dataset.id;
 if(a==='select')select(id);
 else if(a==='watchPin'&&state.watch.some(m=>m.id===id)){
  if(state.watchPins.includes(id))state.watchPins=state.watchPins.filter(item=>item!==id);
  else state.watchPins.unshift(id);
  persist();drawWatch();
 }
 else if(a==='radarMetric')explainRadarMetric(b);
 else if(['add','settings','rule','manage','ai','appearance'].includes(a)&&!settingsBusy)modal(a,id);
 else if(a==='appearanceReset'&&state.modal==='appearance')fillAppearance(normalizeAppearance());
 else if(a==='appearanceSave'&&state.modal==='appearance'){
  if(!appearanceField('appearanceFont').reportValidity())return;
  const value=appearanceDraft(),error=validAppearance(value);
  if(error){el('appearanceStatus').textContent=error;return;}
  state.appearance=value;applyAppearance(root,value);persist();modal('settings');render();
 }
 else if(['aiHistoryMore','aiHistoryRetry','aiRecordRetry','aiSaveRetry'].includes(a)){
  const m=selected();
  if(!m)return;
  const d=getDetail(m);
  if(a==='aiHistoryMore'&&d.aiCursor)loadAnalysisHistory(m,d,d.aiCursor);
  if(a==='aiHistoryRetry')loadAnalysisHistory(m,d);
  if(a==='aiRecordRetry')openAnalysisRecord(m,d,d.aiId);
  if(a==='aiSaveRetry'&&d.aiUnsaved?.has(d.aiId))saveAnalysisRecord(analysisStock(m),d,d.aiRecords.get(d.aiId));
 }
 else if(a==='backups')modal('backups');
 else if(['backupNow','backupExport','backupImport','backupReload','backupPreviewCurrent','backupKeepBrowser','backupHistoryLoad','backupRestoreConfirm','backupOptions','updateCheck','updateDownload'].includes(a)&&state.modal==='backups')await backupAction(a,b);
 else if(a==='close'&&!settingsBusy)closeModal();
 else if(a==='retryCatalog'&&state.modal==='add')loadSearch(true);
 else if(a==='include'){
  const resolved=searchMatches.find(m=>m.id===id);
  if(resolved&&!isUS(resolved))reconcileCatalogWatch([resolved]);
  if(!state.watch.some(m=>m.id===id)){
   if(state.watch.length>=20){el('results').insertAdjacentHTML('afterbegin','<p>目前最多可追蹤 20 檔。</p>');return}
   const m=searchMatches.find(s=>s.id===id);
   if(!m)return;
   if(isUS(m)){
    const input=el('dialog').querySelector('[data-field=search]');
    const expected=input.value;
    const current=()=>state.modal==='add'&&input.isConnected&&input.value===expected;
    b.disabled=true;
    try{
     const quote=await liveQuote(m);
     if(!current())return;
     if(state.watch.some(x=>x.id===id)||state.watch.length>=20)return;
     state.items.set(id,quote);
    }catch{
     if(current())el('results').insertAdjacentHTML('afterbegin','<p class="sub">暫未取得這個美股代號的報價，請核對代號或稍後再試。</p>');
     return;
    }finally{b.disabled=false;}
   }
   state.watch.push({...m});state.rules[m.id]=suggestedRule(m);persist();
  }
  closeModal();select(id);refresh(false);
 }
 else if(a==='remove'){
  state.watch=state.watch.filter(m=>m.id!==id);
  state.watchOrder=state.watchOrder.filter(item=>item!==id);state.watchPins=state.watchPins.filter(item=>item!==id);
  state.items.delete(id);intradaySamples.delete(id);state.tracking.delete(id);state.details.delete(id);delete state.rules[id];
  if(state.id===id){state.id=state.watch[0]?.id||null;setChartPeriod(chartPreferredPeriod);if(selected())loadDetails(selected());}
  persist();closeModal();render();
 }
 else if(a==='preset'&&['rule','manage'].includes(state.modal)){
  const m=state.watch.find(x=>x.id===modalId), rule=m&&suggestedRule(m,id);
  if(!rule)return;
  for(const [key,val] of Object.entries(rule)){
   const control=el('dialog').querySelector('[data-field="'+key+'"]');
   if(control){if(control.type==='checkbox')control.checked=val;else control.value=val||'';}
  }
  el('presetHint').textContent='已填入預設。可再修改，按儲存後生效。';
 }
 else if(a==='save')changeRules();
 else if(a==='period'&&Object.hasOwn(chartPeriods,id)){
  chartZoom=null;chartWheelSize=null;
  chartPreferredPeriod=id;setChartPeriod(id);persist();render();if(selected())loadDetails(selected());
 }
 else if(a==='profileRange'&&profileRanges.includes(Number(id))){
  if(state.profileDays!==Number(id)){
   state.profileDays=Number(id);
   if(selected())getDetail(selected()).profileZoom=0;
   persist();drawChart();
  }
  if(selected())loadProfile(selected(),getDetail(selected()));
 }
 else if(a==='profileZoom'&&['in','out','reset'].includes(id)&&selected()){
  zoomPriceProfile(selected(),getDetail(selected()),{in:1,out:-1,reset:0}[id]);
 }
 else if(a==='range'&&chartRanges.includes(Number(id))){
  chartZoom=null;chartWheelSize=null;chartPending=null;
  state.months=Number(id);persist();render();if(selected())loadDetails(selected());
 }
 else if(a==='chartReset'){
  chartZoom=null;chartWheelSize=null;chartPending=null;
  if(state.period!==chartPreferredPeriod){setChartPeriod(chartPreferredPeriod);render();if(selected())loadDetails(selected());}
  else drawChart();
 }
 else if(a==='retryFlow'&&selected()){
  const m=selected(),d=getDetail(m);
  if(d.daily?.bars.length)loadInstitutional(m,d,10,true);
  else{d.dailyAttemptAt=0;loadDetails(m);}
 }
 else if(a==='futureView'&&selected()&&isFuture(selected())&&['auto','day','night'].includes(id)){
  const m=selected();
  getDetail(m).futureChartSession=id==='auto'?null:id;
  if(state.period!=='line'&&!isMinute())setChartPeriod('line');
  chartZoom=null;chartWheelSize=null;chartPending=null;chartHover=null;
  render();
  [...el('modeSummary').querySelectorAll('[data-act="futureView"]')].find(button=>button.dataset.id===id)?.focus({preventScroll:true});
 }
 else if(['quotes','news','research','chips','financial','positions'].includes(a)&&selected()&&Object.hasOwn(marketTabs(selected()),a)){
  endChartPan();state.tab=a;render();loadDetails(selected());
 }
 else if(a==='all'||a==='alerts'){state.alerts=a==='alerts';render()}
 else if(a==='toggle'){
  if(!state.watch.length&&!state.run){modal('add');return}
  state.run=!state.run;
  dueQuotes.clear();
  if(state.run){resetPricePlanTracking();log({title:'監控已啟用',body:'每檔第一筆有效報價會立即檢查交易計畫價位。'});refresh(true);if(!state.next)scheduleNext()}
  else{clearTimeout(schedule);state.next=0;log({title:'監控已暫停',body:'可繼續查詢行情與新聞。'});}
  render();
 }
 else if(a==='refresh')refresh(state.run);
 else if(a==='snapshot')snapshot('手動快照');
 else if(a==='test'&&state.modal==='settings')previewNotice();
 else if(a==='copy'||a==='ask')askAI(a==='copy');
 else if(a==='exit')bridge('exit',{method:'POST'}).then(()=>{
  exited=true;clearTimeout(schedule);state.run=false;telegram={enabled:false,chat:''};closeModal();
  root.querySelectorAll('button').forEach(b=>b.disabled=true);
  el('statusText').textContent='程式已結束，可以關閉此頁';
 }).catch(()=>{const status=el('settingsStatus');if(status)status.textContent='無法連線到本機服務。請關閉啟動視窗。';});
});
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&state.run&&state.next<=Date.now()){
  clearTimeout(schedule);
  scheduleNext();
 }
});
new ResizeObserver(drawChart).observe(plot);
applyAppearance(root,state.appearance);
render();
if(sessionReady){
 (async()=>{
  await initSettingsBackup();appBooting=false;
  startSettingsBackupTimer();queueSettingsBackup();
  loadTelegramStatus().then(()=>{if(launchSettings)modal('settings')});
  if(selected())loadDetails(selected());refresh(false);render();
  if(settingsBackupState.conflict)modal('backups');
  if(state.watch.some(m=>/^\d{4,6}[A-Z]?$/.test(m.id)&&!isUS(m)))fullCatalog().then(reconcileCatalogWatch).catch(()=>{});
  bridge('app-ready',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({update:state.update})}).catch(()=>{});
 })().catch(e=>{appBooting=false;log({title:'啟動設定讀取未完成',body:message(e),kind:'error'});render();});
}else{
 el('startHint').hidden=false;
 for(const button of root.querySelectorAll('button'))button.disabled=true;
}

window.addEventListener('pagehide',()=>{
 if(sessionReady&&settingsBackupState.ready&&state.backup.enabled&&!settingsBackupState.promise)writeSettingsBackup(false,null,true).catch(()=>{});
});
