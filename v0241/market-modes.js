const marketModes={
 stock:{label:'台股',tabs:{research:'分析',news:'新聞',quotes:'行情明細',chips:'籌碼',financial:'財務'}},
 futures:{label:'期貨模式',tabs:{research:'合約總覽',quotes:'行情明細',positions:'盤後部位',news:'市場新聞'}},
 us:{label:'美股模式',tabs:{research:'市場總覽',quotes:'美元行情',news:'相關新聞'}},
 esb:{label:'興櫃模式',tabs:{research:'報價與成交',quotes:'成交明細',financial:'公司營收',news:'相關新聞'}}
};
const marketMode=m=>isFuture(m)?'futures':isUS(m)?'us':m.exchange==='esb'?'esb':'stock';
const modeET=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const modeStamp=t=>Number.isFinite(t)?twDate(t)+' '+twTime(t):'—';
const modeUsd=n=>valid(n)?'US$ '+fmt(n):'—';
const usBenchmarks=['SPY','QQQ'].map(symbol=>({id:'US:'+symbol,name:symbol,exchange:'us'}));
function usMarketContext(){
 return memo('us-market-context',60000,async()=>{
  const result=await Promise.allSettled(usBenchmarks.map(m=>liveQuote(m)));
  const rows=result.flatMap((r,i)=>r.status==='fulfilled'?[{name:usBenchmarks[i].name,...r.value}]:[]);
  if(!rows.length)throw new Error('美股對照行情暫時無法取得');
  return rows;
 });
}
const modePoints=(m,n)=>Number.isFinite(n)?(n>0?'+':'')+fmt(n,digit(m))+' 點':'—';
function esbQuoteSpread(q){
 const {bid,ask}=q?.dealerQuote||{};
 if(!valid(bid)||!valid(ask)||ask<bid)return null;
 const gap=ask-bid;
 return {bid,ask,gap,pct:gap/((bid+ask)/2)*100,ts:q.dealerQuote.ts};
}
function futureChartQuote(q,d){
 const current=futureSessionKey(q?.ts);
 const side=d.futureChartSession||current.split(':')[0];
 if(!side)return q;
 const held=d.futureSessionQuotes?.[side];
 const known=current.startsWith(side+':')&&!q.closing?q:held;
 const available=(q?.bars||[]).filter(bar=>Number.isFinite(q?.ts)&&bar.t<=q.ts&&futureSessionKey(bar.t).startsWith(side+':'));
 const availableKey=futureSessionKey(available.at(-1)?.t);
 const knownKey=futureSessionKey(known?.ts);
 const session=availableKey>knownKey?availableKey:knownKey;
 if(!session)return null;
 const bars=new Map();
 if(knownKey!==session||known.barMinutes===q?.barMinutes){
  for(const bar of available)if(futureSessionKey(bar.t)===session)bars.set(bar.t,bar);
 }
 for(const bar of known?.bars||[]){
  if(bar.t<=known.ts&&futureSessionKey(bar.t)===session)bars.set(bar.t,bar);
 }
 const rows=[...bars.values()].sort((a,b)=>a.t-b.t);
 const label=side==='night'?'夜盤':'日盤';
 if(known&&session===knownKey)return {...known,bars:rows,chartSource:known.source+' · '+label};
 return rows.length?{bars:rows,barMinutes:q?.barMinutes,ts:rows.at(-1).t,source:q.source,chartSource:q.source+' · '+label}:null;
}
function marketModeHeader(m,q,d){
 const mode=marketMode(m),badge=el('marketMode'),strip=el('modeSummary');
 el('detail').dataset.mode=mode;
 badge.hidden=strip.hidden=mode==='stock';
 badge.textContent=marketModes[mode].label;
 if(mode==='stock')return;
 const card=(title,value,sub='')=>'<div class="mode-stat"><span>'+esc(title)+'</span><b>'+esc(value)+'</b>'+
  (sub?'<small>'+esc(sub)+'</small>':'')+'</div>';
 let cards='',extra='';
 if(mode==='futures'){
  const x=futureContext(m,q,d),row=d.daily?.bars.at(-1),pair=d.futurePair?.q,key=futureSessionKey(q?.ts);
  const label=q?.closing?'日盤收盤':key.startsWith('night:')?'夜盤':key?'日盤':'待確認';
  const sameSession=!q?.closing&&key&&key===futureSessionKey(pair?.ts)&&Math.abs(pair.ts-q.ts)<=90000;
  const volume=(sameSession&&Number.isFinite(pair.volume)&&Number.isFinite(q.volume))?
   (m.contract==='次月'?[pair.volume,q.volume]:[q.volume,pair.volume]).map(n=>fmt(n,0)).join('／')+' 口':'—';
  cards=card('契約與最新報價時段',(m.contract||'近月')+' · '+(x.month||'月份待確認'),label)+
   card('最近公布結算價',fmt(row?.settlement,digit(m)),row?twDate(row.t)+' · 期交所':'等待期交所資料')+
   card('近月／次月成交量',volume,volume==='—'?'等待同時段的可比較資料':fresh(q)&&fresh(pair)?'同一時段 · 口數':'最近可比較資料 · 同一時段')+
   card(x.basis?.label||'期現貨價差',modePoints(m,x.basis?.points),x.basis?'現貨 '+modeStamp(x.basis.reference):'等待可對照報價')+
   card('次月－近月',modePoints(m,x.spread?.points),x.spread?'期貨 '+modeStamp(x.spread.selectedAt):'等待兩個契約的報價');
  extra='<div class="row wrap mode-actions"><span class="sub">盤中圖表</span><div class="switch" aria-label="期貨盤中圖表時段">'+
   [['auto','隨最新報價'],['day','日盤'],['night','夜盤']].map(([id,name])=>'<button data-act="futureView" data-id="'+id+'" aria-pressed="'+((d.futureChartSession||'auto')===id)+'">'+name+'</button>').join('')+
   '</div><button data-act="rule">契約與警報設定</button></div>';
 }else if(mode==='us'){
  const received=Number.isFinite(q?.ts);
  const kind=q?.instrumentType==='ETF'?'ETF':q?.instrumentType==='EQUITY'?'個股':'股票／ETF';
  cards=card('一般交易時段',modeUsd(q?.price),received?modeET.format(q.ts)+' 美東':'等待一般盤報價')+
   card('開盤／前收',modeUsd(q?.open)+' ／ '+modeUsd(q?.prev),'一般交易時段')+
   card('區間高低',modeUsd(q?.high)+' ／ '+modeUsd(q?.low),'本次報價交易日')+
   card('成交量',Number.isFinite(q?.volume)?fmt(q.volume,0)+' 股':'—',kind+' · 美元計價')+
   card('行情來源',q?.source||'等待報價',q?.sessionLabel||'');
 }else{
  const x=esbQuoteSpread(q);
  const latest=Number.isFinite(q?.ts)?modeStamp(q.ts):'—';
  cards=card('來源買價',fmt(x?.bid),x?'報價快照 '+modeStamp(x.ts):'來源尚無完整雙邊報價')+
   card('來源賣價',fmt(x?.ask),x?'報價快照 '+modeStamp(x.ts):'來源尚無完整雙邊報價')+
   card('買賣價差',x?fmt(x.pct)+'%':'—',x?'差 '+fmt(x.gap)+' 元 · 以買賣中點計算':'需同一筆有效雙邊報價')+
   card('成交資料時間',latest,'行情來源時間 · 台北')+card('成交量',q?quoteVolume(q,m):'—',q?.source||'等待報價');
 }
 const html='<div class="mode-grid">'+cards+'</div>'+extra;
 if(strip.innerHTML!==html)strip.innerHTML=html;
}
function equityAnalysisRow(title,detail,notes=''){
 return '<section class="insight-row"><b>'+esc(title)+'</b><p class="num">'+futureNote(detail)+'</p>'+
  (notes?'<p class="sub">'+esc(notes)+'</p>':'')+'</section>';
}
function equityPriceReading(m,q,stats){
 if(!valid(q?.price))return '等待有效成交價。';
 const fmtPrice=n=>fmt(n,digit(m)),delta=pct(q),open=valid(q.open)&&valid(q.prev)?100*(q.open/q.prev-1):NaN;
 const afterOpen=valid(q.open)?100*(q.price/q.open-1):NaN;
 const result=[];
 if(Number.isFinite(delta))result.push(isUS(m)?'較前收 ':'較來源昨參考 ',[signed(delta),toneFor(delta)]);
 if(Number.isFinite(open))result.push(result.length?'，開盤相對參考價 ':'開盤相對參考價 ',[signed(open),toneFor(open)]);
 if(Number.isFinite(afterOpen))result.push(result.length?'，開盤至最近成交 ':'開盤至最近成交 ',[signed(afterOpen),toneFor(afterOpen)]);
 if(valid(stats.hi)&&valid(stats.lo)&&stats.hi>stats.lo&&q.price>=stats.lo&&q.price<=stats.hi){
  const rank=(q.price-stats.lo)/(stats.hi-stats.lo);
  result.push(result.length?'。':'',['成交價'+(rank>=.8?'靠近日高':rank<=.2?'靠近日低':'位於日內區間中段'),toneFor(rank>=.8?1:rank<=.2?-1:0)]);
 }
 if(!result.length)return '最近成交 '+fmtPrice(q.price)+'，等待開盤與參考價以比較。';
 return [...result,'。'];
}
function equityTrend(m,q,d){
 const completed=(d.daily?.bars||[]).filter(b=>Number.isFinite(b.t)&&(!Number.isFinite(q?.ts)||marketDate(m,b.t)<=marketDate(m,q.ts)));
 if(!completed.length)return {text:d.dailyLoading?'正在載入日行情。':'暫無可用的歷史日行情。',date:''};
 const recent=completed.at(-1), close=valid(q?.price)?q.price:recent.c;
 const view=[];
 for(const [n,name] of [[5,'5 日線'],[20,'20 日線'],[60,'60 日線']]){
  if(completed.length<n)continue;
  const ma=mean(completed.slice(-n).map(b=>b.c));
  if(view.length)view.push(' · ');
  view.push(name+' '+fmt(ma)+' ',[close>ma?'上方':close<ma?'下方':'持平',toneFor(close-ma)]);
 }
 const window=completed.slice(-20),high=Math.max(...window.map(b=>b.h));
 if(window.length===20&&valid(high)){
  if(view.length)view.push('。');
  const pct=100*(close/high-1);
  view.push('距近 20 日高點 '+fmt(high)+' ',[signed(pct),toneFor(pct)]);
 }
 return {text:view.length?[...view,'。']:'歷史樣本尚不足以計算均線。',date:marketDate(m,recent.t),completed};
}
function equityVolume(m,q,trend){
 const refDate=Number.isFinite(q?.ts)?marketDate(m,q.ts):'';
 const previous=(trend.completed||[]).filter(b=>marketDate(m,b.t)<refDate).slice(-20);
 const values=previous.map(b=>b.v).filter(v=>Number.isFinite(v)&&v>=0);
 const avg=values.length>=5?mean(values):NaN;
 const reported=Number.isFinite(q?.volume)?q.volume*(q.volumeUnit==='張'?1000:1):NaN;
 const settled=!!refDate&&trend.date===refDate&&trend.completed?.at(-1)?.v>=0;
 const total=settled?trend.completed.at(-1).v:reported;
 const ratio=valid(avg)&&Number.isFinite(total)?total/avg:NaN;
 const text=[settled?'日成交量 ':'來源累計成交量 ',[Number.isFinite(total)?fmt(total,0)+' 股':'未提供']];
 if(Number.isFinite(ratio)){
  text.push('，相當於前 '+values.length+' 個交易日平均的 ',[fmt(ratio,2)+' 倍',ratio>=1.5?'caution':'neutral']);
 }
 return equityAnalysisRow('成交量與流動性',text,settled?'完整交易日成交量與前期日均量比較。':'盤中累計與完整日均量比較，供掌握進度。異常量警報另以同時段的近期成交速度判定。');
}
function usBenchmarkReading(q,d){
 const snapshots=(d.usBenchmarks||[]).filter(b=>Number.isFinite(b.ts)&&Number.isFinite(pct(b)));
 const comparable=snapshots.filter(b=>Number.isFinite(q?.ts)&&!q.error&&marketDate(usBenchmarks[0],q.ts)===marketDate(usBenchmarks[0],b.ts)&&
  Math.abs(q.ts-b.ts)<=15*60000&&Number.isFinite(pct(q)));
 const text=[];
 for(const b of comparable){
  const diff=pct(q)-pct(b);
  if(text.length)text.push('；');
  text.push(b.name+' '+signed(pct(b))+'，標的'+(diff>0?'領先 ':diff<0?'落後 ':'相差 '),
   [fmt(Math.abs(diff))+' 個百分點',toneFor(diff)]);
 }
 return equityAnalysisRow('美股市場對照 · SPY／QQQ',text.length?[...text,'。']:
  d.usBenchmarkLoading?'正在讀取指標 ETF 行情。':'等待同一美東交易日、時間接近的對照報價。',
  comparable.length?comparable.map(b=>b.name+' '+modeET.format(b.ts)+(b.delayed?'（來源標示延遲）':'')).join(' · ')+' 美東。以兩檔 ETF 作市場參照。':'比較採一般交易時段的報價變化。');
}
function esbLiquidityReading(q){
 const spread=esbQuoteSpread(q);
 if(!spread)return equityAnalysisRow('報價與流動性','來源暫無可核對的雙邊報價，請以已成交價格與成交量判讀。','興櫃由推薦證券商報價，雙邊報價與實際成交分開看。');
 const text=['來源買價 ',[fmt(spread.bid)],'／賣價 ',[fmt(spread.ask)],'，中點價差 ',
  [fmt(spread.pct)+'%',spread.pct>=2?'caution':'neutral'],'。'];
 if(spread.pct>=2)text.push(['價差較寬','caution'],'，若用買價或賣價估算，價格差距可能明顯。');
 if(valid(q.price)&&(q.price<spread.bid||q.price>spread.ask))text.push('最近成交落在這筆報價區間外。');
 return equityAnalysisRow('報價與流動性',text,'雙邊快照 '+modeStamp(spread.ts)+' 台北。價差以買賣中點為分母。');
}
function equityModeResearch(m,q,d,details=false){
 const us=isUS(m), title=us?(q?.instrumentType==='ETF'?'ETF':'個股')+' · 美股觀察':'興櫃報價與成交';
 const stats=metrics(m,q,d.daily?.bars),trend=equityTrend(m,q,d);
 const time=Number.isFinite(q?.ts)&&us?modeET.format(q.ts)+' 美東 · ':'';
 const data=equityAnalysisRow('價格與日內位置',equityPriceReading(m,q,stats),time+securityInfo(q))+
  (us?usBenchmarkReading(q,d):esbLiquidityReading(q))+
  equityVolume(m,q,trend)+equityAnalysisRow('均線與近期位置',trend.text,trend.date?'日行情截至 '+trend.date+' · '+d.daily?.source:'');
 const f=d.fund;
 const revenue=!us&&Number.isFinite(f?.revenue)?equityAnalysisRow('最新營收',[f.month+' 營收 ',[fmt(f.revenue/100000)+' 億元'],
  ' · 年增 ',[signed(f.yoy),toneFor(f.yoy)],' · 月增 ',[signed(f.mom),toneFor(f.mom)]],f.source+' · 歷史請見「公司營收」。'):'';
 const official=us?'':'<p class="sub"><a href="https://www.tpex.org.tw/zh-tw/esb/trading/info/stock-pricing.html" target="_blank" rel="noopener noreferrer">櫃買中心興櫃個股歷史行情</a></p>';
 if(details){
  const dates=(trend.completed||[]).slice(-10).reverse();
  const history=dates.length?positionTable(['交易日','開盤','最高','最低','收盤','成交股數'],dates.map(b=>
   [marketDate(m,b.t),fmt(b.o),fmt(b.h),fmt(b.l),fmt(b.c),fmt(b.v,0)])):'<p class="sub">暫無可用日行情。</p>';
  const ready=alertSession(m,q);
  const alerts=ready?conditions(m,q,d.daily?.bars).map(h=>h[1]):[];
  return data+'<section class="insight-row"><b>近 10 個交易日日行情'+(us?' · USD／美東':' · TWD／台北')+'</b>'+history+official+'</section>'+
   equityAnalysisRow('警報狀態',ready?(alerts.join('、')||'本筆行情無觸發條件。'):'等待當前交易時段的有效新成交。')+
   positionView(m,q,state.rules[m.id]);
 }
 return '<div class="row between wrap insight-head"><strong>'+title+'</strong><span class="example">'+(us?'USD · 美東一般盤':'TWD · 興櫃議價')+'</span></div>'+
  '<div class="research-body" tabindex="0">'+outlookView(m,q,d)+data+revenue+positionView(m,q,state.rules[m.id])+'</div>';
}
function futurePositionsView(m,q,d){
 const x=futureContext(m,q,d),oi=x.oi;
 return '<div class="insight-head"><strong>盤後部位</strong></div>'+futureInstitutionalView(m)+futureExtendedPositions(m)+
  '<div class="insight-row"><b>未平倉量</b><p class="num">'+(oi?fmt(oi.value,0)+' 口':'—')+'</p>'+
  '<p class="sub">'+(oi?twDate(oi.at)+' · 契約 '+esc(oi.contract)+' · 期交所日行情':'等待期交所公布')+'</p></div>'+
  '<div class="insight-row"><b>較同契約前次公布</b><p class="num">'+(Number.isFinite(oi?.change)?(oi.change>0?'+':'')+fmt(oi.change,0)+' 口':'—')+'</p></div>';
}
