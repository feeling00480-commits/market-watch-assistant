const appVersion='0.2.41';
const settingsFormat='market-watch-settings';
const backupMinutes=[1,5,15,30,60];
const settingsNumbers=['move','stop','warn','volume','cost','lots','entry','target','riskBudget','relative','cooldown','burst','sidePct','spread','targetNear'];
const settingsFlags=['enabled','tech','band','profileAlert'];
function cleanSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.watch)||value.watch.length>20||!value.rules||typeof value.rules!=='object'||Array.isArray(value.rules))throw Error('設定檔缺少有效的追蹤清單與警報規則。');
 const ids=new Set();
 const watch=value.watch.map(row=>{
  if(!row||typeof row!=='object'||typeof row.id!=='string'||ids.has(row.id))throw Error('追蹤清單有重複或無效代號。');
  const id=row.id,future=Object.hasOwn(futuresProducts,id),us=/^US:[A-Z][A-Z0-9]{0,5}(?:-[A-Z])?$/.test(id);
  if(!future&&id!=='TAIEX'&&!us&&!/^\d{4,6}[A-Z]?$/.test(id))throw Error('設定檔包含無效商品代號。');
  if(!future&&!['tse','otc','esb','us'].includes(row.exchange)||us&&row.exchange!=='us'||!us&&row.exchange==='us')throw Error('商品市場分類無效。');
  if(typeof row.name!=='string'||!row.name.trim()||row.name.length>100||typeof row.market!=='string'||row.market.length>120)throw Error('商品名稱或市場資料無效。');
  if(future&&!['近月','次月'].includes(row.contract))throw Error('期貨契約無效。');
  ids.add(id);
  return {id,name:row.name.trim(),market:row.market,type:id==='TAIEX'?'大盤':future?'期貨':row.type==='ETF'?'ETF':'個股',...(future?{contract:row.contract}:{}),...(!future?{exchange:row.exchange}:{})};
 });
 const rules=Object.fromEntries(watch.map(m=>{
  const input=value.rules[m.id]||{},out={};
  if(typeof input!=='object'||Array.isArray(input))throw Error('商品警報設定無效。');
  for(const key of settingsNumbers){
   if(input[key]===undefined)continue;
   const n=input[key];
   if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e12||key==='targetNear'&&n>100||key==='sidePct'&&n!==0&&(n<51||n>100))throw Error('警報數值無效，請檢查 '+m.name+'。');
   out[key]=n;
  }
  for(const key of settingsFlags)if(typeof input[key]==='boolean')out[key]=input[key];
  return [m.id,out];
 }));
 const order=key=>Array.isArray(value[key])?[...new Set(value[key].filter(id=>ids.has(id)))]:[];
 const result={watch,rules,watchSort:['default','custom','up','down'].includes(value.watchSort)?value.watchSort:'default',watchOrder:order('watchOrder'),watchPins:order('watchPins'),
  seconds:[0,15,30,60,300,600,900].includes(value.seconds)?value.seconds:[15,30,60,300,600,900].includes(value.minutes*60)?value.minutes*60:30,
  notify:value.notify!==false,snapshot:['精簡','詳細','自訂'].includes(value.snapshot)?value.snapshot:'詳細',
  snapshotFields:Object.fromEntries(['time','range','volume'].map(k=>[k,value.snapshotFields?.[k]!==false])),appearance:normalizeAppearance(value.appearance),
  chartPeriod:['line','profile','1m','5m','30m','60m','day','week','month'].includes(value.chartPeriod)?value.chartPeriod:'line',chartMonths:[1,3,6,12].includes(value.chartMonths)?value.chartMonths:3,
  profileDays:[1,5,20,30].includes(value.profileDays)?value.profileDays:20,
  backup:{enabled:value.backup?.enabled!==false,minutes:backupMinutes.includes(value.backup?.minutes)?value.backup.minutes:5},
  update:{enabled:value.update?.enabled!==false,autoDownload:value.update?.autoDownload!==false}};
 if(Number.isSafeInteger(value.updatedAt)&&value.updatedAt>0&&value.updatedAt<=Date.now()+300000)result.updatedAt=value.updatedAt;
 return result;
}
function settingsEnvelope(value,at=Date.now()){
 const data=cleanSettings(value);data.updatedAt=data.updatedAt||at;
 return {format:settingsFormat,schemaVersion:1,appVersion,savedAt:new Date(at).toISOString(),data};
}
function readSettingsEnvelope(value){
 if(value?.format!==settingsFormat||value.schemaVersion!==1||!Number.isFinite(Date.parse(value.savedAt)))throw Error('不是支援的看盤小助手設定備份，或檔案版本較新。');
 const data=cleanSettings(value.data);
 if(!data.updatedAt)throw Error('備份缺少有效的設定時間。');
 return {...settingsEnvelope(data),savedAt:value.savedAt};
}
function settingsComparable(value){const data=cleanSettings(value);delete data.updatedAt;return JSON.stringify(data);}
