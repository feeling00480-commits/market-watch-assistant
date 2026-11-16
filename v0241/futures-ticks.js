const tickCacheName='cas-taifex-price-bands-v1';
let tickCachePromise;
function tickCache(){
 if(!tickCachePromise)tickCachePromise=new Promise(resolve=>{
  if(typeof indexedDB==='undefined'){resolve(null);return;}
  const request=indexedDB.open(tickCacheName,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('daily',{keyPath:'date'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=request.onblocked=()=>resolve(null);
 }).catch(()=>null);
 return tickCachePromise;
}
async function readTickCache(date){
 const db=await tickCache();
 if(!db)return null;
 return new Promise(resolve=>{
  const store=db.transaction('daily','readonly').objectStore('daily');
  const request=date?store.get(date):store.getAll();
  request.onsuccess=()=>resolve(request.result||null);
  request.onerror=()=>resolve(null);
 }).catch(()=>null);
}
async function saveTickCache(record){
 const db=await tickCache();
 if(!db)return;
 try{
  const store=db.transaction('daily','readwrite').objectStore('daily');
  store.put(record);
  store.delete(IDBKeyRange.upperBound(twDate(Date.now()-65*86400000),true));
 }catch{}
}
function parseTickIndex(html,now=Date.now()){
 const doc=new DOMParser().parseFromString(html,'text/html'), dates=new Map(),today=twDate(now);
 const link=/https:\/\/www\.taifex\.com\.tw\/file\/taifex\/Dailydownload\/DailydownloadCSV\/Daily_(\d{4})_(\d{2})_(\d{2})\.zip(?=['"])/;
 for(const button of doc.querySelectorAll('input[onclick]')){
  const path=link.exec(button.getAttribute('onclick')||'');
  const row=button.closest('tr');
  if(!path||!row?.cells||row.cells.length<4)continue;
  const date=path.slice(1).join('-');
  const published=row.cells[0].textContent.trim().replace(/\s+/g,' ');
  if(row.cells[1].textContent.trim().replaceAll('/','-')!==date||date>today||!published)continue;
  dates.set(date,{date,published});
 }
 return [...dates.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
}
function officialTickIndex(){
 return memo('taifex-tick-index',8*60000,async()=>{
  try{
   const entries=parseTickIndex(await bridge('tf-ticks-index'));
   if(entries.length)return entries;
  }catch{}
  const cached=await readTickCache();
  if(cached?.length)return cached.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  throw new Error('目前無法讀取期交所下載清單');
 });
}
const tickZipLimit=40*1024*1024,tickCsvLimit=160*1024*1024;
async function readTickZip(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);
 if(bytes.length<22||bytes.length>tickZipLimit)throw new Error('期交所壓縮檔大小無效');
 const u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);
 let eocd=bytes.length-22;
 while(eocd>=Math.max(0,bytes.length-65557)&&!(u32(eocd)===0x06054b50&&eocd+22+u16(eocd+20)===bytes.length))eocd--;
 if(eocd<Math.max(0,bytes.length-65557)||u16(eocd+4)||u16(eocd+6))throw new Error('無法讀取 ZIP 目錄');
 const entries=u16(eocd+10),centralEnd=u32(eocd+16)+u32(eocd+12);
 let at=u32(eocd+16);
 if(entries<1||entries>16||centralEnd>eocd)throw new Error('ZIP 目錄格式不符');
 const decoder=new TextDecoder();
 for(let i=0;i<entries;i++){
  if(at+46>centralEnd||u32(at)!==0x02014b50)throw new Error('ZIP 檔案標頭無效');
  const nameLength=u16(at+28),next=at+46+nameLength+u16(at+30)+u16(at+32);
  if(next>centralEnd)throw new Error('ZIP 檔案名稱無效');
  const name=decoder.decode(bytes.subarray(at+46,at+46+nameLength));
  if(/\.csv$/i.test(name)&&!name.startsWith('__MACOSX/')){
   const compressed=u32(at+20),length=u32(at+24),offset=u32(at+42),method=u16(at+10);
   if(!length||length>tickCsvLimit||!compressed||offset+30>centralEnd||u32(offset)!==0x04034b50||(u16(at+8)&1))
    throw new Error('CSV 壓縮資料無效');
   const start=offset+30+u16(offset+26)+u16(offset+28);
   if(start+compressed>centralEnd||![0,8].includes(method))throw new Error('CSV 壓縮格式無法讀取');
   const packed=bytes.subarray(start,start+compressed);
   if(method===0){
    if(packed.length!==length)throw new Error('CSV 長度不符');
    return packed;
   }
   const output=new Uint8Array(length);
   const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
   let read=0;
   try{
    for(;;){
     const part=await reader.read();
     if(part.done)break;
     if(read+part.value.length>length)throw new Error('CSV 解壓長度超出限制');
     output.set(part.value,read);
     read+=part.value.length;
    }
    if(read!==length)throw new Error('CSV 解壓長度不符');
    return output;
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  at=next;
 }
 throw new Error('ZIP 未包含期貨 CSV');
}
async function parseOfficialTicks(bytes,date){
 const head=new TextDecoder().decode(bytes.subarray(0,512));
 const text=new TextDecoder(head.includes('商品代號')?'utf-8':'big5').decode(bytes);
 const fields=line=>line.split(',').map(value=>value.trim().replace(/^"|"$/g,''));
 const first=text.indexOf('\n');
 const names=fields(text.slice(0,first)).map(name=>name.replace(/\s+/g,'').replaceAll('（','(').replaceAll('）',')'));
 const code=names.indexOf('商品代號'),month=names.indexOf('到期月份(週別)'),clock=names.indexOf('成交時間');
 const price=names.indexOf('成交價格'),volume=names.indexOf('成交數量(B+S)');
 const day=names.findIndex(name=>name==='交易日期'||name==='成交日期');
 if(first<0||[code,month,clock,price,volume,day].includes(-1))throw new Error('期交所 CSV 欄位不符');
 const target=date.replaceAll('-',''),earliest=twDate(Date.parse(date+'T12:00:00+08:00')-10*86400000).replaceAll('-','');
 const products=new Map();
 let start=first+1,rows=0,end;
 while(start<text.length){
  end=text.indexOf('\n',start);
  if(end<0)end=text.length;
  const row=fields(text.slice(start,end));start=end+1;
  if(++rows%50000===0)await new Promise(resolve=>setTimeout(resolve,0));
  const id=row[code],contract=row[month],clockText=(row[clock]||'').replaceAll(':','');
  if(!/^\d{1,6}$/.test(clockText))continue;
  const time=clockText.padStart(6,'0');
  if(!Object.hasOwn(futuresProducts,id)||!/^\d{4}(0[1-9]|1[0-2])$/.test(contract)||!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time))continue;
  const tradeDate=(row[day]||'').replace(/[-/]/g,'');
  const session=time>='084500'&&time<='134500'?'day':time>='150000'||time<='050000'?'night':null;
  const c=number(row[price]),v=number(row[volume])/2;
  if(!session||!/^\d{8}$/.test(tradeDate)||tradeDate<earliest||tradeDate>target||
     (session==='day'&&tradeDate!==target)||!valid(c)||c>1e9||!Number.isSafeInteger(v)||v<=0)continue;
  const key=id+'/'+contract+'/'+session;
  if(!products.has(key))products.set(key,new Map());
  const bands=products.get(key);
  bands.set(c,(bands.get(c)||0)+v);
 }
 if(!products.size)throw new Error('期交所 CSV 無適用成交');
 return Object.fromEntries([...products].map(([key,bands])=>[key,[...bands]]));
}
function fetchOfficialTickDate(entry){
 return memo('taifex-tick-day:'+entry.date+':'+entry.published,15*60000,async()=>{
  const cached=entry.products?entry:await readTickCache(entry.date);
  if(cached?.published===entry.published)return cached;
  try{
   const archive=await bridge('tf-ticks/'+entry.date,{},'binary');
   const products=await parseOfficialTicks(await readTickZip(archive),entry.date);
   const record={date:entry.date,published:entry.published,products};
   await saveTickCache(record);
   return record;
  }catch(e){if(cached)return {...cached,stale:true};throw e;}
 });
}
let officialTickQueue=Promise.resolve();
function loadOfficialProfile(m,d,days){
 const month=d.daily?.bars.at(-1)?.contract;
 if(!month||d.officialProfileLoading)return;
 const requestKey=month+'/'+days;
 if(d.officialProfileKey===requestKey&&Date.now()-d.officialProfileAt<8*60000)return;
 d.officialProfileKey=requestKey;d.officialProfileAt=Date.now();d.officialProfileLoading=true;
 d.officialProfileError='';d.officialProfileProgress='';
 const active=()=>selected()===m&&state.details.get(m.id)===d&&state.period==='profile';
 const stillNeeded=()=>active()&&state.profileDays===days&&d.daily?.bars.at(-1)?.contract===month;
 const redraw=()=>{if(active())drawChart();};
 const run=async()=>{
  if(!stillNeeded())return;
  redraw();
  const index=await officialTickIndex();
  const today=twDate(Date.now());
  const entries=days===1?index.filter(entry=>entry.date===today):index;
  let done=0,usable=0,failed=0;
  for(const entry of entries){
   if(!stillNeeded()||usable>=days)break;
   try{
    const record=await fetchOfficialTickDate(entry);
    if(record.stale)failed++;
    if(record.products[m.id+'/'+month+'/day']?.length||days===1&&record.products[m.id+'/'+month+'/night']?.length)usable++;
    (d.officialProfile??=new Map()).set(entry.date,record);
    d.profileAlertReference=null;
   }catch{failed++;}
   d.officialProfileProgress='已檢查 '+(++done)+' 日 · 已取得 '+usable+'／'+days+' 日';
   redraw();
  }
  if(failed)d.officialProfileError='有 '+failed+' 日的官方檔尚未取得最新版本';
 };
 const task=officialTickQueue.then(run);
 officialTickQueue=task.catch(()=>{});
 task.catch(e=>{d.officialProfileError=message(e);}).finally(()=>{
  d.officialProfileLoading=false;
  if(!stillNeeded())d.officialProfileAt=0;
  redraw();
  if(active()&&(state.profileDays!==days||d.daily?.bars.at(-1)?.contract!==month))loadOfficialProfile(m,d,state.profileDays);
 });
}
function officialProfileInput(m,d,days,forAlert,now){
 const month=d.daily?.bars.at(-1)?.contract;
 if(!month||d.profileImportMonth&&d.profileImportMonth!==month&&!forAlert)return null;
 const today=twDate(now),clock=twTime(now);
 const sessions={day:false,night:false};
 const records=[...(d.officialProfile?.values()||[])].filter(record=>{
  const day=record.products[m.id+'/'+month+'/day'];
  if(forAlert)return day?.length&&(record.date<today||record.date===today&&clock>='14:00:00');
  if(days>1)return day?.length&&record.date<=today;
  return record.date===today&&(day?.length||record.products[m.id+'/'+month+'/night']?.length);
 }).sort((a,b)=>a.date.localeCompare(b.date)).slice(-days);
 if(!records.length)return null;
 const rows=records.flatMap(record=>['day','night'].flatMap(session=>{
  const bands=record.products[m.id+'/'+month+'/'+session]||[];
  if(bands.length)sessions[session]=true;
  return bands.map(([c,v])=>({c,v}));
 }));
 return {dates:records.map(record=>record.date),month,exact:true,official:true,rows,
  session:sessions.day&&sessions.night?'日盤＋夜盤':sessions.day?'日盤':'僅已公布夜盤'};
}
