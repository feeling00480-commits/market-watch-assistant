function observeFutureQuote(m,q){
 const key=isFuture(m)&&futureSessionKey(q.ts);
 if(!key||q.closing||q.error)return;
 const d=getDetail(m),session=key.split(':')[0];
 d.futureObserved??={};
 if((d.futureObserved[session]?.ts??0)>q.ts)return;
 d.futureSessionQuotes??={};
 d.futureSessionQuotes[session]=q;
 d.futureObserved[session]={sessionKey:key,t:q.ts,ts:q.ts,o:q.open,h:q.high,l:q.low,c:q.price,v:q.volume,
  delta:pct(q),source:q.source};
}
function loadFutureAnalysis(m,d){
 if(!isFuture(m))return;
 const now=Date.now(),recent=d.daily?.bars.at(-1),month=recent?.contract;
 const cadence=(state.seconds||fastPollSeconds.futures)*1000;
 if(!d.futurePairLoading&&now-(d.futurePairAt||0)>=Math.max(cadence,15000)){
  d.futurePairAt=now;d.futurePairLoading=true;
  const other={...m,contract:m.contract==='次月'?'近月':'次月'};
  const cashOpen=twTime(now)>='09:00:00'&&twTime(now)<dailyCloseTime;
  const jobs=[futureQuote(other).then(q=>{d.futurePair={q,contract:other.contract};}).catch(()=>{})];
  if(hasTaiexBasis(m)&&cashOpen&&!state.watch.some(x=>x.id==='TAIEX'))
   jobs.push(batchMIS([mainIndex]).then(r=>{const q=misQuote(r,mainIndex);if(q)d.futureCash=q;}));
  Promise.allSettled(jobs).finally(()=>{
   d.futurePairLoading=false;
   if(selected()===m&&state.details.get(m.id)===d)render();
  });
 }
 if(month&&!d.futureReportLoading&&(d.futureReportMonth!==month||now-(d.futureReportAt||0)>=10*60000)){
  d.futureReportAt=now;d.futureReportMonth=month;d.futureReportLoading=true;
  const jobs=[recentFutureNight(m,month,twDate(recent.t)).then(r=>{d.futureNight=r;})];
  if(hasTaiexBasis(m))jobs.push(dailySeries(mainIndex,2).then(r=>{d.futureCashDaily=r.bars;}));
  Promise.allSettled(jobs).finally(()=>{
   d.futureReportLoading=false;
   if(selected()===m&&state.details.get(m.id)===d)render();
  });
 }
}
const futureRangePosition=(price,lo,hi)=>valid(price)&&valid(lo)&&valid(hi)&&hi>lo&&price>=lo&&price<=hi?(price-lo)/(hi-lo):NaN;
function futureReview(q,day,night){
 const key=futureSessionKey(q?.ts);
 const row=key.startsWith('night:')?night:key?day:(night?.t||0)>(day?.t||0)?night:day;
 if(!row)return {text:'等待可辨識時段的期貨資料。',tone:'neutral'};
 const label=row.sessionKey.startsWith('night:')?'夜盤':'日盤';
 const delta=row.delta;
 const pos=futureRangePosition(row.c,row.l,row.h);
 const range=pos>=.8?'，靠近區間高點':pos<=.2?'，靠近區間低點':'';
 const current=!row.report&&q?.ts===row.t&&fresh(q)&&!q.error;
 const prefix=current?'':'最近'+(row.report?'公布':'取得')+'的';
 if(label==='夜盤'&&current&&day?.report&&day.sessionKey.slice(4)===row.sessionKey.slice(6)&&day.delta>=.3&&row.c<day.c){
  const full=day.delta>-100&&row.c<=day.c/(1+day.delta/100);
  return {text:'夜盤'+(full?'已回吐':'回吐部分')+'日盤漲幅'+range+'。',tone:'down'};
 }
 const text=Number.isFinite(delta)?Math.abs(delta)<.15?'近乎持平':delta>0?'偏強 '+signed(delta):'偏弱 '+signed(delta):'漲跌未確認';
 return {text:prefix+label+text+range+'。',tone:toneFor(current&&Math.abs(delta)>=.15?delta:0)};
}
function futureContext(m,q,d,now=Date.now()){
 const last=d.daily?.bars.at(-1),prev=d.daily?.bars.at(-2),month=last?.contract;
 const officialNight=d.futureNight?.contract===month?d.futureNight:null;
 const session=(r,obs)=>r&&(!obs||r.t>=obs.t)?{...r,source:'期交所日行情',report:true}:obs;
 const day=session(last,d.futureObserved?.day),night=session(officialNight,d.futureObserved?.night);
 const cashOpen=twTime(now)>='09:00:00'&&twTime(now)<dailyCloseTime;
 const liveIndex=state.items.get('TAIEX')||d.futureCash;
 const index=hasTaiexBasis(m)&&cashOpen?liveIndex:null;
 const basisReady=hasTaiexBasis(m)&&q&&!q.error&&fresh(q)&&!q.delayed&&valid(index?.price)&&!index?.error&&index.source==='證交所 MIS'&&
  fresh(index)&&Math.abs(index.ts-q.ts)<=30000&&futureSessionKey(q.ts).startsWith('day:');
 const reportIndex=d.futureCashDaily?.findLast(b=>b.t<=q?.ts);
 const watchClose=liveIndex&&isCashClose(liveIndex,state.details.get('TAIEX')?.daily?.bars,now)&&liveIndex.ts<=q?.ts?
  {c:liveIndex.price,t:liveIndex.ts}:null;
 const indexClose=watchClose&&(!reportIndex||watchClose.t>=reportIndex.t)?watchClose:reportIndex;
 const closeReady=hasTaiexBasis(m)&&!cashOpen&&q&&!q.error&&valid(q.price)&&valid(indexClose?.c)&&q.ts>=indexClose.t&&q.ts-indexClose.t<5*86400000;
 const basis=basisReady?{points:q.price-index.price,t:q.ts,reference:index.ts,label:'同時段期現貨價差'}:
  closeReady?{points:q.price-indexClose.c,t:q.ts,reference:indexClose.t,label:'相對現貨收盤'}:null;
 const companion=d.futurePair?.q;
 const key=futureSessionKey(q?.ts),pairReady=q&&!q.error&&!q.closing&&key&&companion&&key===futureSessionKey(companion.ts)&&
  Math.abs(companion.ts-q.ts)<=90000&&valid(q.price)&&valid(companion.price);
 const spread=pairReady?{recent:fresh(q)&&fresh(companion),points:m.contract==='次月'?q.price-companion.price:companion.price-q.price,selectedAt:q.ts,otherAt:companion.ts}:null;
 const oi=Number.isFinite(last?.oi)&&last.oi>=0?{value:last.oi,change:last.contract===prev?.contract&&Number.isFinite(prev.oi)?last.oi-prev.oi:NaN,
  at:last.t,previousAt:prev?.t,contract:last.contract}:null;
 return {month,day,night,basis,spread,oi,review:futureReview(q,day,night)};
}
function futureNote(parts){
 return (Array.isArray(parts)?parts:[parts]).map(part=>{
  if(typeof part==='string')return esc(part);
  const [text,tone='neutral']=part;
  return '<strong class="future-emphasis '+tone+'">'+esc(text)+'</strong>';
 }).join('');
}
function futureSessionReading(day,night,points,priorSettlement){
 if(!day&&!night)return '等待日盤或夜盤資料。';
 const dayRange=futureRangePosition(day?.c,day?.l,day?.h);
 const closeLocation=dayRange>=.8?'靠近日高':dayRange<=.2?'靠近日低':Number.isFinite(dayRange)?'落在日內區間中段':'';
 if(!day?.report||!night||day.sessionKey.slice(4)!==night.sessionKey.slice(6)||
  (night.contract&&night.contract!==day.contract)||!valid(night.c)){
  return closeLocation?['日盤'+(day.report?'收盤':'最近價'),[closeLocation,toneFor(dayRange>=.8?1:dayRange<=.2?-1:0)],
   '。待取得同交易循環的日盤收盤與夜盤報價後，可比較兩段走勢。']:
   '等待同交易循環的日盤收盤與夜盤報價，再比較兩段走勢。';
 }
 const delta=night.c-day.c;
 const direction=delta>0?'高 '+points(delta).slice(1):delta<0?'低 '+points(delta).slice(1):'持平';
 const reading=['夜盤最近價較日盤收盤',[direction,toneFor(delta)]];
 if(day.delta>=.3&&delta<0&&valid(priorSettlement))
  reading.push('，',['日盤漲幅'+(night.c<=priorSettlement?'已回吐':'回吐一部分'),'down']);
 else if(day.delta<=-.3&&delta>0&&valid(priorSettlement))
  reading.push('，',['日盤跌幅'+(night.c>=priorSettlement?'已收復':'收復一部分'),'up']);
 reading.push('。');
 if(closeLocation)reading.push('日盤收盤',[closeLocation,toneFor(dayRange>=.8?1:dayRange<=.2?-1:0)],'。');
 return reading;
}
function futureAnalysisView(m,q,d){
 const x=futureContext(m,q,d),n=digit(m);
 const points=v=>(v>0?'+':v<0?'−':'')+fmt(Math.abs(v),n)+' 點';
 const stamp=t=>Number.isFinite(t)?twDate(t)+' '+twTime(t):'—';
 const section=(title,value,detail)=>'<div class="insight-row"><b>'+esc(title)+'</b><p class="num">'+futureNote(value)+'</p><p class="sub">'+futureNote(detail)+'</p></div>';
 const position=futurePositionRows(m.id),latest=position[0],previous=positionCompare(position);
 const foreign=latest?.products[m.id]?.外資;
 const prior=d.daily?.bars.at(-2),sameContract=prior?.contract&&prior.contract===x.day?.contract;
 const sessions=[['日盤',x.day],['夜盤',x.night]].map(([label,r])=>r?section(label,
  ['開 '+fmt(r.o,n)+' · 最近 ',[fmt(r.c,n)],' · 漲跌 ',[signed(r.delta),toneFor(r.delta)],
   ' · 高低 '+fmt(r.l,n)+'～'+fmt(r.h,n)+' · 量 '+fmt(r.v,0)+' 口'],
  (r.report?'官方報表':'Yahoo 報價快照')+' · '+stamp(r.t)+(r.contract?' · 契約 '+r.contract:'')):
  section(label,'—','尚未取得對應的時段資料。')).join('');
 const basis=x.basis,spread=x.spread;
 return '<div class="row between wrap insight-head"><strong>期貨分析</strong><span class="example">'+esc(m.contract||'近月')+'</span></div>'+
  '<div class="research-body" tabindex="0" role="region" aria-label="期貨數據">'+section('日夜盤解讀',futureSessionReading(x.day,x.night,points,sameContract?prior.settlement:NaN),
   '日夜盤以同一交易循環比較；夜盤快照隨報價時間變動。')+sessions+
  (hasTaiexBasis(m)?basis?section(basis.label,[[points(basis.points),toneFor(basis.points)]],
   [basis.points<0?'期貨低於現貨參考價。':basis.points>0?'期貨高於現貨參考價。':'期貨與現貨參考價相同。',
    ...(basis.label==='相對現貨收盤'?[' ',['跨時點比較','caution'],'。']:[]),' 期貨 '+stamp(basis.t)+' · 現貨 '+stamp(basis.reference)]):
   section('期現貨價差','—','等待時間可對照的現貨參考價。'):'')+
  (spread?section(spread.recent?'次月 − 近月':'次月 − 近月（最近可比報價）',[[points(spread.points),toneFor(spread.points)]],
   (spread.points>0?'次月高於近月。':spread.points<0?'次月低於近月。':'近月與次月同價。')+' 追蹤契約 '+stamp(spread.selectedAt)+' · 對照契約 '+stamp(spread.otherAt)):
   section('次月 − 近月','—','兩筆報價須來自同一時段且相差不超過 90 秒。'))+
  (foreign?section('外資盤後留倉',[...foreignPositionReading(foreign,previous?.products[m.id]?.外資),'。'],
   latest.date+' · 各契約合計。多單、空單及歷史變化請見「盤後部位」。'):'')+
  '</div>';
}
