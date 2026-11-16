const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=['appearance.js','settings-data.js','settings-ui.js'].map(f=>fs.readFileSync('v0240/'+f,'utf8')).join('\n');
let checks=0;function ok(v,s){assert(v,s);checks++;console.log('PASS',s)}
const fixture=()=>({watch:[{id:'3227',name:'原相',market:'櫃買中心 · 上櫃',type:'個股',exchange:'otc'},{id:'US:AAPL',name:'Apple',market:'美股 · USD',exchange:'us'},{id:'TMF',name:'微型台指期',market:'期貨',contract:'次月'}],rules:{'3227':{cost:206.5,lots:3,target:250,stop:180,entry:200,targetNear:1,enabled:true,sidePct:0},'US:AAPL':{lots:5,cost:200},TMF:{stop:42000}},watchOrder:['TMF','3227','US:AAPL'],watchPins:['3227'],watchSort:'custom',seconds:0,chartPeriod:'day',chartMonths:6,profileDays:30,appearance:{theme:'ocean',font:16},updatedAt:Date.now()-10000});
function harness(local=fixture(),present=true){
 let disk=null,posts=[],failure=null;
 const h={setDisk:p=>disk=p,getDisk:()=>disk,posts,fail:v=>failure=v};
 const ctx={console,Date,URL,Blob,Promise,Set,Map,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
 localStorage:{setItem:(k,v)=>h.local=JSON.parse(v)},bridge:async(path,options)=>{
  if(path==='settings-save'){
   const body=JSON.parse(options.body);posts.push(body);
   if(failure)throw Object.assign(Error('HTTP '+failure),{status:failure});
   if(body.baseRevision!==(disk?.revision||''))throw Object.assign(Error('HTTP 409'),{status:409});
   const revision=crypto.createHash('sha256').update(JSON.stringify(body.pack)).digest('hex');disk={pack:body.pack,revision,source:'current'};
   return JSON.stringify({revision,path:'C:\\Users\\Charlie\\AppData\\Local\\MarketWatchAssistant\\UserData\\Settings',savedAt:body.pack.savedAt});
  }return '{}';
 },json:async path=>{
  if(path==='settings-current'){if(failure===500)throw Error('HTTP 500');return {current:disk,path:'shared-settings'}}
  if(path==='settings-backups')return {items:[]};return {};
 }};
 vm.createContext(ctx);
 vm.runInContext(`const futuresProducts={TX:{},MTX:{},TMF:{},TE:{},TF:{},XIF:{}};`+source+`
 const storage='fixture';let browserSettingsPresent=${present};const sessionReady=true;
 const state={...cleanSettings(${JSON.stringify(local)}),items:new Map(),details:new Map(),tracking:new Map(),events:[],run:true};
 let chartPreferredPeriod=state.chartPeriod,schedule,chartZoom,chartWheelSize,chartHover;
 const dueQuotes=new Map(),intradaySamples=new Map(),root={style:{setProperty(){}}};
 const nodes={backupStatus:{},backupPath:{},backupPreview:{},dialog:{querySelector:()=>({})}};
 const el=k=>nodes[k];const log=e=>state.events.push(e),render=()=>{},setChartPeriod=p=>state.period=p;
 const message=e=>e.message;const twDate=t=>new Date(t).toISOString().slice(0,10),twTime=t=>new Date(t).toISOString().slice(11,19);
 const selected=()=>state.watch[0],modal=()=>{},refresh=()=>{},loadDetails=()=>{},persist=()=>{},esc=s=>String(s);
 settingsChangedAt=state.updatedAt||0;appBooting=false;
 this.api={state,settingsEnvelope,readSettingsEnvelope,cleanSettings,settingsData,settingsComparable,settingsBackupState,initSettingsBackup,writeSettingsBackup,applySettingsData,backupAction,queueSettingsBackup,
 setTime:n=>settingsChangedAt=n,setDraft:p=>settingsBackupState.draft=p};`,ctx);
 h.api=ctx.api;h.ctx=ctx;return h;
}
(async()=>{
 let h=harness(),a=h.api;
 const input=fixture();input.token='secret';input.apiKey='secret';input.rules['3227'].apiKey='secret';input.watch[0].token='secret';
 const clean=a.cleanSettings(input),encoded=JSON.stringify(a.settingsEnvelope(clean));
 ok(!encoded.includes('secret')&&!encoded.includes('apiKey')&&!encoded.includes('token'),'backup whitelist excludes provider credentials and unrelated fields');
 ok(clean.rules['3227'].cost===206.5&&clean.rules['3227'].lots===3&&clean.rules['3227'].stop===180&&clean.rules['3227'].target===250,'cost, position size and price plans round-trip exactly');
 ok(clean.watch[2].contract==='次月'&&clean.watch[1].exchange==='us'&&clean.watchPins[0]==='3227'&&clean.chartMonths===6&&clean.profileDays===30,'futures contracts, US identities, pins, order and chart settings survive');
 for(const [label,mutate] of [['duplicate symbols',x=>x.watch.push(x.watch[0])],['invalid exchange',x=>x.watch[0].exchange='us'],['negative cost',x=>x.rules['3227'].cost=-1],['invalid near threshold',x=>x.rules['3227'].targetNear=101],['invalid side ratio',x=>x.rules['3227'].sidePct=25],['invalid futures month',x=>x.watch[2].contract='other']]){
  const bad=fixture();mutate(bad);assert.throws(()=>a.cleanSettings(bad));ok(true,'rejects '+label);
 }
 assert.throws(()=>a.readSettingsEnvelope({...a.settingsEnvelope(fixture()),schemaVersion:2}));ok(true,'newer backup formats cannot silently overwrite supported settings');
 const empty=fixture();empty.watch=[];empty.rules={};ok(a.cleanSettings(empty).watch.length===0,'intentional empty watchlist remains empty');
 await a.initSettingsBackup();await a.writeSettingsBackup();
 ok(h.posts.length===1&&h.getDisk().pack.data.watch.length===3&&a.settingsBackupState.ready,'first startup migrates existing browser settings to a shared file');
 await a.writeSettingsBackup();ok(h.posts.length===1,'unchanged automatic backup does not create duplicate snapshots');
 await a.writeSettingsBackup(true);ok(h.posts.length===2&&h.posts[1].snapshot,'manual backup creates a recoverable snapshot even without changes');
 h=harness(fixture(),false);a=h.api;
 let disk=fixture();disk.rules['3227'].cost=188;disk.updatedAt=Date.now()-1000;
 h.setDisk({pack:a.settingsEnvelope(disk),revision:'a'.repeat(64),source:'current'});await a.initSettingsBackup();
 ok(a.state.rules['3227'].cost===188&&a.settingsBackupState.ready&&a.state.run===false,'new browser/version automatically reads shared settings before monitoring');
 h=harness();a=h.api;disk=fixture();disk.rules['3227'].cost=150;disk.updatedAt=Date.now()-30000;
 h.setDisk({pack:a.settingsEnvelope(disk),revision:'b'.repeat(64),source:'current'});await a.initSettingsBackup();
 ok(a.state.rules['3227'].cost===206.5,'older disk backup does not replace newer timestamped browser settings');
 h=harness();a=h.api;a.setTime(0);disk=fixture();disk.rules['3227'].cost=150;
 h.setDisk({pack:a.settingsEnvelope(disk),revision:'c'.repeat(64),source:'current'});await a.initSettingsBackup();
 ok(!a.settingsBackupState.ready&&a.settingsBackupState.conflict&&a.state.rules['3227'].cost===206.5,'legacy settings without timestamps preserve both conflicting versions for user choice');
 await assert.rejects(()=>a.writeSettingsBackup());ok(h.posts.length===0,'unresolved conflict cannot overwrite a shared settings file');
 h=harness();a=h.api;await a.initSettingsBackup();h.fail(409);await assert.rejects(()=>a.writeSettingsBackup());
 ok(!a.settingsBackupState.ready&&a.state.rules['3227'].cost===206.5,'concurrent writer conflict stops file writes and preserves current settings');
 h=harness();a=h.api;h.fail(500);await a.initSettingsBackup();
 ok(!a.settingsBackupState.ready&&h.posts.length===0&&a.state.rules['3227'].cost===206.5,'unreadable shared storage never triggers a default-settings overwrite');
 h=harness();a=h.api;await a.initSettingsBackup();await a.writeSettingsBackup();
 disk=fixture();disk.rules['3227'].cost=170;a.setDraft(a.settingsEnvelope(disk));await a.backupAction('backupRestoreConfirm');
 ok(a.state.rules['3227'].cost===170&&a.state.run===false&&h.getDisk().pack.data.rules['3227'].cost===170,'confirmed import saves safely, restores exact plans and leaves monitoring paused');
 h=harness();a=h.api;await a.initSettingsBackup();disk=fixture();disk.rules['3227'].cost=170;a.setDraft(a.settingsEnvelope(disk));h.fail(500);await a.backupAction('backupRestoreConfirm');
 ok(a.state.rules['3227'].cost===206.5,'failed restore write leaves current settings unchanged');
 console.log('Settings checks passed:',checks);
})().catch(e=>{console.error(e);process.exit(1)});
