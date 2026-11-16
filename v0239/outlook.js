// Historical analogue statistics. No AI-generated probabilities and no trained model claim.
// Only prices available at each historical origin enter its features.
const outlookSpec=[{days:5,name:'短線',period:'約一週',band:.01},{days:20,name:'波段',period:'約一個月',band:.03},{days:120,name:'長線',period:'約半年',band:.05}];
const outlookMethod='price-analog-v1';
function outlookFeatures(prices,i){
 if(i<60||!valid(prices[i]))return null;
 const window=prices.slice(i-60,i+1);
 if(!window.every(valid))return null;
 const returns=window.slice(1).map((p,j)=>Math.log(p/window[j]));
 const recent=returns.slice(-20),mu=mean(recent),vol=Math.sqrt(mean(recent.map(r=>(r-mu)**2)));
 if(!Number.isFinite(vol)||vol<.0001)return null;
 const gains=mean(returns.slice(-14).map(r=>Math.max(0,r))),losses=mean(returns.slice(-14).map(r=>Math.max(0,-r)));
 const rsi=gains+losses>0?gains/(gains+losses):.5;
 const c=prices[i],clip=x=>Math.max(-8,Math.min(8,x));
 return [clip(Math.log(c/mean(window.slice(-20)))/(vol*Math.sqrt(20))),
  clip(Math.log(c/mean(window.slice(-60)))/(vol*Math.sqrt(60))),
  clip(Math.log(c/prices[i-5])/(vol*Math.sqrt(5))), (rsi-.5)*2];
}
function outlookClass(r,band){return r>band?0:r< -band?2:1;}
function outlookPercents(counts){
 const n=counts.reduce((a,b)=>a+b,0);if(!n)return null;
 const raw=counts.map(c=>c/n*100),rounded=raw.map(Math.floor);
 const order=raw.map((x,i)=>({i,remainder:x-rounded[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 const remainder=100-rounded.reduce((a,b)=>a+b,0);
 for(let j=0;j<remainder;j++)rounded[order[j].i]++;
 return rounded;
}
function outlookWilson(k,n){
 const z=1.96,p=k/n,den=1+z*z/n,center=(p+z*z/(2*n))/den;
 const half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return [Math.max(0,center-half)*100,Math.min(1,center+half)*100];
}
function outlookPrepared(bars){
 const prices=bars.map(b=>b.a);
 const gaps=[0];for(const p of prices)gaps.push(gaps.at(-1)+(valid(p)?0:1));
 return {bars,prices,gaps,features:prices.map((_,i)=>outlookFeatures(prices,i))};
}
function outlookAnalogs(data,query,origin,spec){
 const {prices,features}=data,candidates=[];
 // Each outcome must have finished strictly before the query origin.
 for(let i=60;i+spec.days<origin;i++){
  if(!features[i]||data.gaps[i+spec.days+1]!==data.gaps[i])continue;
  const distance=Math.sqrt(features[i].reduce((s,f,j)=>s+(f-query[j])**2,0));
  candidates.push({i,distance,r:prices[i+spec.days]/prices[i]-1});
 }
 if(!candidates.length)return {n:0,counts:[0,0,0],selected:[],base:[0,0,0]};
 candidates.sort((a,b)=>a.distance-b.distance||b.i-a.i);
 // Top quarter by similarity, then select at most 30 disjoint forward windows.
 // Adjacent origins are never counted as separate independent outcomes.
 const pool=candidates.slice(0,Math.max(1,Math.ceil(candidates.length*.25))),selected=[];
 for(const item of pool){
  if(selected.every(s=>Math.abs(s.i-item.i)>spec.days))selected.push(item);
  if(selected.length===30)break;
 }
 const counts=[0,0,0],base=[0,0,0];
 for(const item of selected)counts[outlookClass(item.r,spec.band)]++;
 // Baseline also uses non-overlapping outcomes; it does not cherry-pick similarity.
 for(let i=60;i+spec.days<origin;i+=spec.days+1)if(features[i]&&data.gaps[i+spec.days+1]===data.gaps[i])base[outlookClass(prices[i+spec.days]/prices[i]-1,spec.band)]++;
 return {n:selected.length,counts,selected,base,pool:pool.length};
}
function outlookValidation(data,spec){
 const results=[],last=data.bars.length-1,step=Math.max(63,spec.days+1);
 // Chronological walk-forward test. No tuning on these test outcomes.
 for(let origin=Math.max(365,last-2000);origin+spec.days<=last;origin+=step){
  const feature=data.features[origin];if(!feature||data.gaps[origin+spec.days+1]!==data.gaps[origin])continue;
  const a=outlookAnalogs(data,feature,origin,spec);
  if(a.n<12)continue;
  const bn=a.base.reduce((x,y)=>x+y,0);if(!bn)continue;
  const label=outlookClass(data.prices[origin+spec.days]/data.prices[origin]-1,spec.band);
  const score=counts=>counts.reduce((s,c,j)=>s+(c/counts.reduce((x,y)=>x+y,0)-(j===label?1:0))**2,0);
  results.push({brier:score(a.counts),baseline:score(a.base)});
 }
 return {n:results.length,brier:mean(results.map(r=>r.brier)),baseline:mean(results.map(r=>r.baseline))};
}
function outlookHistory(raw,m,now=Date.now()){
 if(raw?.meta?.dataGranularity!=='1d')throw Error('來源返回的不是日線資料，暫不估計交易日期間。');
 const adj=raw?.indicators?.adjclose?.[0]?.adjclose,quote=raw?.indicators?.quote?.[0];
 if(!Array.isArray(adj)||!quote||!Array.isArray(raw.timestamp))throw Error('來源未提供可驗證的還原收盤價，暫不估計。');
 const today=marketDate(m,now),end=number(raw.meta?.currentTradingPeriod?.regular?.end)*1000;
 const closed=isUS(m)?Number.isFinite(end)&&marketDate(m,end)===today&&now>=end:twTime(now)>=(m.exchange==='esb'?'15:05:00':'13:35:00');
 const rows=[];let previousDay='';
 for(let i=0;i<raw.timestamp.length;i++){
  const t=number(raw.timestamp[i])*1000,date=Number.isFinite(t)?marketDate(m,t):'';
  if(!date||t>now||date>today||date===today&&!closed)continue;
  const c=number(quote.close?.[i]),a=number(adj[i]);
  // Entirely empty weekend placeholders are not trading sessions. Unknown weekday
  // gaps remain explicit; no feature or outcome window may cross them.
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  if(!valid(c)&&!valid(a)&&(weekday===0||weekday===6))continue;
  if(date<=previousDay)throw Error('歷史日期重複或未依序排列，暫不估計。');
  rows.push({t,c,a,date,gap:!valid(c)||!valid(a)});previousDay=date;
 }
 // Price adjustment data must be complete; no fallback to unadjusted split-distorted prices.
 return rows.slice(-7560);
}
function outlookContext(m,q,d,now=Date.now()){
 const history=d.outlookHistory;if(!history?.bars?.length)return {reason:d.outlookError||'正在讀取長期還原日行情…'};
 const last=history.bars.at(-1),data=d.outlookPrepared;
 if(!data)return {reason:'歷史行情尚未完成整理。'};
 let query=data.features.at(-1),origin=history.bars.length-1,live=false,reason='以最近完整日 K 比對';
 const qDate=Number.isFinite(q?.ts)?marketDate(m,q.ts):'';
 const regular=Boolean(alertSession(m,q,now));
 // New-day intraday price is a provisional close, never added to the stored history.
 if(valid(q?.price)&&!q.error&&!q.delayed&&regular&&qDate>last.date&&qDate===marketDate(m,now)&&q.ts<=now+60000&&now-q.ts<=5*60000){
  if(!valid(q.prev)||Math.abs(q.prev/last.c-1)>.01)return {reason:'報價前收與歷史價格不一致，可能有除權息、分割或來源落差；暫停盤中估計。'};
  const prices=[...data.prices,q.price*last.a/last.c];
  query=outlookFeatures(prices,prices.length-1);origin=prices.length-1;live=true;
  reason='盤中暫估 · 未完成日 K；以即時價格作暫時收盤價';
 }
 if(!query)return {reason:history.bars.length<61?'至少需要 61 根有效還原日 K。':'最近 61 根還原日行情含缺值或波動不足，暫不估計。'};
 return {data,query,origin,live,reason,at:live?q.ts:last.t,quoteDate:qDate,historyAt:last.t};
}
function outlookCard(spec,a,validation,previous,query){
 const ready=a.n>=12,percent=ready?outlookPercents(a.counts):null;
 const majority=ready?percent.indexOf(Math.max(...percent)):1;
 const words=['上漲','持平','下跌'];
 const headline=!ready?'可比較的不重疊樣本不足':percent[majority]>50?'歷史相似行情以'+words[majority]+'居多':'歷史多空分歧，未形成明顯優勢';
 const values=words.map((name,i)=>'<div class="outlook-value '+['up','neutral','down'][i]+'"><span>'+name+'</span><strong>'+ (percent?percent[i]+'%':'—')+'</strong></div>').join('');
 const delta=percent&&previous?percent.map((p,i)=>(p-previous[i]>0?'+':'')+(p-previous[i])+' 個百分點').join('／'):'首次比對／沒有可比較的上次估計';
 const ci=ready?outlookWilson(a.counts[0],a.n):null;
 const feature=spec.days===5?query[2]:spec.days===20?query[0]:query[1];
 const current=(spec.days===5?'近 5 日價格動能':spec.days===20?'價格相對月線':'價格相對季線')+(Math.abs(feature)<.1?'接近中性':feature>0?'偏強':'偏弱');
 const sampleDates=a.selected.map(s=>s.date).filter(Boolean).sort();
 return '<article class="outlook-card"><div class="row between wrap"><h4>'+spec.name+' <small>'+spec.days+' 交易日</small></h4><span class="sub">'+spec.period+'</span></div>'+
  '<p class="outlook-verdict '+(ready?['up','neutral','down'][majority]:'neutral')+'">'+headline+'</p><div class="outlook-values">'+values+'</div>'+
  (percent?'<div class="outlook-bar" role="img" aria-label="'+words.map((w,i)=>w+' '+percent[i]+'%').join('，')+'">'+percent.map((p,i)=>'<span class="'+['up','neutral','down'][i]+'" style="width:'+p+'%"></span>').join('')+'</div>':'')+
  '<p class="outlook-reading"><b class="'+(Math.abs(feature)<.1?'neutral':feature>0?'up':'down')+'">'+current+'</b></p><p class="sub">'+a.n+' 筆不重疊歷史樣本'+(!ready?' · 至少需 12 筆':' · 樣本少，誤差可能很大')+'</p>'+
  '<details data-outlook-detail="'+spec.days+'"><summary>變化與統計依據</summary><p>較上次：上漲／持平／下跌 '+delta+'</p>'+
  '<p>持平定義：第 '+spec.days+' 個交易日的還原收盤報酬介於 ±'+spec.band*100+'%；超過上界為上漲，低於下界為下跌。期間內曾觸價不算到期結果。</p>'+
  (ci?'<p>歷史上漲比例的 95% Wilson 區間：<b>'+ci.map(x=>x.toFixed(1)+'%').join('～')+'</b>。這是抽樣誤差示意，未涵蓋市場變化、樣本間相關性、樣本選擇及盤中替代誤差。</p>':'')+
  (sampleDates.length?'<p>類比起點範圍：'+esc(sampleDates[0])+'～'+esc(sampleDates.at(-1))+'。</p>':'')+
  '<p>依還原價格的月／季線距離、5 日動能與 RSI 比對；挑選距離最近的四分之一候選，取最多 30 筆互不重疊的未來窗口。營收、法人、新聞尚未納入此統計。</p>'+
  '<p>逐期向前檢驗 '+validation.n+' 筆'+(validation.n?'；三分類 Brier 分數 <b>'+validation.brier.toFixed(3)+'</b>，同期歷史分布基準 <b>'+validation.baseline.toFixed(3)+'</b>（越小越好）。':'。')+'此診斷未證明穩定預測優勢；未進行機率校準或交易成本回測。</p></details></article>';
}
function outlookView(m,q,d){
 if(isFuture(m))return '';
 const c=outlookContext(m,q,d),history=d.outlookHistory;
 let cards='';
 if(c.data){
  const key=[outlookMethod,history.loadedAt,c.origin,...c.query].join('|');
  if(d.outlookResult?.key!==key){
   const previous=d.outlookResult;
   const rows=outlookSpec.map(spec=>{
    const a=outlookAnalogs(c.data,c.query,c.origin,spec);
    for(const item of a.selected)item.date=c.data.bars[item.i].date;
    return {a,percent:a.n>=12?outlookPercents(a.counts):null,previous:previous?.rows.find(r=>r.days===spec.days)?.percent,days:spec.days};
   });
   d.outlookResult={key,rows};
  }
  cards='<div class="outlook-grid">'+d.outlookResult.rows.map((r,i)=>outlookCard(outlookSpec[i],r.a,d.outlookValidation?.[i]||{n:0},r.previous,c.query)).join('')+'</div>';
 }
 return '<section class="outlook" aria-label="短線、波段與長線歷史情境"><div class="row between wrap"><h3>短線・波段・長線觀察</h3><span class="example">歷史類比統計 · 非校準機率</span></div>'+
  '<p class="outlook-intro">'+esc(c.reason)+(c.at?' · 資料 '+marketDate(m,c.at)+' '+(isUS(m)?modeET.format(c.at)+' 美東':twTime(c.at)+' 台北'):'')+'</p>'+
  (c.live?'<p class="outlook-caution">盤中價格會重新比對歷史樣本；目前只有日線類比，尚未驗證同時段盤中準確性。量能、籌碼變化請合併下方即時評語判讀。</p>':'')+
  (q?.error||q?.delayed?'<p class="sub">報價延遲或更新失敗：使用最近完整日 K，沒有偽裝成即時估計。</p>':'')+cards+
  '<details data-outlook-detail="method"><summary>這些百分比代表什麼？</summary><p>它們是過去相似價格型態的實際結果比例，三者合計 100%。它們不是此刻買進就會獲利的機率，也不是 AI 猜出的數字。每次新報價會重算比對，類比樣本未改變時比例可以不變。</p><p>統計與 AI 解說分開運作，不自動觸發買賣警報。採 Yahoo Finance 還原日收盤價，最多保留近 30 年；長期資料每天重新讀取，盤中價格沿用原有報價更新頻率。'+(history?'本次取得 '+history.bars.filter(b=>!b.gap).length+' 根有效日 K，'+history.bars.filter(b=>b.gap).length+' 筆來源缺值的跨期樣本已排除，完整日行情截至 '+esc(history.bars.at(-1)?.date||'—')+'。':'')+'</p><p>股票、ETF、指數、美股、興櫃各自使用自己的歷史；不混用不同商品樣本。期貨換月與夜盤需另一套同契約／時段資料，本版不強套此模型。方法 '+outlookMethod+'。</p></details></section>';
}
async function loadOutlook(m,d){
 if(isFuture(m)||d.outlookLoading)return;
 const now=Date.now(),clock=isUS(m)?modeET.format(now).slice(-8):twTime(now);
 const day=marketDate(m,now)+'|'+(clock>=(isUS(m)?'16:05:00':m.exchange==='esb'?'15:05:00':'13:35:00')?'settled':'open');
 if(d.outlookSession===day&&now-(d.outlookAttempt||0)<(d.outlookError?10*60000:6*3600000))return;
 d.outlookAttempt=now;d.outlookSession=day;d.outlookLoading=true;
 try{
  const raw=await memo('outlook:'+symbolFor(m)+':'+day,6*3600000,()=>yahooChart(m,'outlook','1d'));
  const bars=outlookHistory(raw,m,now);
  if(!bars.length)throw Error('來源沒有有效的還原日行情。');
  d.outlookHistory={bars,loadedAt:now};d.outlookPrepared=outlookPrepared(bars);
  d.outlookValidation=outlookSpec.map(s=>outlookValidation(d.outlookPrepared,s));
  d.outlookError='';d.outlookResult=null;
 }catch(e){d.outlookError=message(e);d.outlookHistory=null;d.outlookPrepared=null;d.outlookResult=null;}
 finally{d.outlookLoading=false;if(selected()===m&&state.details.get(m.id)===d)render();}
}
