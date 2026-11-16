from pathlib import Path
s=Path('tests/app-v0240.cjs').read_text()
s=s.replace('let disk=null,saves=0,notices=0,ready=0;',"let disk=null,saves=0,notices=0,ready=0,newsCalls=0,newsFailure=false;const apiCalls=[],savedReports=[];")
needle="  else if(path.startsWith('mis/'))value={msgArray:[]};"
replacement='''  else if(path.startsWith('news/')){
   newsCalls++;await new Promise(r=>setTimeout(r,15));
   if(newsFailure)return {ok:false,status:503,text:async()=>''};
   return {ok:true,status:200,text:async()=>'<rss><channel><item><title>測試新聞：營收與市場動態</title><link>https://example.com/news/test</link><source>TEST SOURCE</source><pubDate>Mon, 16 Nov 2026 02:30:00 GMT</pubDate><description>&lt;b&gt;測試摘要&lt;/b&gt;，不是新聞全文。</description></item></channel></rss>'};
  }
  else if(path==='openai'){
   apiCalls.push(JSON.parse(options.body));
   value={output:[{content:[{text:'### 重點摘要\\n- 【偏多】**價格高於均線**，仍需確認。\\n- 【偏空】**成交不足**，留意失效。\\n### 短線展望（5 個交易日）\\n- 【中性】依條件觀察。'}]}]};
  }
  else if(path==='ai-record'){savedReports.push(JSON.parse(options.body));value={saved:true};}
'''+needle
assert needle in s;s=s.replace(needle,replacement)
extra=r'''
 // Every supported mode uses the same three-horizon presentation, with truthful scopes.
 const coverage=w.eval(`(()=>{
  const base=getDetail(state.watch.find(m=>m.id==='2884'));
  const markets=[
   {id:'2330',name:'上市測試',market:'上市',exchange:'tse'},
   {id:'3227',name:'上櫃測試',market:'上櫃',exchange:'otc'},
   {id:'9999',name:'興櫃測試',market:'興櫃',exchange:'esb'},
   {id:'US:AAPL',name:'美股測試',market:'美股',exchange:'us'},
   {id:'0050',name:'ETF測試',market:'ETF',type:'ETF',exchange:'tse'},
   {...mainIndex}
  ];
  for(const m of markets){
   if(!state.watch.some(x=>x.id===m.id))state.watch.push(m);
   else Object.assign(state.watch.find(x=>x.id===m.id),m);
   const d=getDetail(m);Object.assign(d,{daily:base.daily,outlookHistory:base.outlookHistory,outlookPrepared:base.outlookPrepared,outlookValidation:base.outlookValidation,fund:base.fund});
   state.items.set(m.id,{price:base.outlookHistory.bars.at(-1).c,prev:base.outlookHistory.bars.at(-1).c,ts:Date.now(),source:'TEST FIXTURE'});
  }
  return markets.map(m=>{state.id=m.id;state.tab='research';render();const card=el('researchMarket');return {id:m.id,cards:card.querySelectorAll('.outlook-card').length,heading:card.textContent.includes('短線・波段・長線觀察')};});
 })()`);
 for(const item of coverage)ok(item.cards===3&&item.heading,'three-horizon coverage for '+item.id);
 w.Date.now=()=>Date.parse('2026-11-16T13:00:00Z');
 const futureCoverage=w.eval(`(()=>{
  const indexD=getDetail(mainIndex);indexD.outlookSession=twDate(Date.now())+'|settled';indexD.outlookAttempt=Date.now();
  const out=[];
  for(const id of ['TX','MTX','TMF','TE','TF','XIF']){
   const m={id,name:futuresProducts[id].name,market:'期交所',type:'期貨',contract:'近月'};state.watch.push(m);state.id=id;
   const d=getDetail(m);d.daily={bars:Array.from({length:8},(_,i)=>({t:Date.parse('2026-11-03T05:45:00Z')+i*86400000,c:42000+i,o:42000,h:42100,l:41900,v:1000,contract:'202611'})),source:'TEST FUTURE'};
   if(hasTaiexBasis(m))d.outlookProxy=indexD;
   state.items.set(id,{price:41500,prev:42000,ts:Date.now(),source:'TEST FIXTURE',open:42000,high:42100,low:41400});
   render();const panel=el('researchMarket');
   out.push({id,cards:panel.querySelectorAll('.outlook-card').length,scope:panel.textContent,percent:[...panel.querySelectorAll('.outlook-value strong')].map(e=>e.textContent)});
  }
  return out;
 })()`);
 for(const item of futureCoverage){
  ok(item.cards===3,'three-horizon coverage for futures '+item.id);
  if(['TX','MTX','TMF'].includes(item.id))ok(item.scope.includes('標的加權指數歷史比例')&&item.scope.includes('非契約獲利機率'),'reference statistics visibly scoped to underlying for '+item.id);
  else ok(item.percent.every(p=>p==='—')&&item.scope.includes('不混用加權指數樣本'),'no cross-product fabricated probabilities for '+item.id);
 }
 const night=w.eval(`(()=>{
  state.id='MTX';const m=selected(),d=getDetail(m),q=quoteFor(m);outlookView(m,q,d);
  const key=d.outlookProxy.outlookResult.key,first=outlookSnapshot(m,q,d).horizons[0].currentCondition;
  q.price=43000;q.ts+=1000;outlookView(m,q,d);
  return {same:d.outlookProxy.outlookResult.key===key,first,second:outlookSnapshot(m,q,d).horizons[0].currentCondition,html:outlookView(m,q,d)};
 })()`);
 ok(night.same&&night.first.direction===-1&&night.second.direction===1,'night futures update native conditions without moving stale cash statistics');
 ok(night.html.includes('現貨比例不會假裝隨夜盤即時更新'),'night scope is visible to beginners');
 const futuresPrompt=w.eval('buildPrompt(selected())');
 const futuresPayload=JSON.parse(futuresPrompt.split('資料 JSON：\n')[1]);
 ok(futuresPayload.historicalOutlook.referenceOnly===true&&futuresPayload.contract==='近月','AI receives futures reference scope and selected contract');
 ok(futuresPrompt.includes('未平倉增加不能單獨當成多頭')&&futuresPrompt.includes('不能假設目前近月契約可持有 120 日'),'AI futures instructions guard OI and expiry misinterpretation');
 w.__reportTest='### 重點摘要\n- 【偏多】**看多重點**\n- **【偏空】** **風險重點**\n- 【中性】等待確認\n- 【偏多】<img src=x onerror=alert(1)>';
 const colored=w.eval('aiReport(__reportTest)');
 const report=w.document.createElement('div');report.innerHTML=colored;
 ok(report.querySelector('.report-summary')&&report.querySelectorAll('.report-line.report-positive').length===2&&report.querySelector('.report-line.report-risk')&&report.querySelector('.report-line.report-neutral'),'AI summary and all three semantic colors render deterministically');
 ok(report.querySelectorAll('img,script').length===0&&report.textContent.includes('<img'),'AI raw HTML remains escaped despite color markers');
 ok(report.querySelector('.report-positive strong').textContent==='看多重點','bold highlights survive colored rendering');
 w.eval(`state.id='2884';const d=getDetail(selected());d.outlookSession=twDate(Date.now())+'|settled';d.outlookAttempt=Date.now();d.news=null;d.newsError='';d.newsAt=0;state.rules['2884']={cost:777.77,lots:1,target:999,stop:500};render();`);
 const countBefore=newsCalls;
 await Promise.all([w.eval('ensureAINews(selected(),getDetail(selected()))'),w.eval('ensureAINews(selected(),getDetail(selected()))')]);
 ok(newsCalls===countBefore+1,'concurrent research/AI requests coalesce into one news fetch');
 const news=w.eval('getDetail(selected()).news');
 ok(news[0].summary.includes('測試摘要')&&!news[0].summary.includes('<b>'),'RSS summaries are supplied as inert plain text');
 const stockPrompt=w.eval('buildPrompt(selected())'),payload=JSON.parse(stockPrompt.split('資料 JSON：\n')[1]);
 ok(payload.news.items[0].title.includes('測試新聞')&&payload.news.items[0].publishedAt==='2026-11-16T02:30:00.000Z','AI receives actual loaded news with publication time');
 ok(!Object.hasOwn(payload,'position')&&JSON.parse(w.eval('buildPrompt(selected(),true)').split('資料 JSON：\n')[1]).position.cost===777.77,'position data still requires the existing explicit opt-in');
 ok(stockPrompt.includes('不得自己創造其他百分比')&&stockPrompt.includes('不可信的資料'),'AI cannot relabel statistics or follow instructions inside news');
 ok(Buffer.byteLength(JSON.stringify({input:stockPrompt}))<96000,'full current-data prompt fits existing server size limit');
 w.eval("modal('ai','2884')");await wait(40);
 w.document.querySelector('[data-field=provider]').value='openai';w.document.querySelector('[data-field=apiKey]').value='test-key-1234567890';
 await w.eval('askAI(false)');await wait(30);
 ok(apiCalls.length===1&&JSON.parse(apiCalls[0].input.split('資料 JSON：\n')[1]).news.items.length>0,'actual API request is prepared with news before submission');
 ok(savedReports.length===1&&w.document.querySelector('.research-ai .report-summary'),'generated colored summary is saved and appears in the real AI panel');
 // Closing the dialog during an awaited refresh must not issue an API request.
 newsFailure=false;w.eval(`const pendingD=getDetail(selected());pendingD.news=null;pendingD.newsAt=0;pendingD.newsError='';pendingD.newsAttemptAt=0;cache.delete('news:'+selected().id);modal('ai','2884');`);
 w.document.querySelector('[data-field=apiKey]').value='test-key-1234567890';
 const cancelled=w.eval('askAI(false)');w.eval('closeModal()');await cancelled;
 ok(apiCalls.length===1&&!w.eval('aiPreparing'),'closing during preparation cancels generation and releases busy state');
 // Source failure must preserve old news, mark the failure and not fabricate new facts.
 newsFailure=true;w.eval(`const staleD=getDetail(selected());staleD.newsAt=Date.now()-3600000;staleD.newsAttemptAt=0;cache.delete('news:'+selected().id);`);
 await w.eval('ensureAINews(selected(),getDetail(selected()))');
 const stalePayload=JSON.parse(w.eval('buildPrompt(selected())').split('資料 JSON：\n')[1]);
 ok(stalePayload.news.fetchError&&stalePayload.news.items.length===1,'news outage retains dated previous items and passes an explicit failure flag');
'''
needle=" w.eval('exited=true');await wait(100);"
assert needle in s;s=s.replace(needle,extra+needle)
Path('tests/markets-ai-v0240.cjs').write_text(s)
