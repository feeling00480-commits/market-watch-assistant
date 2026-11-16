// Shared horizon presentation; a conditional reading is never a probability.
function outlookMarketName(m){
 return isFuture(m)?'期貨':m.id==='TAIEX'?'加權指數':m.type==='ETF'?'ETF':isUS(m)?'美股':m.exchange==='esb'?'興櫃':m.exchange==='otc'?'上櫃':'上市';
}
function outlookSeries(m,q,d){
 let bars=(d.outlookHistory?.bars||d.daily?.bars||[]).filter(b=>Number.isFinite(b.t)&&b.t<=Date.now()).slice().sort((a,b)=>a.t-b.t);
 const contract=isFuture(m)?bars.at(-1)?.contract:null;
 if(isFuture(m))bars=contract?bars.filter(b=>b.contract===contract):[];
 // Keep gaps in the moving-average window; never stitch across missing rows.
 const last=bars.at(-1),adjusted=Boolean(d.outlookHistory),factor=adjusted&&valid(last?.a)&&valid(last?.c)?last.a/last.c:1;
 const closes=bars.map(b=>adjusted?b.a:b.c);
 const usable=valid(q?.price)&&!q.error&&Number.isFinite(q.ts)&&q.ts<=Date.now()+60000&&(!last||q.ts>=last.t);
 const mismatch=usable&&adjusted&&last&&marketDate(m,q.ts)>marketDate(m,last.t)&&(!valid(q.prev)||Math.abs(q.prev/last.c-1)>.01);
 const price=usable&&!mismatch?q.price*factor:closes.at(-1),at=usable&&!mismatch?q.ts:last?.t;
 const average=n=>closes.length>=n&&closes.slice(-n).every(valid)?mean(closes.slice(-n)):NaN;
 return {bars,price,at,contract,mismatch,average,factor,live:usable&&!mismatch&&Boolean(alertSession(m,q)),source:adjusted?'Yahoo Finance 還原日行情':d.daily?.source||'日行情'};
}
function outlookScenario(m,q,d,spec){
 const series=outlookSeries(m,q,d),period=spec.days===5?5:spec.days===20?20:120,average=series.average(period);
 const gap=valid(series.price)&&valid(average)?series.price/average-1:NaN;
 const direction=Number.isFinite(gap)?gap>.003?1:gap<-.003?-1:0:0;
 const label=period===5?'5 日均線':period===20?'月線（20 日）':'半年均線（120 日）';
 const tone=direction>0?'up':direction<0?'down':'neutral';
 const priceText=Number.isFinite(gap)?'最近價格'+(direction>0?'高於':direction<0?'低於':'貼近')+label+'。':'';
 const text=Number.isFinite(gap)?priceText+(direction>0?'目前結構偏強，守住均線才有利延續；跌回下方需重新確認。':direction<0?'目前結構偏弱，重新站穩均線才有改善依據；續跌仍需留意風險。':'目前偏整理，等待突破並有成交量配合，再判斷方向。'):
  '目前沒有足夠且連續的 '+period+' 日行情，先看最近有效成交與資料日期，等待趨勢確認。';
 const at=Number.isFinite(series.at)?marketDate(m,series.at)+' '+(isUS(m)?modeET.format(series.at)+' 美東':twTime(series.at)+' 台北'):'未取得';
 return {days:spec.days,tone,direction,text,reference:valid(average)?average/series.factor:null,referenceLabel:label,at,
  source:series.source,contract:series.contract,live:series.live,mismatch:series.mismatch,scope:'本商品條件觀察，非機率',count:series.bars.length};
}
function outlookScenarioHtml(s){
 return '<div class="outlook-scenario"><p><strong class="'+s.tone+'">'+esc(s.text)+'</strong></p>'+
  (Number.isFinite(s.reference)?'<p class="sub">'+esc(s.referenceLabel)+'參考 '+fmt(s.reference,2)+'</p>':'')+
  '<p class="sub">'+esc(s.scope)+' · '+esc(s.at)+'</p>'+(s.mismatch?'<p class="sub">前收與歷史價格不一致，暫不使用盤中價格推論。</p>':'')+'</div>';
}
function outlookScenarioCard(spec,s,reason){
 return '<article class="outlook-card"><div class="row between wrap"><h4>'+spec.name+' <small>'+spec.days+' 交易日</small></h4><span class="sub">'+spec.period+'</span></div>'+
  '<p class="outlook-verdict '+s.tone+'">'+(Number.isFinite(s.reference)?s.direction>0?'條件偏強':s.direction<0?'條件偏弱':'震盪待確認':'資料尚待補齊')+'</p>'+
  '<div class="outlook-values">'+['上漲','持平','下跌'].map((label,i)=>'<div class="outlook-value '+['up','neutral','down'][i]+'"><span>'+label+'</span><strong>—</strong></div>').join('')+'</div>'+
  '<p class="sub">'+esc(reason||'沒有足夠統計樣本，不填入機率。')+'</p>'+outlookScenarioHtml(s)+'</article>';
}
function futureOutlookScenarios(m,q,d,proxy,indexQuote){
 return outlookSpec.map(spec=>{
  let s=outlookScenario(m,q,d,spec);
  if(proxy&&(spec.days===120||!Number.isFinite(s.reference))){
   s=outlookScenario(mainIndex,indexQuote,proxy,spec);s.scope='標的加權指數條件觀察，非此期貨契約';
  }
  if(spec.days===120)s={...s,text:s.text+' 長期是標的環境觀察；目前近／次月契約須考慮到期與轉倉。'};
  return s;
 });
}
function futureOutlookView(m,q,d){
 const proxy=hasTaiexBasis(m)?d.outlookProxy:null,indexQuote=state.items.get('TAIEX')||d.futureCash;
 if(proxy)outlookView(mainIndex,indexQuote,proxy);
 const rows=proxy?.outlookResult?.rows||[],indexContext=proxy?outlookContext(mainIndex,indexQuote,proxy):null;
 const scenarios=futureOutlookScenarios(m,q,d,proxy,indexQuote);
 const stamp=Number.isFinite(q?.ts)?twDate(q.ts)+' '+twTime(q.ts)+' 台北':'等待報價';
 const cards=outlookSpec.map((spec,i)=>{
  const r=rows[i];
  if(r&&indexContext?.data){
   let html=outlookCard(spec,r.a,proxy.outlookValidation?.[i]||{n:0},r.previous,indexContext.query);
   html=html.replace('<p class="outlook-verdict','<p class="outlook-scope">標的加權指數歷史比例 · 非契約獲利機率</p><p class="outlook-verdict');
   return html.replace('</article>',outlookScenarioHtml(scenarios[i])+'</article>');
  }
  return outlookScenarioCard(spec,scenarios[i],hasTaiexBasis(m)?proxy?.outlookError||'標的歷史類比尚未就緒；先提供條件觀察。':'尚無可驗證的長期同標的類比，不混用加權指數樣本。');
 }).join('');
 const positions=futurePositionRows(m.id),latest=positions[0],foreign=latest?.products[m.id]?.外資;
 return '<section class="outlook future-outlook" aria-label="期貨短線、波段與長線觀察"><div class="row between wrap"><h3>短線・波段・長線觀察</h3><span class="example">期貨專用 · '+esc(m.contract||'近月')+'</span></div>'+
  '<p class="outlook-intro">'+esc(m.name)+' · '+stamp+' · '+(q?.error?'更新失敗，參考最後有效資料':fresh(q)&&!q.delayed?'隨最新期貨報價重算條件':'非最新盤中報價，先看資料時點')+'</p>'+
  '<p class="outlook-caution">'+(hasTaiexBasis(m)?'百分比來自標的加權指數的歷史類比；期貨價格只用於本契約的即時條件判讀。夜盤現貨休市時，現貨比例不會假裝隨夜盤即時更新。':'依此商品同契約資料判讀，不以其他指數代替。')+' 5／20／120 日是觀察期間，非持有目前近月契約至到期後的報酬預測。</p>'+
  (indexContext?.data?'<p class="sub">加權指數類比依據：'+esc(indexContext.reason)+' · '+twDate(indexContext.at)+' '+twTime(indexContext.at)+' 台北</p>':'')+
  '<div class="outlook-grid">'+cards+'</div>'+
  (foreign?'<p class="outlook-position">'+esc(latest.date)+' 外資各月份合計 <strong class="'+(foreign.net>0?'up':foreign.net<0?'down':'neutral')+'">'+(foreign.net>0?'淨多 ':foreign.net<0?'淨空 ':'淨額 ')+fmt(Math.abs(foreign.net),0)+' 口</strong>；可能含避險，不能直接轉換成上漲或下跌機率。</p>':'')+
  '<details data-outlook-detail="future-method"><summary>期貨觀察怎麼判讀？</summary><p>短線優先看所選契約價格與 5 日均線；波段看同契約 20 日資料，不拼接換月價格。台指系列資料不足時改看標的加權指數，並明確標註。其他期貨沒有對應資料就保留缺值。</p><p>基差、日夜盤、外資部位、未平倉量與新聞分開提供解讀，不把數項訊號硬湊成勝率。長線需考慮到期、轉倉與成本。所有條件觀察都不是自動買賣指令。</p></details></section>';
}
async function loadFutureOutlook(m,d){
 if(!hasTaiexBasis(m))return;
 const proxy=getDetail(mainIndex);d.outlookProxy=proxy;
 await loadOutlook(mainIndex,proxy);
 if(selected()===m&&state.details.get(m.id)===d)render();
}
function outlookSnapshot(m,q,d){
 // Refresh the same deterministic state shown in the UI; send no raw model HTML.
 outlookView(m,q,d);
 const reference=isFuture(m)?hasTaiexBasis(m)?d.outlookProxy:null:d;
 const referenceMarket=isFuture(m)?mainIndex:m;
 const referenceQuote=isFuture(m)?state.items.get('TAIEX')||d.futureCash:q;
 const c=reference?outlookContext(referenceMarket,referenceQuote,reference):{};
 const rows=c.data?reference?.outlookResult?.rows:[];
 return {method:outlookMethod,type:'歷史類比結果比例，未校準機率',referenceOnly:isFuture(m),
  referenceInstrument:isFuture(m)?hasTaiexBasis(m)?'加權指數，非期貨契約':'無可驗證標的歷史':m.name,
  caveat:isFuture(m)?'不代表此契約或夜盤的漲跌機率；長期須考慮到期與轉倉':'盤中以成交價替代暫時收盤，尚未做同時段歷史驗證',
  historyDate:reference?.outlookHistory?.bars.at(-1)?.date||null,reason:c.reason||null,
  horizons:outlookSpec.map((spec,i)=>({days:spec.days,flatBandPercent:spec.band*100,
   sampleCount:rows?.[i]?.a.n||0,percent:rows?.[i]?.percent||null,
   validation:reference?.outlookValidation?.[i]||null,
   currentCondition:isFuture(m)?futureOutlookScenarios(m,q,d,reference,referenceQuote)[i]:outlookScenario(m,q,d,spec)}))};
}
