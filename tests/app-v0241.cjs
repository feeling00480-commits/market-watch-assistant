const {JSDOM,VirtualConsole}=require('/tmp/cas-dom/node_modules/jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let checks=0;const ok=(v,s)=>{assert(v,s);checks++;console.log('PASS',s)};
const cfg={watch:[{id:'3227',name:'原相',market:'櫃買中心 · 上櫃',type:'個股',exchange:'otc'}],rules:{'3227':{cost:206.5,lots:3,stop:180,target:250,enabled:true}},updatedAt:Date.now()-10000,chartPeriod:'day',chartMonths:6,backup:{enabled:true,minutes:5},update:{enabled:false,autoDownload:false}};
let disk=null,saves=0,notices=0,ready=0;const errors=[];
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
 w.eval('exited=true');await wait(100);
 ok(errors.length===0,'no uncaught script or DOM initialization errors in the bundled app');
 console.log('Integrated DOM checks passed',checks);
 dom.window.close();
})().catch(e=>{console.error(e,errors);dom.window.close();process.exit(1)});
