const canAlertTradeSides=m=>marketMode(m)==='stock'&&m.id!=='TAIEX';
const alertModes={
 stock:{label:'台股',burst:1.5,volume:2,guide:'一般交易時段監控。上市櫃個股可用內外盤新增成交量判讀買賣偏向；指數只看價格。'},
 futures:{label:'期貨',burst:.8,volume:2.5,guide:'日盤、夜盤和契約分開計算。用新增成交口數偵測放量，方向只標示同期價格漲跌。'},
 us:{label:'美股',burst:1.5,volume:2.5,guide:'美東一般盤、美元計價。用新增成交股數偵測放量，延遲報價不觸發。'},
 esb:{label:'興櫃',burst:3,volume:3,guide:'興櫃交易時段依新成交價判斷。用新增成交量偵測放量；雙邊報價另用來提醒價差擴大。'}
};
function alertSession(m,q,now=Date.now()){
 if(!q||q.error||q.delayed||q.closing||!Number.isFinite(q.ts)||q.ts>now+60000||now-q.ts>maxAge)return '';
 if(isFuture(m)){
  const key=futureSessionKey(q.ts);
  return key&&key===futureSessionKey(now)?(m.contract||'近月')+':'+key:'';
 }
 const date=marketDate(m,q.ts);
 if(date!==marketDate(m,now))return '';
 if(isUS(m)){
  const start=q.regularStart,end=q.regularEnd;
  if(Number.isFinite(start)&&Number.isFinite(end)&&marketDate(m,start)===date&&end>start)
   return q.ts>=start&&q.ts<end&&now>=start&&now<end?date:'';
  const regular=t=>{const clock=modeET.format(t).slice(-8);return clock>='09:30:00'&&clock<'16:00:00';};
  return regular(q.ts)&&regular(now)?date:'';
 }
 const close=m.exchange==='esb'?'15:00:00':'13:33:00';
 const regular=t=>twTime(t)>='09:00:00'&&twTime(t)<close;
 return regular(q.ts)&&regular(now)?date:'';
}
function volumeActivity(samples,kind){
 const last=samples.at(-1),prev=samples.at(-2);
 if(!prev)return null;
 const points=[];
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],minutes=(b.t-a.t)/60000;
  if(minutes<.15||minutes>6)continue;
  const volume=b.v-a.v;
  if(volume<0)continue;
  points.push({t:b.t,rate:volume/minutes,volume,minutes,price:b.price,from:a.price,
   buy:kind==='sides'?b.buy-a.buy:NaN,sell:kind==='sides'?b.sell-a.sell:NaN});
 }
 const latest=points.at(-1);
 if(latest?.t!==last.t||points.length<6)return null;
 const rates=points.slice(-13,-1).map(p=>p.rate).sort((a,b)=>a-b),center=(rates.length-1)/2;
 const baseline=(rates[Math.floor(center)]+rates[Math.ceil(center)])/2;
 if(!valid(baseline))return null;
 return {...latest,ratio:latest.rate/baseline};
}
function activitySample(series,source,sample){
 if(series.source!==source){series.source=source;series.samples=[];}
 const rows=series.samples,last=rows.at(-1);
 if(last&&sample.t<=last.t)return;
 if(last&&(sample.v<last.v||sample.buy<last.buy||sample.sell<last.sell||sample.t-last.t>6*60000))rows.length=0;
 series.samples=[...rows,sample].slice(-14);
}
function observeAlertActivity(m,q,detail,session){
 const a=detail.alertActivity?.session===session?detail.alertActivity:
  (detail.alertActivity={session,prices:[],volume:{samples:[]},sides:{samples:[]}});
 if(a.priceSource!==q.source){a.priceSource=q.source;a.prices=[];}
 a.prices=[...a.prices.filter(p=>q.ts-p.t<=5*60000),{t:q.ts,price:q.price}];
 const base=a.prices.find(p=>q.ts-p.t>=2*60000);
 a.jump=base?{delta:100*(q.price/base.price-1),minutes:(q.ts-base.t)/60000}:null;
 a.latest=q.ts;
 if(Number.isFinite(q.activityVolume)&&q.activityVolume>=0)
  activitySample(a.volume,q.source+'|'+(q.volumeUnit||''),{t:q.ts,v:q.activityVolume,price:q.price});
 const sides=canAlertTradeSides(m)&&detail.tradeSides;
 if(sides&&[sides.inside,sides.outside].every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(sides.ts)&&sides.ts<=Date.now()+60000&&Date.now()-sides.ts<=maxAge&&Math.abs(sides.ts-q.ts)<=maxAge&&twDate(sides.ts)===twDate(q.ts))
  activitySample(a.sides,sides.source,{t:sides.ts,v:sides.inside+sides.outside,buy:sides.outside,sell:sides.inside,price:q.price});
}
function marketAlertSignals(m,q,rule,detail){
 const a=detail?.alertActivity, jump=a&&a.latest===q?.ts?a.jump:null;
 const volume=a&&a.volume.samples.at(-1)?.t===q?.ts?volumeActivity(a.volume.samples):null;
 const side=a?.sides.samples.at(-1),sides=side&&Date.now()-side.t<=maxAge&&side.t<=Date.now()+60000&&Math.abs(side.t-q?.ts)<=maxAge?volumeActivity(a.sides.samples,'sides'):null;
 const spread=marketMode(m)==='esb'?esbQuoteSpread(q):null;
 const hits=[], measurable={spikeUp:!!jump,spikeDown:!!jump,turnover:!!volume,buyPressure:!!sides,sellPressure:!!sides,
  wideSpread:!!spread&&Math.abs(spread.ts-q?.ts)<=maxAge};
 if(rule.burst>0&&jump&&Math.abs(jump.delta)>=rule.burst)
  hits.push([jump.delta>0?'spikeUp':'spikeDown','近 '+fmt(jump.minutes,1)+' 分鐘'+(jump.delta>0?'急漲 ':'急跌 ')+signed(jump.delta),2]);
 if(rule.volume>0&&volume?.ratio>=rule.volume&&volume.volume>0){
  const priceChange=volume.price-volume.from;
  const quantity=quoteVolume({...q,volume:volume.volume},m);
  hits.push(['turnover','成交量突增 '+fmt(volume.ratio,1)+' 倍（近 '+fmt(volume.minutes,1)+' 分鐘 '+quantity+'），同期價格'+(priceChange>0?'上升':priceChange<0?'下跌':'持平'),3]);
 }
 if(rule.sidePct>=51&&rule.sidePct<=100&&sides?.ratio>=(rule.volume||2)&&sides.volume>0){
  const outside=100*sides.buy/sides.volume, inside=100*sides.sell/sides.volume;
  if(Math.max(outside,inside)>=rule.sidePct)
   hits.push([outside>inside?'buyPressure':'sellPressure','新增成交量 '+fmt(sides.ratio,1)+' 倍，'+
    (outside>inside?'外盤偏多 ':'內盤偏多 ')+fmt(Math.max(outside,inside),0)+'%（分類 '+fmt(sides.volume,2)+' 張）',2]);
 }
 if(rule.spread>0&&measurable.wideSpread&&spread.pct>=rule.spread)
  hits.push(['wideSpread','來源買賣價差擴大至 '+fmt(spread.pct)+'%',3]);
 return {hits,measurable};
}
