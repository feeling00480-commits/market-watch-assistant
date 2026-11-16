function isTaiwanETF(m){
 return ['tse','otc'].includes(m.exchange)&&(m.type==='ETF'||/^00\d{2,4}[A-Z]?$/.test(m.id));
}
function marketTabs(m){
 const tabs=marketModes[marketMode(m)].tabs;
 if(m.id==='TAIEX')return {research:'大盤分析',news:tabs.news,quotes:tabs.quotes};
 if(isTaiwanETF(m))return {research:'ETF 分析',news:tabs.news,quotes:tabs.quotes,chips:'法人籌碼'};
 return tabs;
}
function parseMarketClose(doc,date){
 const tables=[...doc.querySelectorAll('table')].map(table=>[...table.querySelectorAll('tr')].map(positionCells));
 const reportDate=doc.body?.textContent.match(/(\d{2,4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*大盤統計資訊/);
 if(!reportDate||twDate(rocDate(reportDate.slice(1).join('/')))!==date)return null;
 const breadth=tables.find(rows=>rows.some(row=>row.includes('類型')&&row.includes('股票')));
 const columns=breadth?.find(row=>row.includes('類型')&&row.includes('股票'));
 const count=label=>{
  const cell=breadth?.find(row=>row[0]?.startsWith(label))?.[columns.indexOf('股票')];
  const match=/^([\d,]+)(?:\s*[(（][\d,]+[)）])?$/.exec(cell||'');
  return officialInteger(match?.[1]);
 };
 const [up,down,flat]=['上漲','下跌','持平'].map(count);
 const turnover=tables.find(rows=>rows.some(row=>row[0]==='成交統計'));
 const stocks=turnover?.find(row=>/^證券合計/.test(row[0]));
 const total=turnover?.find(row=>/^總計/.test(row[0]));
 const market={date,up,down,flat,stockValue:officialInteger(stocks?.[1]),totalValue:officialInteger(total?.[1])};
 return [up,down,flat,market.stockValue,market.totalValue].some(x=>x>=0)?market:null;
}
async function taiwanMarketReports(bars){
 const dates=[...new Set(bars.slice(-2).map(bar=>twDate(bar.t)))];
 const results=await Promise.allSettled(dates.map(async date=>{
  const [close,cash]=await Promise.allSettled([
   memo('market-close:'+date,15*60000,async()=>parseMarketClose(positionDoc(await bridge('market-summary/'+date)),date)),
   cashPositionFor(date)
  ]);
  return {date,close:close.value||null,cash:cash.value||null};
 }));
 return results.flatMap(r=>r.value&&(r.value.close||r.value.cash)?[r.value]:[]);
}
async function loadTaiwanResearchContext(m,d){
 if(m.id==='TAIEX'){
  const bars=d.daily?.bars||[],date=bars.at(-1)?.t;
  if(!date||d.marketLoading||d.marketReportDate===date&&Date.now()-d.marketReportAt<15*60000)return;
  d.marketLoading=true;d.marketReportDate=date;d.marketReportAt=Date.now();
  try{
   const rows=await taiwanMarketReports(bars),past=new Map((d.marketReports||[]).map(r=>[r.date,r]));
   for(const row of rows){
    const before=past.get(row.date);
    past.set(row.date,{...row,close:row.close||before?.close,cash:row.cash||before?.cash});
   }
   d.marketReports=[...past.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-2);
  }finally{d.marketLoading=false;if(selected()===m)render();}
 }else if(isTaiwanETF(m)&&!d.benchmarkLoading&&Date.now()-(d.benchmarkAt||0)>=30*60000){
  d.benchmarkLoading=true;d.benchmarkAt=Date.now();
  try{
   d.benchmarkDaily=await dailySeries(mainIndex,3);
  }catch{}finally{d.benchmarkLoading=false;if(selected()===m)render();}
 }
}
function fundIndexRelative(bars,indexBars){
 const etf=new Map(bars.filter(b=>valid(b.c)).map(b=>[twDate(b.t),b.c]));
 const latest=indexBars.findLastIndex(b=>valid(b.c)&&etf.has(twDate(b.t)));
 if(latest<0)return [];
 const end=indexBars[latest],date=twDate(end.t);
 return [5,20].flatMap(days=>{
  const start=indexBars[latest-days],from=start&&twDate(start.t);
  if(!valid(start?.c)||!etf.has(from))return [];
  const fundReturn=100*(etf.get(date)/etf.get(from)-1),indexReturn=100*(end.c/start.c-1);
  return [{days,from,date,fundReturn,indexReturn,gap:fundReturn-indexReturn}];
 });
}
function fundRelativeRow(rows){
 if(!rows.length)return equityAnalysisRow('與加權指數比較','等待足夠且日期對齊的日行情。');
 const detail=[];
 for(const r of rows){
  if(detail.length)detail.push('；');
  detail.push('近 '+r.days+' 日 ETF '+signed(r.fundReturn)+'，加權 '+signed(r.indexReturn)+'，',
   [relativePhrase(r.gap),toneFor(r.gap)]);
 }
 return equityAnalysisRow('與加權指數比較',[...detail,'。'],'截至 '+rows[0].date+' · 以同一期間的收盤價比較，未含配息。加權指數作市場對照。');
}
function relativePhrase(gap){
 return Math.abs(gap)<.005?'表現相近':(gap>0?'領先 ':'落後 ')+fmt(Math.abs(gap))+' 個百分點';
}
function taiwanMomentum(bars){
 const last=indicators(bars).at(-1);
 if(!Number.isFinite(last?.rsi))return equityAnalysisRow('日線動能','等待足夠的日行情。');
 const rsi=last.rsi, hist=last.hist;
 const tone=toneFor(rsi>=55&&hist>0?1:rsi<=45&&hist<0?-1:0);
 const label=tone==='up'?'動能偏強':tone==='down'?'動能偏弱':'動能方向待確認';
 const detail=['RSI 14 ',[fmt(rsi,1)],' · MACD 柱 ',[fmt(hist,4),toneFor(hist)],'。',[label,tone],'。'];
 return equityAnalysisRow('日線動能',detail,'以已完成的日行情計算。');
}
function indexMarketRows(reports,daily){
 const row=reports.findLast(r=>r.close),m=row?.close,cash=reports.findLast(r=>r.cash)?.cash;
 const validBreadth=m&&[m.up,m.down,m.flat].every(n=>n>=0);
 const session=validBreadth?daily.findLastIndex(b=>twDate(b.t)===m.date):-1;
 const indexDirection=session>0?Math.sign(daily[session].c-daily[session-1].c):0;
 const split=validBreadth&&indexDirection*(m.up-m.down)<0;
 const breadth=validBreadth?equityAnalysisRow('市場廣度',[['上漲 '+fmt(m.up,0)+' 家','up'],' · ',
  ['下跌 '+fmt(m.down,0)+' 家','down'],' · 持平 '+fmt(m.flat,0)+' 家。',...(split?[
   ['指數漲跌與多數股票方向分歧','caution'],'。']:[])],m.date+' · 證交所上市股票，未成交及無可比價另列於原表。'):
  equityAnalysisRow('市場廣度','等待證交所盤後家數。');
 const previous=reports.findLast(r=>r.date<m?.date&&valid(r.close?.totalValue))?.close;
 const turnover=valid(m?.totalValue)?equityAnalysisRow('上市成交金額',[
  '全市場 ',[fmt(m.totalValue/1e8,0)+' 億元'],...(valid(m.stockValue)?['，其中股票 '+fmt(m.stockValue/1e8,0)+' 億元']:[]),
  ...(previous?['，全市場較前一交易日 ',[signed(100*(m.totalValue/previous.totalValue-1))]]:[]),'。'
 ],m.date+' · 證交所全市場統計，含 ETF、權證等商品。'):equityAnalysisRow('上市成交金額','等待證交所盤後成交統計。');
 const amount=(name,n)=>[name+(n>0?'買超 ':n<0?'賣超 ':'淨額 '),[fmt(Math.abs(n)/1e8)+' 億元',toneFor(n)]];
 const flow=cash?equityAnalysisRow('上市三大法人',[
  ...amount('合計',cash.total),' · ',...amount('外資及陸資',cash.foreign),' · ',...amount('投信',cash.trust),' · ',...amount('自營商',cash.own+cash.hedge)
 ],cash.date+' · 證交所買賣金額統計，外資欄不含外資自營商。'):equityAnalysisRow('上市三大法人','等待證交所盤後法人統計。');
 return breadth+turnover+flow;
}
function taiwanMarketResearch(m,q,d){
 const isIndex=m.id==='TAIEX', title=isIndex?'加權指數 · 大盤分析':'ETF · 基金行情分析';
 const stats=metrics(m,q,d.daily?.bars),trend=equityTrend(m,q,d);
 const reports=d.marketReports||[], indexReport=reports.findLast(r=>r.close)?.close;
 const relative=isIndex?[]:fundIndexRelative(trend.completed||[],d.benchmarkDaily?.bars||[]);
 const delta=pct(q), last=trend.completed?.at(-1);
 const summary=[];
 if(Number.isFinite(delta))summary.push('最近報價較前收 ',[signed(delta),toneFor(delta)],'。');
 if(isIndex&&indexReport&&Number.isFinite(indexReport.up)&&Number.isFinite(indexReport.down)){
  const direction=indexReport.up-indexReport.down;
  summary.push(indexReport.date+' 上市股票',[direction>0?'上漲家數較多':direction<0?'下跌家數較多':'漲跌家數相同',toneFor(direction)],'。');
 }else if(relative.length){
  const r=relative.at(-1);
  summary.push('截至 '+r.date+'，近 '+r.days+' 日較大盤',[relativePhrase(r.gap),toneFor(r.gap)],'。');
 }
 const daily=trend.completed||[], ma20=daily.length>=20?mean(daily.slice(-20).map(b=>b.c)):NaN;
 if(valid(last?.c)&&valid(ma20)){
  summary.push('最近日 K 收盤',[last.c>ma20?'高於月線':last.c<ma20?'低於月線':'與月線持平',toneFor(last.c-ma20)],'。');
 }
 const etfQuote=q?.source==='證交所 MIS'?{...q,volumeUnit:'張'}:q;
 const lastFlow=d.flow?.rows?.findLast(r=>r.values);
 const etfFlow=lastFlow?equityAnalysisRow('ETF 法人交易',[
  '三大法人合計 ',[(lastFlow.values.total>0?'買超 ':lastFlow.values.total<0?'賣超 ':'淨額 ')+
   fmt(Math.abs(lastFlow.values.total),0)+' 股',toneFor(lastFlow.values.total)]
 ],lastFlow.date+' · '+d.flow.source+' · 詳見「法人籌碼」。'):equityAnalysisRow('ETF 法人交易','等待此 ETF 的盤後法人資料。');
 return '<div class="row between wrap insight-head"><strong>'+title+'</strong><span class="example">'+(isIndex?'上市市場':'台股 ETF')+'</span></div>'+
  '<div class="research-body taiwan-research" tabindex="0" role="region" aria-label="'+title+'">'+
  outlookView(m,q,d)+equityAnalysisRow('重點摘要',summary.length?summary:'等待可用的報價與日行情。')+
  equityAnalysisRow('價格與日內位置',equityPriceReading(m,q,stats),securityInfo(q))+
  equityAnalysisRow('均線與近期位置',trend.text,trend.date?'日行情截至 '+trend.date+' · '+d.daily.source:'')+
  taiwanMomentum(daily)+
  (isIndex?indexMarketRows(reports,daily):fundRelativeRow(relative)+equityVolume(m,etfQuote,trend)+etfFlow+positionView(m,q,state.rules[m.id]))+
  '</div>';
}
