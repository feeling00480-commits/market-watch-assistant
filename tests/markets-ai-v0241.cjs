const {JSDOM,VirtualConsole}=require('/tmp/cas-dom/node_modules/jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let checks=0;const ok=(v,s)=>{assert(v,s);checks++;console.log('PASS',s)};
const cfg={watch:[{id:'3227',name:'原相',market:'櫃買中心 · 上櫃',type:'個股',exchange:'otc'}],rules:{'3227':{cost:206.5,lots:3,stop:180,target:250,enabled:true}},updatedAt:Date.now()-10000,chartPeriod:'day',chartMonths:6,backup:{enabled:true,minutes:5},update:{enabled:false,autoDownload:false}};
let disk=null,saves=0,notices=0,ready=0,newsCalls=0,newsFailure=false;const apiCalls=[],savedReports=[];const errors=[];
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>{if(!e.message.includes('Not implemented: navigation'))errors.push(e.message)});
const dom=new JSDOM(fs.readFileSync('v0241/app.html','utf8'),{url:'http://localhost:18888/#'+'0'.repeat(32),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(w){
 w.ResizeObserver=class{observe(){}};w.Headers=Headers;w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
 w.localStorage.setItem('market-watch-assistant-v02',JSON.stringify(cfg));
 w.fetch=async(url,options={})=>{
  const path=String(url).replace(/^\.\//,'');let status=200,value;
  if(path==='settings-current')value={current:disk,path:'C:\\Users\\Charlie\\AppData\\Local\\MarketWatchAssistant\\UserData\\Settings'};
  else if(path==='settings-save'){
   const req=JSON.parse(options.body);if(req.baseRevision!==(disk?.revision||'')){status=409;value={}}else{
    const revision=crypto.createHash('sha256').update(JSON.stringify(req.pack)).digest('hex');disk={pack:req.pack,revision,source:'current'};saves++;value={revision,path:'shared-settings',savedAt:req.pack.savedAt};
   }
  }else if(path==='settings-backups')value={items:[{id:'20261111T100000000Z_12345678.json',updatedAt:Date.now()-20000,count:1}]};
  else if(path.startsWith('settings-backup/')){const old=structuredClone(disk.pack);old.data.rules['3227'].cost=188;value={pack:old};}
  else if(path==='update-status')value={busy:false,state:{status:'current',message:'目前已是最新版本'}};
  else if(path==='telegram-status')value={enabled:false,chat:''};
  else if(path==='app-ready'){ready++;value={};ok(JSON.parse(options.body).update.enabled===false,'startup sends disabled-update preference to server');}
  else if(path==='desktop-notice'){notices++;value={channel:'popup'};}
  else if(path==='names')value=[{Code:'2330',Name:'台積電'}];
  else if(path==='otc')value=[{SecuritiesCompanyCode:'3227',CompanyName:'原相'}];
  else if(path==='esb-names')value=[{公司代號:'9999',公司簡稱:'測試興櫃'}];
  else if(path.startsWith('news/')){
   newsCalls++;await new Promise(r=>setTimeout(r,15));
   if(newsFailure)return {ok:false,status:503,text:async()=>''};
   return {ok:true,status:200,text:async()=>'<rss><channel><item><title>測試新聞：營收與市場動態</title><link>https://example.com/news/test</link><source>TEST SOURCE</source><pubDate>Mon, 16 Nov 2026 02:30:00 GMT</pubDate><description>&lt;b&gt;測試摘要&lt;/b&gt;，不是新聞全文。</description></item></channel></rss>'};
  }
  else if(path==='openai'){
   apiCalls.push(JSON.parse(options.body));
   value={output:[{content:[{text:'### 重點摘要\n- 【偏多】**價格高於均線**，仍需確認。\n- 【偏空】**成交不足**，留意失效。\n### 短線展望（5 個交易日）\n- 【中性】依條件觀察。'}]}]};
  }
  else if(path==='ai-record'){savedReports.push(JSON.parse(options.body));value={saved:true};}
  else if(path.startsWith('mis/'))value={msgArray:[]};
  else{status=503;value={};}
  return {ok:status<400,status,text:async()=>JSON.stringify(value)};
 };
}});
const w=dom.window;
const wait=async(ms=20)=>new Promise(r=>setTimeout(r,ms));
const click=a=>{const button=w.document.querySelector('[data-act="'+a+'"]');assert(button,'button '+a);button.click();};
(async()=>{
 await wait(60);ok(!w.eval('appBooting')&&ready===1,'complete bundled app boots through shared-settings initialization');
 ok(w.eval('state.rules["3227"].cost')===206.5,'legacy browser position remains available after startup');
 click('settings');click('backups');await wait();
 ok(w.document.querySelector('[data-el=dialog]').textContent.includes('使用者設定備份')&&w.document.querySelector('[data-el=backupPath]').textContent.includes('Settings'),'backup and update dialog is reachable with a visible storage path');
 click('backupNow');await wait();ok(saves>=1&&disk.pack.data.rules['3227'].cost===206.5,'manual backup button writes the actual settings envelope');
 click('backupHistoryLoad');await wait();
 ok(w.document.querySelector('[data-el=backupPreview]').textContent.includes('確認還原設定')&&w.eval('state.rules["3227"].cost')===206.5,'history preview does not apply settings before confirmation');
 click('backupRestoreConfirm');await wait();ok(w.eval('state.rules["3227"].cost')===188&&!w.eval('state.run'),'confirmed history restore applies settings and leaves monitoring paused');
 w.document.querySelector('[data-field=backupMinutes]').value='15';click('backupOptions');await wait();
 ok(w.eval('state.backup.minutes')===15&&disk.pack.data.backup.minutes===15,'backup cadence controls persist through the same shared file');
 click('settings');click('test');await wait();
 ok(notices===1&&w.document.querySelector('[data-el=noticeTestStatus]').textContent.includes('已開啟'),'desktop alert test route remains connected after settings restore');
 click('close');click('add');await wait();
 const input=w.document.querySelector('[data-field=search]');input.value='3227';input.dispatchEvent(new w.Event('input',{bubbles:true}));await wait();
 ok(w.document.querySelector('[data-el=results]').textContent.includes('原相')&&w.document.querySelector('[data-el=results]').textContent.includes('上櫃'),'stock search still identifies 3227 in the integrated app');

 click('close');
 w.Date.now=()=>Date.parse('2026-11-16T03:00:00Z');
 w.eval(`
 const fixtureMarket={id:'2884',name:'玉山金',market:'證交所 · 上市',type:'個股',exchange:'tse'};
 state.watch=[fixtureMarket];state.id='2884';state.tab='research';
 let seed=123456,price=50;const fixtureBars=[];
 let stamp=Date.parse('2002-01-03T01:00:00Z');
 for(let i=0;i<6000;i++){
  while([0,6].includes(new Date(stamp).getUTCDay()))stamp+=86400000;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;price*=Math.exp((seed/2**32-.49)*.05);
  fixtureBars.push({t:stamp,c:price,a:price,o:price,h:price*1.01,l:price*.99,v:1000000,date:twDate(stamp)});stamp+=86400000;
 }
 // Anchor synthetic history to the actual prior market day for this UI fixture.
 const shift=Date.parse('2026-11-13T01:00:00Z')-fixtureBars.at(-1).t;
 for(const bar of fixtureBars){bar.t+=shift;bar.date=twDate(bar.t);}
 const fixtureDetail=getDetail(fixtureMarket);fixtureDetail.daily={bars:fixtureBars.slice(-250),source:'TEST FIXTURE',months:12};
 fixtureDetail.outlookHistory={bars:fixtureBars,loadedAt:1};fixtureDetail.outlookPrepared=outlookPrepared(fixtureBars);
 fixtureDetail.outlookValidation=outlookSpec.map(spec=>outlookValidation(fixtureDetail.outlookPrepared,spec));
 fixtureDetail.fund={pe:20,pb:2.78,yield:2.9,month:'2026-09',source:'TEST FIXTURE'};
 state.items.set('2884',{price,prev:price,ts:Date.now(),source:'TEST FIXTURE'});render();
 `);
 const $=selector=>w.document.querySelector(selector);
 ok($('[data-el=name] .instrument-code')?.textContent==='2884','stock code appears beside the name in the real header');
 ok(w.document.querySelectorAll('.outlook-card').length===3,'all three horizon cards render in the bundled app');
 ok([...w.document.querySelectorAll('.outlook-card')].every(card=>[...card.querySelectorAll('.outlook-value strong')].reduce((sum,n)=>sum+parseInt(n.textContent),0)===100),'all displayed class proportions sum to 100');
 const numbers=$('[data-research-detail=numbers]');
 ok(numbers&&!numbers.open&&numbers.textContent.includes('本益比')&&numbers.textContent.includes('MA20'),'technical and valuation numbers are collapsed by default');
 ok($('.outlook').compareDocumentPosition($('.radar-layout'))&w.Node.DOCUMENT_POSITION_FOLLOWING,'radar is rendered below the new horizon section');
 ok($('.outlook-intro').textContent.includes('盤中暫估')&&$('.outlook-caution').textContent.includes('尚未驗證'),'live provisional estimate has a visible qualification');
 const beforeKey=w.eval('getDetail(selected()).outlookResult.key');
 numbers.open=true;$('[data-outlook-detail="5"]').open=true;
 w.eval(`state.items.get('2884').price*=1.04;state.items.get('2884').ts+=1000;render();`);
 ok(w.eval('getDetail(selected()).outlookResult.key')!==beforeKey,'incoming price changes recompute the actual displayed estimate');
 ok($('[data-research-detail=numbers]').open&&$('[data-outlook-detail="5"]').open,'quote updates preserve user-opened details');
 ok($('[data-outlook-detail="5"]').textContent.includes('個百分點'),'new result describes its change from the prior distinct estimate');
 w.eval(`state.items.get('2884').delayed=true;render();`);
 ok(!$('.outlook-intro').textContent.includes('盤中暫估'),'delayed quotes revert to completed-daily analysis in the UI');
 w.eval(`state.watch.push({id:'2330',name:'台積電',market:'證交所 · 上市',type:'個股',exchange:'tse'});state.id='2330';render();`);
 ok(!$('[data-research-detail=numbers]').open&&w.document.querySelectorAll('.outlook-card').length===3&&[...w.document.querySelectorAll('.outlook-value strong')].every(e=>e.textContent==='—'),'changing stocks resets disclosures and never shows another stock’s percentages');
 w.eval(`state.id='2884';state.items.get('2884').delayed=false;render();setChartPeriod('day');state.months=3;`);
 const chart=$('[data-el=chart]');
 Object.defineProperty(chart,'clientWidth',{configurable:true,value:900});Object.defineProperty(chart,'clientHeight',{configurable:true,value:320});
 chart.getBoundingClientRect=()=>({left:0,top:0,width:900,height:320});
 chart.setPointerCapture=()=>{};chart.hasPointerCapture=()=>false;chart.releasePointerCapture=()=>{};
 w.eval('drawChart()');
 const first=w.eval('chartCursor.bars[0].t');
 w.eval(`startChartPan({button:0,isPrimary:true,pointerId:1,clientX:400,currentTarget:plot});moveChartPan({pointerId:1,clientX:550,preventDefault(){}});endChartPan({pointerId:1});`);
 ok(w.eval('chartCursor.bars[0].t')<first,'K chart still pans left through history after adding the module');
 const quotePanel=$('[data-el=quotePanel]'),wheel=new w.WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true,clientX:300});
 quotePanel.dispatchEvent(wheel);ok(wheel.defaultPrevented,'chart wheel remains isolated from page scrolling');
 const alertChecks=w.eval(`(()=>{
 const m=selected(),q={price:160,source:'TEST'};
 const rule={cost:206.5,target:250,stop:150,targetNear:1,enabled:true};
 return [pricePlanHit(m,q,rule)===null,pricePlanHit(m,{...q,price:248},rule)[0]==='targetNear',pricePlanHit(m,{...q,price:250},rule)[0]==='target',pricePlanHit(m,{...q,price:149},rule)[0]==='stop'];
 })()`);
 ok(alertChecks.every(Boolean),'price 160/cost 206.5 never triggers target; near-target, target and stop directions remain correct');

 const sessions=w.eval(`(()=>{
  const cases=[
   [{id:'2884',exchange:'tse'},'2026-11-16T03:00:00Z'],
   [{id:'TMF',contract:'近月'},'2026-11-16T13:00:00Z'],
   [{id:'US:AAPL',exchange:'us'},'2026-11-16T15:00:00Z'],
   [{id:'9999',exchange:'esb'},'2026-11-16T06:00:00Z']
  ];
  return cases.map(([m,date])=>{const ts=Date.parse(date);return Boolean(alertSession(m,{ts,price:100,prev:99},ts));});
 })()`);
 ok(sessions.every(Boolean),'Taiwan stocks, futures night session, US and ESB all retain valid alert sessions');

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
 w.eval('exited=true');await wait(100);
 ok(errors.length===0,'no uncaught script or DOM initialization errors in the bundled app');
 console.log('Integrated DOM checks passed',checks);
 dom.window.close();
})().catch(e=>{console.error(e,errors);dom.window.close();process.exit(1)});
