const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const providers=fs.readFileSync('v0239/providers.js','utf8');
const client=fs.readFileSync('v0239/client.js','utf8');
let count=0;
function ok(value,label){assert(value,label);count++;console.log('PASS',label);}
function harness(){
 const store=new Map(),calls=[],timers=new Map();let now=1794416400000,seq=0;
 const h={store,calls,timers,route:async()=>{throw Error('fixture unavailable')},advance:n=>now+=n};
 const context={console,URL,URLSearchParams,Headers,AbortSignal,TextDecoder,Intl,
 Date:class extends Date{static now(){return now}},location:{protocol:'http:',hostname:'localhost',port:'18888',hash:'',pathname:'/'},
 history:{replaceState(){}},sessionStorage:{getItem:()=> '0'.repeat(32)},
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
 fetch:async url=>{const path=url.slice(2);calls.push(path);const value=await h.route(path);return {ok:true,text:async()=>typeof value==='string'?value:JSON.stringify(value)}}};
 vm.createContext(context);
 vm.runInContext(providers+`\nthis.api={catalogRows,cachedCatalog,fullCatalog,resolveTaiwanCode,catalogState,catalogMarkets,cache,csvRecords,symbolFor,batchMIS};`,context);
 h.api=context.api;h.context=context;
 h.ui=()=>{
  vm.runInContext(`
   const state={modal:'add',watch:[],rules:{},items:new Map(),details:new Map(),tracking:new Map(),watchPins:[],watchOrder:[]};
   const defaults=[{id:'TAIEX',name:'加權指數',market:'指數',exchange:'tse'},...Object.entries(futuresProducts).map(([id,p])=>({id,name:p.name,market:'期貨'}))];
   const intradaySamples=new Map(),pendingQuotes=new Map();let exited=false;
   let renders=0,saves=0,refreshes=0,detailLoads=0;
   function persist(){saves++}function render(){renders++}function refresh(){refreshes++}function loadDetails(){detailLoads++}function selected(){return state.watch[0]}
   const input={value:'',isConnected:true},results={innerHTML:''};
   const dialog={querySelector:()=>input};
   const el=key=>key==='dialog'?dialog:results;
   const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  `+client.slice(client.indexOf('let searchMatches='),client.indexOf('let settingsBusy='))+`
  this.ui={state,input,results,intradaySamples,loadSearch,reconcileCatalogWatch,extraMarketCandidate,matches:()=>searchMatches,counters:()=>({renders,saves,refreshes,detailLoads})};`,context);
  return context.ui;
 };
 return h;
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
(async()=>{
 let h=harness(),a=h.api;
 const known=a.catalogRows([{Code:'2330',Name:'台積電'},{Code:'0050',Name:'元大台灣50'},{Code:'00999A',Name:'測試ETF'},{Code:'',Name:'壞資料'},{Code:'3227',Name:'3227'}],'tse');
 ok(known.length===3&&known[1].type==='ETF'&&known[2].type==='ETF','listed stocks, ETFs and alphabetic suffixes parse; placeholders rejected');
 const otc=a.catalogRows([{ ' 公司代號 ':'3227',' 公司簡稱 ':'原相',公司名稱:'原相科技股份有限公司'},{SecuritiesCompanyCode:'6488',CompanyName:'環球晶'},{Code:'8299',SecuritiesCompanyName:'群聯'}],'otc');
 ok(otc.length===3&&otc.every(r=>r.exchange==='otc')&&otc[0].name==='原相','3227, 6488, 8299 and alternate official field names retain OTC classification');
 ok(a.csvRecords('\uFEFF公司代號,公司簡稱\r\n9999,"測試,興櫃"\r\n')[0]['公司簡稱']==='測試,興櫃','CSV BOM, CRLF and quoted commas parse');
 h.route=async path=>{
  if(path==='names')return [{Code:'2330',Name:'台積電'},{Code:'0050',Name:'元大台灣50'}];
  if(path==='otc-names-csv')return '\uFEFF公司代號,公司簡稱\r\n3227,原相\r\n6488,環球晶\r\n8299,群聯\r\n';
  if(path==='esb-names-csv')return '公司代號,公司簡稱\n9999,測試興櫃\n';
  throw Error('fixture source failure');
 };
 let rows=await a.fullCatalog(()=>{throw Error('UI callback failure')});
 ok(rows.length===6&&a.catalogState.missing.length===0,'cross-host CSV fallback restores multiple OTC and ESB stocks despite primary failures');
 const calls=h.calls.length;await a.fullCatalog();
 ok(h.calls.length===calls,'complete catalog uses six-hour memory cache');
 h.advance(6*3600000+1);h.route=async()=>{throw Error('outage')};await a.fullCatalog();
 ok(a.catalogState.rows.length===6&&a.catalogState.missing.length===3,'total outage preserves previously verified names and marks missing markets');
 const failedCalls=h.calls.length;await a.fullCatalog();ok(h.calls.length===failedCalls,'incomplete catalog avoids immediate retry loops');
 h.advance(60001);await a.fullCatalog();ok(h.calls.length>failedCalls,'incomplete catalog retries after one minute instead of six hours');
 h.advance(8*86400000);await a.fullCatalog();ok(a.cachedCatalog().length===0,'failed refresh does not extend the freshness of old catalog data');
 h=harness();a=h.api;
 h.route=async path=>{if(path.startsWith('mis/'))return {msgArray:[{c:'3227',ex:'otc',n:'原相',z:'-'}]};throw Error('offline')};
 const resolved=await a.resolveTaiwanCode('3227');
 ok(resolved?.name==='原相'&&resolved.exchange==='otc','single-code lookup identifies market even without a current trade price');
 ok(decodeURIComponent(h.calls[0]).includes('tse_3227.tw|otc_3227.tw'),'single-code lookup verifies both listed and OTC channels');
 ok(a.symbolFor(resolved)==='3227.TWO','OTC quotes use the TWO symbol');
 await a.batchMIS([resolved]);ok(decodeURIComponent(h.calls.at(-1)).includes('otc_3227.tw'),'OTC quote request uses the correct exchange channel');
 h=harness();a=h.api;
 h.route=async()=>({msgArray:[{c:'1234',ex:'tse',n:'其他公司'}]});ok(await a.resolveTaiwanCode('3227')===null,'unrelated source response cannot classify an unknown code');
 h.route=async()=>({msgArray:[{c:'3227',ex:'tse',n:'測試'},{c:'3227',ex:'otc',n:'原相'}]});ok(await a.resolveTaiwanCode('3227')===null,'ambiguous exchange response stays unresolved');
 const ui=h.ui();
 const rules={cost:206.5,target:250,stop:180,enabled:true};
 ui.state.watch.push({id:'3227',name:'3227',exchange:'tse',market:'證交所 · 代號查詢',type:'個股'});
 ui.state.rules['3227']=rules;ui.state.watchPins.push('3227');ui.state.watchOrder.push('3227');
 ui.state.items.set('3227',{price:160});ui.state.details.set('3227',{wrong:true});ui.state.tracking.set('3227',{wrong:true});ui.intradaySamples.set('3227',[1]);
 ui.reconcileCatalogWatch([resolved]);await tick();
 ok(ui.state.watch[0].exchange==='otc'&&ui.state.watch[0].name==='原相','existing incorrectly added watch item is corrected');
 ok(ui.state.rules['3227']===rules&&rules.cost===206.5&&rules.target===250&&ui.state.watchPins[0]==='3227'&&ui.state.watchOrder[0]==='3227','cost, target, stop, pins and custom order survive correction');
 ok(!ui.state.items.size&&!ui.state.details.size&&!ui.state.tracking.size&&!ui.intradaySamples.size&&ui.counters().refreshes===1,'old exchange quote caches are cleared and quote reload is scheduled');
 ui.state.watch.push({id:'US:TX',name:'Ternium',exchange:'us'},{id:'TX',name:'台指期'});
 ui.reconcileCatalogWatch([{id:'US:TX',name:'wrong',exchange:'otc'},{id:'TX',name:'wrong',exchange:'tse'}]);
 ok(ui.state.watch[1].exchange==='us'&&ui.state.watch[2].name==='台指期','US and futures identities are never migrated by Taiwan catalog');
 a.catalogState.rows=[resolved];a.catalogState.at=Date.now()+1e12;
 ui.input.value='3227';ui.loadSearch();await tick();
 ok(ui.matches().length===1&&ui.matches()[0].name==='原相'&&ui.results.innerHTML.includes('上櫃'),'authoritative stock name and OTC label appear in search results');
 ui.input.value='原相';ui.input.oninput();ok(ui.matches().some(m=>m.id==='3227'),'stock is searchable by company short name');
 ui.input.value='US:TX';ui.input.oninput();ok(ui.matches().some(m=>m.id==='US:TX'&&m.exchange==='us'),'explicit US namespace remains available');
 ui.input.value='微台';ui.input.oninput();ok(ui.matches().some(m=>m.id==='TMF'),'futures aliases remain searchable');
 ui.input.value='8888';ui.input.oninput();ok(!ui.matches().some(m=>m.id==='8888'),'unknown numeric code is not offered as an assumed listed stock');
 let completeOld;
 h.route=async path=>{if(path.startsWith('mis/'))return new Promise(resolve=>{completeOld=resolve});throw Error('offline')};
 const oldTimer=[...h.timers.values()].at(-1);const pending=oldTimer();await tick();
 ui.input.value='3227';ui.input.oninput();completeOld({msgArray:[{c:'8888',ex:'otc',n:'舊查詢'}]});await pending;await tick();
 ok(ui.matches().length===1&&ui.matches()[0].id==='3227'&&!ui.results.innerHTML.includes('舊查詢'),'late lookup responses cannot overwrite a newer input');
 ui.input.value='<img>';ui.input.oninput();ok(!ui.results.innerHTML.includes('<img>'),'search status remains escaped');
 const rctx={console,Date,Promise,Map};vm.createContext(rctx);
 vm.runInContext(`
 const state={watch:[{id:'3227',name:'3227',exchange:'tse'}],rules:{'3227':{}},items:new Map(),details:new Map(),events:[],run:true,id:'3227'};
 let resolveQuote,evaluations=0;
 const liveQuote=()=>new Promise(resolve=>{resolveQuote=resolve});const batchMIS=()=>null;
 const quoteFor=m=>state.items.get(m.id),isFuture=()=>false,recordIntraday=()=>{},canAlertTradeSides=()=>false;
 const getDetail=()=>({}),conditions=()=>[],fresh=()=>true,addEvent=()=>{},alertSession=()=>false;
 const evaluated=()=>evaluations++,scheduledSnapshot=()=>{},log=()=>{},message=e=>e.message;
 `+client.slice(client.indexOf('async function refreshQuotes('),client.indexOf('function select(id)'))+`
 this.rt={state,refreshQuotes,complete:q=>resolveQuote(q),evaluations:()=>evaluations};`,rctx);
 const rt=rctx.rt,oldItem={...rt.state.watch[0]},inflight=rt.refreshQuotes([oldItem],true,'mis');
 rt.state.watch[0].exchange='otc';rt.state.items.set('3227',{price:200,ts:20});
 rt.complete({price:160,ts:10,source:'fixture',bars:[]});await inflight;
 ok(rt.state.items.get('3227').price===200&&rt.evaluations()===0,'in-flight old-market quote cannot overwrite the corrected market or trigger price alerts');
 console.log(`Search regression checks passed: ${count}`);
})().catch(e=>{console.error(e);process.exit(1)});
