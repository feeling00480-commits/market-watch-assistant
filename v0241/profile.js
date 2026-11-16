const profileRanges=[1,5,20,30];
const profileLabel=days=>days===1?'當日':days+' 個交易日';
const concreteFutureSymbol=(m,month)=>futuresProducts[m.id].symbol+'FGHJKMNQUVXZ'[Number(month.slice(4))-1]+month[3];
function loadProfile(m,d){
 if(m.id==='TAIEX')return;
 const future=isFuture(m),month=d.daily?.bars.at(-1)?.contract;
 if(future&&selected()===m&&state.period==='profile')loadOfficialProfile(m,d,state.profileDays);
 if(d.profileLoading)return;
 if(future&&!month||d.profileAttemptMonth===month&&Date.now()-(d.profileAttempt||0)<5*60000)return;
 d.profileAttempt=Date.now();d.profileAttemptMonth=month;d.profileLoading=true;
 const symbol=future?concreteFutureSymbol(m,month):symbolFor(m);
 const market=future?{...m,profileSymbol:symbol}:m;
 yahooChart(market,'60d','15m').then(r=>{
  if(r.meta.dataGranularity!=='15m')throw new Error('來源未提供 15 分 K');
  d.profileHistory=chartBars(r).filter(b=>b.complete&&valid(b.v));
  d.profileHistoryMonth=month;
 }).catch(()=>{
  if(future)return;
  return intradayHistory(m).then(h=>{d.profileHistory=h.bars;}).catch(()=>{});
 }).finally(()=>{
  d.profileLoading=false;
  if(selected()===m&&state.details.get(m.id)===d&&state.period==='profile')drawChart();
 });
}
function futureIntradayProfile(q,now){
 if(!q||q.closing||q.error||!q.barMinutes||!Number.isFinite(q.ts)||q.ts>now+60000)return null;
 const session=futureSessionKey(q.ts),current=futureSessionKey(now);
 if(!session||(current?session!==current:twDate(q.ts)!==twDate(now)))return null;
 const rows=(q.bars||[]).filter(b=>b.complete&&valid(b.v)&&b.t<=q.ts&&futureSessionKey(b.t)===session);
 if(!rows.length)return null;
 return {dates:[session.slice(6)],exact:false,rows,session:session.startsWith('night:')?'夜盤':'日盤',last:rows.at(-1).t};
}
function profileInput(m,q,d,days,forAlert=false){
 const future=isFuture(m),month=d.daily?.bars.at(-1)?.contract;
 const importedMonth=forAlert?month:d.profileImportMonth||month;
 const imported=d.profileTrades?.get(importedMonth);
 const now=Date.now(),today=marketDate(m,now);
 const daySession=future?futureSessionKey(now):'';
 const cutoff=future&&daySession.startsWith('night:')?daySession.slice(6):today;
 const intraday=future&&days===1&&!forAlert&&!d.profileImportMonth?futureIntradayProfile(q,now):null;
 if(intraday&&daySession)return intraday;
 const official=future?officialProfileInput(m,d,days,forAlert,now):null;
 if(official&&(!forAlert||official.dates.length>=days))return official;
 if(imported?.size){
  // TAIFEX dates attribute the night session to the following trading date.
  const dates=[...imported.keys()].filter(date=>forAlert?date<today||date===today&&twTime(now)>='14:00:00':
   days===1?date===today&&!daySession.startsWith('night:'):date<=today).sort().slice(-days);
  if(dates.length)return {dates,month:importedMonth,exact:true,rows:dates.flatMap(date=>[...imported.get(date)].map(([c,v])=>({c,v})))};
 }
 if(intraday)return intraday;
 if(m.id==='TAIEX')return null;
 const byDay=new Map();
 for(const b of d.profileHistory||[]){
  if(b.t>now||future&&d.profileHistoryMonth!==month)continue;
  // Keep the historical estimate to day-session bars for an explicit contract.
  if(future&&!futureSessionKey(b.t).startsWith('day:'))continue;
  const date=marketDate(m,b.t);
  if(!byDay.has(date))byDay.set(date,[]);
  byDay.get(date).push(b);
 }
 if(!forAlert&&!future&&q&&!q.closing&&!q.error&&q.barMinutes){
  const date=marketDate(m,q.ts);
  const current=(q.bars||[]).filter(b=>b.complete&&valid(b.v)&&b.t<=q.ts&&marketDate(m,b.t)===date);
  const prior=byDay.get(date);
  if(current.length&&(!prior?.length||(current[0].t<=prior[0].t&&current.at(-1).t>=prior.at(-1).t))){
   byDay.set(date,current);
  }
 }
 const dates=[...byDay.keys()].filter(date=>forAlert?date<cutoff:days===1?date===today&&!daySession.startsWith('night:'):date<=today).sort().slice(-days);
 if(!dates.length)return null;
 const rows=dates.flatMap(date=>byDay.get(date));
 return {dates,month,exact:false,rows,session:future?'日盤':'',last:rows.at(-1).t};
}
function priceProfile(input,digits){
 if(!input?.rows.length)return null;
 let low=Infinity,high=-Infinity;
 for(const b of input.rows){
  low=Math.min(low,b.l??b.c);high=Math.max(high,b.h??b.c);
 }
 if(!valid(low)||!valid(high)||high<low||high>1e9)return null;
 const scale=10**digits,target=Math.max(1,(high-low)*scale/35),order=10**Math.floor(Math.log10(target));
 const step=([1,2,5,10].find(n=>n*order>=target)||10)*order;
 const index=price=>Math.floor((Math.round(price*scale)+1e-8)/step);
 const first=index(low),last=index(high);
 const bands=Array.from({length:last-first+1},(_,i)=>({lo:(first+i)*step/scale,hi:(first+i+1)*step/scale,v:0}));
 let total=0;
 for(const b of input.rows){
  if(!valid(b.v))continue;
  const a=index(b.l??b.c),z=index(b.h??b.c),weight=b.v/(z-a+1);
  for(let i=a;i<=z;i++)bands[i-first].v+=weight;
  total+=b.v;
 }
 if(!total)return null;
 const peak=bands.reduce((a,b)=>b.v>a.v?b:a);
 const zones=[];
 for(const b of bands){
  if(b.v<peak.v*.5)continue;
  const prev=zones.at(-1);
  if(prev?.hi===b.lo){prev.hi=b.hi;prev.v+=b.v;}
  else zones.push({...b});
 }
 return {...input,bands,total,peak,zones};
}
function profileReadout(profile,price,m){
 const label=b=>fmt(b.lo,digit(m))+'～'+fmt(b.hi,digit(m));
 const active=valid(price)&&profile.zones.find(b=>price>=b.lo&&price<b.hi);
 const above=valid(price)&&profile.zones.find(b=>price<b.lo);
 const below=valid(price)&&profile.zones.findLast(b=>price>=b.hi);
 const gap=valid(price)&&Math.min(above?(above.lo/price-1)*100:Infinity,below?(1-below.hi/price)*100:Infinity);
 const priceText=n=>fmt(n,digit(m));
 let text='缺少可比較的最新價，先看成交量集中的價帶';
 if(active)text='現價在密集區內，留意 '+priceText(active.hi)+' 能否站上、'+priceText(active.lo)+' 能否守住';
 else if(above&&below)text='往上到 '+priceText(above.lo)+' 可能遇壓，下探 '+priceText(below.hi)+' 留意支撐';
 else if(above)text='反彈到 '+priceText(above.lo)+'，可能先遇到賣壓';
 else if(below)text='回落到 '+priceText(below.hi)+'，先看能否守住';
 else if(valid(price))text='附近成交較分散，暫時看不出明顯支撐或壓力';
 return {label,active,above,below,gap,text};
}
const profileZoomSteps=[1,1.16,1.32,1.5];
function profileZoomSizes(count){
 return [...new Set(profileZoomSteps.map(scale=>Math.min(count,Math.max(6,Math.round(count/scale)))))];
}
function profileViewport(bands,level,current){
 const count=profileZoomSizes(bands.length)[level];
 const anchor=bands.findIndex(b=>current>=b.lo&&current<b.hi);
 const center=anchor<0?Math.floor(bands.length/2):anchor;
 const start=Math.max(0,Math.min(bands.length-count,center-Math.floor(count/2)));
 return bands.slice(start,start+count);
}
function profileMarkers(info,profile,current,min,max,digits){
 const mid=b=>b?(b.lo+b.hi)/2:NaN;
 const markers=[
  {type:'latest',name:'最新價',value:fmt(current,digits),price:current},
  {type:'peak',name:'最大成交價帶',value:info.label(profile.peak),price:mid(profile.peak)},
  {type:'pressure',name:'上方密集區／可能壓力',value:info.above?info.label(info.above):'—',price:mid(info.above)},
  {type:'support',name:'下方密集區／可能支撐',value:info.below?info.label(info.below):'—',price:mid(info.below)}
 ];
 for(const item of markers){
  const {price}=item;
  item.y=valid(price)?Math.max(10,Math.min(290,10+280*(max-price)/(max-min))):null;
  item.outside=valid(price)&&(price<min?'↓ 圖外':price>max?'↑ 圖外':'');
 }
 markers.sort((a,b)=>(a.y??Infinity)-(b.y??Infinity));
 markers.forEach((item,i)=>{
  const end=280-(markers.length-1-i)*44;
  const start=i?markers[i-1].labelY+44:102;
  item.labelY=Math.max(start,Math.min(end,item.y??end));
 });
 return markers;
}
function profileBoard(m,q,d,profile){
 const future=isFuture(m),digits=digit(m),unit=future?'口':'股';
 const current=valid(q?.price)&&(!profile.month||!future||profile.month===d.daily?.bars.at(-1)?.contract)?q.price:NaN;
 const info=profileReadout(profile,current,m);
 const signal=valid(current)?profileSignal(m,q,d):null;
 const zoomMax=profileZoomSizes(profile.bands.length).length-1;
 const zoom=Math.min(zoomMax,d.profileZoom||0);
 const bands=profileViewport(profile.bands,zoom,current);
 const max=bands.at(-1).hi,min=bands[0].lo;
 const rowHeight=280/bands.length,axisEvery=Math.max(1,Math.ceil(bands.length/14));
 const chart=bands.slice().reverse().map((b,i)=>{
  const title=info.label(b)+' · '+(profile.exact?'':'約 ')+fmt(b.v,0)+' '+unit+' · '+fmt(b.v/profile.total*100,1)+'%'+
   (valid(current)?' · 距現價 '+fmt((((b.lo+b.hi)/2)/current-1)*100,2)+'%':'');
  const selected=b===profile.peak;
  return '<div class="profile-band" tabindex="0" title="'+esc(title)+'" aria-label="'+esc(title)+'" role="img" style="top:'+
   ((10+i*rowHeight)/3)+'%;height:'+(rowHeight/3)+'%">'+
   (i%axisEvery===0?'<span class="profile-axis">'+fmt(b.lo,digits)+'</span>':'')+
   '<span class="profile-bar '+(selected?'profile-peak':'')+'" style="width:'+(78*b.v/profile.peak.v)+'%"></span></div>';
 }).join('');
 const markers=profileMarkers(info,profile,current,min,max,digits);
 const lines=markers.filter(item=>item.y!==null).map(item=>
  '<path class="profile-'+item.type+'" d="M 105 '+item.y+' H 530 L 582 '+item.labelY+' H 602"/>').join('');
 const labels=markers.map(item=>'<div class="profile-marker profile-'+item.type+'" style="top:'+(item.labelY/3)+'%">'+
  '<span>'+item.name+'</span><b>'+item.value+'</b>'+(item.outside?'<small>'+item.outside+'</small>':'')+'</div>').join('');
 return '<div class="profile-board" data-el="profileBoard"><div class="profile-plot" role="group" aria-label="價位與成交量分布">'+chart+
  '</div><svg class="profile-connectors graph" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">'+lines+'</svg>'+
  '<div class="profile-side"><h3 class="profile-verdict '+(signal?.tone||'neutral')+'">'+esc(signal?.text||info.text)+'</h3>'+labels+'</div></div>'+
  '<div class="row between wrap profile-caption"><p class="sub">'+esc((profile.official?'期交所官方逐筆 · 不含鉅額':profile.exact?'期交所逐筆 CSV · 不含鉅額':'分 K 估算')+
   ' · '+profile.dates[0]+' ～ '+profile.dates.at(-1)+' · '+profile.dates.length+'／'+state.profileDays+' 日'+
   (profile.month?' · 契約 '+profile.month:'')+(profile.session?' · '+profile.session:'')+(profile.last?' · 截至 '+twTime(profile.last)+' 台北':'')+
   ' · 單位 '+unit)+'</p><div class="switch profile-zoom" aria-label="分價圖縮放">'+
   '<button data-act="profileZoom" data-id="out" aria-label="縮小分價圖"'+(!zoom?' disabled':'')+'>−</button>'+
   '<button data-act="profileZoom" data-id="reset" title="顯示完整價格區間" aria-label="顯示分價圖全圖">全圖</button>'+
   '<button data-act="profileZoom" data-id="in" aria-label="放大分價圖"'+(zoom>=zoomMax?' disabled':'')+'>＋</button></div></div>'+
  '<details><summary>查看價帶與成交量</summary><div class="data-table"><table class="book num"><thead><tr><th>價帶</th><th>成交量（'+unit+'）</th><th>占比</th></tr></thead><tbody>'+
   profile.bands.slice().reverse().filter(b=>b.v>0).map(b=>'<tr><th scope="row">'+info.label(b)+'</th><td>'+fmt(b.v,0)+'</td><td>'+fmt(b.v/profile.total*100,1)+'%</td></tr>').join('')+
   '</tbody></table></div></details>';
}
function zoomPriceProfile(m,d,direction){
 const maximum=profileZoomSizes(d.profilePreview?.bands.length||0).length-1;
 const previous=d.profileZoom||0;
 const next=direction===0?0:Math.min(maximum,Math.max(0,previous+direction));
 if(next===previous)return;
 d.profileZoom=next;drawPriceProfile(m,quoteFor(m),d);
}
function drawPriceProfile(m,q,d){
 const host=el('priceProfile'),future=isFuture(m),days=state.profileDays;
 const profile=priceProfile(profileInput(m,q,d,days),digit(m));
 d.profilePreview=profile;
 const controls='<div class="row between wrap profile-tools"><div class="switch" aria-label="分價統計期間">'+profileRanges.map(n=>
  '<button data-act="profileRange" data-id="'+n+'" aria-pressed="'+(n===days)+'">'+profileLabel(n)+'</button>').join('')+'</div>'+
  (future?'<label class="sub profile-import">匯入期交所逐筆 CSV<input data-el="profileFile" type="file" accept=".csv,text/csv" multiple></label>':'')+'</div>';
 const months=[...(d.profileTrades?.keys()||[])].sort();
 const picker=months.length?'<label class="sub">逐筆資料契約 <select data-el="profileContract"><option value="">依追蹤契約</option>'+months.map(month=>
  '<option '+(month===d.profileImportMonth?'selected ':'')+'value="'+month+'">'+month+'</option>').join('')+'</select></label>':'';
 const autoStatus=d.officialProfileLoading?'正在取得官方逐筆 '+(d.officialProfileProgress||'') : d.officialProfileError||'';
 const status='<p class="sub" data-el="profileStatus" aria-live="polite">'+esc([autoStatus,d.profileImportStatus].filter(Boolean).join(' · '))+'</p>';
 let body;
 if(!profile){
  const text=m.id==='TAIEX'?'加權指數本身沒有可按指數價位累計的成交量。':
   d.profileLoading||d.officialProfileLoading?'正在讀取分價資料…':future?'目前沒有足夠的同契約資料，可手動匯入逐筆 CSV。':'此期間沒有足夠的分 K 成交量資料。';
  body=review(text);
 }else body=profileBoard(m,q,d,profile);
 const opened=host.querySelector('details')?.open;
 const focus=document.activeElement;
 const restore=host.contains(focus)&&['profileZoom','profileRange'].includes(focus.dataset?.act)?focus.dataset:null;
 const next=controls+picker+status+body+(future?'<p class="sub profile-help"><a href="https://www.taifex.com.tw/cht/3/futPrevious30DaysSalesData" target="_blank" rel="noopener noreferrer">下載期交所逐筆 CSV</a> · 手動匯入備援，可一次選取多天 CSV。</p>':'');
 if(d.profileMarkup===next&&host.dataset.stock===analysisStock(m))return;
 host.dataset.stock=analysisStock(m);d.profileMarkup=next;host.innerHTML=next;
 if(opened&&host.querySelector('details'))host.querySelector('details').open=true;
 if(restore){
  const controls=[...host.querySelectorAll('button')];
  const same=controls.find(b=>b.dataset.act===restore.act&&b.dataset.id===restore.id);
  (same?.disabled?controls.find(b=>b.dataset.act==='profileZoom'&&b.dataset.id==='reset'):same)?.focus({preventScroll:true});
 }
}
async function importProfileFiles(m,d,files){
 if(d.profileImporting||!files.length)return;
 d.profileImporting=true;
 let accepted=0,rejected=0;
 d.profileTrades??=new Map();
 try{
  for(const file of files.slice(0,30)){
   try{
    if(file.size>100000000)throw new Error('CSV 過大');
    const bytes=await file.arrayBuffer();
    let csv=new TextDecoder().decode(bytes);
    if(!csv.includes('商品代號'))csv=new TextDecoder('big5').decode(bytes);
    const data=parseProfileTrades(csv,m.id);
    if(!data.size)throw new Error('沒有可用的逐筆成交');
    for(const [month,dates] of data){
     if(!d.profileTrades.has(month))d.profileTrades.set(month,new Map());
     for(const [date,bands] of dates)d.profileTrades.get(month).set(date,bands);
    }
    accepted++;
   }catch{rejected++;}
  }
  const known=d.daily?.bars.at(-1)?.contract;
  if(!d.profileTrades.has(known)&&d.profileTrades.size===1)d.profileImportMonth=d.profileTrades.keys().next().value;
  d.profileAlertReference=null;
  d.profileImportStatus='已匯入 '+accepted+' 個檔案'+(rejected?'，'+rejected+' 個檔案無法讀取或沒有此商品':'')+'。';
 }finally{
  d.profileImporting=false;
  if(selected()===m&&state.details.get(m.id)===d&&state.period==='profile')drawChart();
 }
}
function parseProfileTrades(csv,product){
 const [header,...lines]=csv.replace(/^\uFEFF/,'').split(/\r?\n/),fields=line=>line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));
 const names=fields(header).map(x=>x.replaceAll('（','(').replaceAll('）',')').replace(/\s+/g,''));
 const dateColumn=names.includes('交易日期')?'交易日期':'成交日期';
 const columns=[dateColumn,'商品代號','到期月份(週別)','成交價格','成交數量(B+S)'].map(k=>names.indexOf(k));
 if(columns.some(i=>i<0))return new Map();
 const [day,id,contract,price,qty]=columns,out=new Map();
 for(const line of lines){
  const row=fields(line);
  if(row[id]!==product||!/^\d{4}(0[1-9]|1[0-2])$/.test(row[contract]))continue;
  const raw=row[day]?.replaceAll('/','').replaceAll('-','');
  if(!/^\d{8}$/.test(raw||''))continue;
  const date=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
  const t=Date.parse(date+'T00:00:00+08:00'),c=number(row[price]),v=number(row[qty])/2;
  if(!Number.isFinite(t)||twDate(t)!==date||!valid(c)||c>1e9||!Number.isSafeInteger(v)||v<=0)continue;
  if(!out.has(row[contract]))out.set(row[contract],new Map());
  const byDay=out.get(row[contract]);
  if(!byDay.has(date))byDay.set(date,new Map());
  const bands=byDay.get(date);
  bands.set(c,(bands.get(c)||0)+v);
 }
 return out;
}
function profileAlertReference(m,d){
 const month=d.daily?.bars.at(-1)?.contract,now=Date.now();
 const key=[marketDate(m,now),isFuture(m)?futureSessionKey(now):'',month].join('/');
 const source=d.profileHistory, trades=d.profileTrades?.get(month);
 const old=d.profileAlertReference;
 if(old?.key===key&&old.source===source&&old.trades===trades)return old;
 const profile=priceProfile(profileInput(m,null,d,20,true),digit(m));
 const zone=profile?.dates.length>=20?profile.zones.find(b=>profile.peak.lo>=b.lo&&profile.peak.lo<b.hi):null;
 return d.profileAlertReference={key,source,trades,profile,zone};
}
function profileSignal(m,q,d){
 if(isFuture(m)||!fresh(q)||q.error||!valid(q.prev))return null;
 const ratio=metrics(m,q,d.daily?.bars).ratio;
 if(!(ratio>=1.5))return null;
 const {zone}=profileAlertReference(m,d);
 if(!zone)return null;
 const side=q.prev>=zone.lo&&q.prev<zone.hi?(q.price>=zone.hi?1:q.price<zone.lo?-1:0):0;
 if(!side)return null;
 return {tone:toneFor(side),text:side>0?'帶量站上主要密集區，回測 '+fmt(zone.hi,digit(m))+' 看能否守住':
  '帶量跌破主要密集區，反彈到 '+fmt(zone.lo,digit(m))+' 可能遇壓'};
}
function checkProfileAlert(m,q,d){
 if(!fresh(q)||q.error)return;
 const {profile,zone}=profileAlertReference(m,d);
 if(!zone)return;
 const session=isFuture(m)?futureSessionKey(q.ts):marketDate(m,q.ts);
 if(!session)return;
 const key=[session,profile.dates.at(-1),profile.month,profile.exact,zone.lo,zone.hi].join('/');
 const side=q.price>=zone.hi?1:q.price<zone.lo?-1:0;
 const prior=d.profileAlert;
 if(!prior||prior.key!==key){d.profileAlert={key,side,confirmed:side,ts:q.ts,count:1,last:prior?.last};return;}
 if(q.ts<=prior.ts)return;
 prior.ts=q.ts;
 prior.count=side===prior.side?prior.count+1:1;
 prior.side=side;
 if(prior.count<2||prior.confirmed===side)return;
 if(!side){prior.confirmed=side;return;}
 if(q.ts-(prior.last||0)<(state.rules[m.id]?.cooldown??10)*60000)return;
 prior.confirmed=side;prior.last=q.ts;
 const body=(side>0?'突破':'跌破')+'近 20 日主要成交密集區 '+profileReadout(profile,q.price,m).label(zone)+(profile.exact?'':'（分 K 估算）')+'，連續兩筆確認';
 addEvent(m,q,body,'alert',3,side>0?'rising':'falling');
 telegramSend(m.name+' '+fmt(q.price,digit(m))+'｜'+body,true);
}
