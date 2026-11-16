const positionProductNames={
 '臺股期貨':'TX','小型臺指期貨':'MTX','微型臺指期貨':'TMF','電子期貨':'TE','金融期貨':'TF',
 '非金電期貨':'XIF','非金融電子期貨':'XIF'
};
const positionRoles=['外資','投信','自營商'];
const officialInteger=s=>/^[+-]?\d+$/.test(String(s??'').trim().replaceAll(',',''))?number(s):NaN;
const positionDoc=html=>new DOMParser().parseFromString(html,'text/html');
const positionCells=row=>[...row.cells].map(cell=>cell.textContent.trim());
const countWithSign=n=>Number.isFinite(n)?(n>0?'+':n<0?'−':'')+fmt(Math.abs(n),0):'—';
const positionTone=n=>n>0?'up':n<0?'down':'';
function parseFuturePositions(doc,date){
 const reportDate=(doc.body?.textContent||'').match(/日期\s*[:：]?\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
 if(!reportDate||twDate(rocDate(reportDate[1]))!==date)return null;
 const table=[...doc.querySelectorAll('table')].reverse().find(t=>{
  const labels=[...t.rows].slice(0,5).flatMap(positionCells).join('').replace(/\s/g,'');
  return labels.includes('未平倉餘額')&&/身[份分]別/.test(labels)&&labels.includes('多空淨額');
 });
 if(!table)return null;
 const products={};
 let product=null;
 for(const tr of table.rows){
  const cells=positionCells(tr);
  if(cells.length===15)product=positionProductNames[cells[1].replace(/\s/g,'').replaceAll('台','臺')];
  else if(cells.length!==13){product=null;continue;}
  if(!product)continue;
  const row=cells.slice(-13);
  const role=/^外資(?:及陸資)?$/.test(row[0])?'外資':row[0];
  if(!positionRoles.includes(role))continue;
  const [long,short,net]=[row[7],row[9],row[11]].map(officialInteger);
  if(long>=0&&short>=0&&long-short===net){
   products[product]??={};
   products[product][role]={long,short,net};
  }
 }
 return Object.keys(products).length?{date,products}:null;
}
function futurePositionDates(now){
 const today=twDate(now),midday=Date.parse(today+'T12:00:00Z'),days=[];
 for(let offset=twTime(now)>='14:30:00'?0:1;offset<19&&days.length<11;offset++){
  const date=new Date(midday-offset*86400000);
  if(date.getUTCDay()!==0&&date.getUTCDay()!==6)days.push(date.toISOString().slice(0,10));
 }
 return days;
}
function officialFuturePositionDay(date){
 return memo('taifex-positions:'+date,date>=twDate(Date.now()-86400000)?15*60000:6*3600000,async()=>{
  return parseFuturePositions(positionDoc(await bridge('tf-positions/'+date)),date);
 });
}
function futureMarketOi(doc,product){
 const rows=[...doc.querySelectorAll('tr')].map(positionCells)
  .filter(r=>r[0]===product&&/^\d{6}(?:[WF]\d{1,2})?$/.test(r[1])&&r.length>=13);
 const months=new Set(rows.map(r=>r[1]));
 const amounts=rows.map(r=>officialInteger(r[12]));
 return rows.length&&months.size===rows.length&&amounts.every(n=>n>=0)?amounts.reduce((sum,n)=>sum+n,0):NaN;
}
async function retailFuturePosition(product,date,roles){
 if(!positionRoles.every(r=>roles?.[r]))return null;
 const oi=futureMarketOi(await futureReport({id:product},date),product);
 const long=oi-positionRoles.reduce((sum,r)=>sum+roles[r].long,0);
 const short=oi-positionRoles.reduce((sum,r)=>sum+roles[r].short,0);
 return oi>0&&long>=0&&short>=0?{long,short,net:long-short,ratio:100*(long-short)/oi}:null;
}
function parsePutCall(doc){
 const table=[...doc.querySelectorAll('table')].reverse().find(t=>t.textContent.includes('買賣權未平倉量比率'));
 if(!table)return [];
 return [...table.rows].flatMap(tr=>{
  const row=positionCells(tr),[date,,,,put,call]=row;
  if(row.length!==7||!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(date))return [];
  const [p,c]=[put,call].map(officialInteger),ratio=number(row[6]);
  return p>=0&&c>0&&Math.abs(100*p/c-ratio)<=.011?[{date:twDate(rocDate(date)),put:p,call:c,ratio}]:[];
 }).sort((a,b)=>b.date.localeCompare(a.date));
}
function parseLargeTaiexTraders(doc){
 const table=[...doc.querySelectorAll('table')].reverse().find(t=>t.textContent.includes('前十大交易人合計')&&t.textContent.includes('全市場未沖銷部位數'));
 const date=(doc.body?.textContent||'').match(/\b(\d{4}\/\d{1,2}\/\d{1,2})\b/)?.[1];
 if(!table||!date)return null;
 let taiex=false;
 for(const tr of table.rows){
  const cells=positionCells(tr);
  if(cells.length===11)taiex=/^[臺台]股期貨\(TX\+MTX\/4\+TMF\/20\)$/.test(cells[0].replace(/\s/g,''));
  const row=cells.slice(-10);
  if(!taiex||row.length!==10||row[0].replace(/\s/g,'')!=='所有契約')continue;
  const figures=[row[1],row[3],row[5],row[7],row[9]].map(v=>officialInteger(v.split(/[（(]/)[0]));
  if(figures.every(n=>n>=0)){
   const [long5,long10,short5,short10,oi]=figures;
   if(long5<=long10&&short5<=short10&&long10<=oi&&short10<=oi)return {date:twDate(rocDate(date)),long5,long10,short5,short10};
  }
 }
 return null;
}
function parseCashPosition(data,date){
 const match=String(data?.title??'').match(/(\d{2,3})年\s*(\d{1,2})月\s*(\d{1,2})日/);
 if(!match||twDate(rocDate(match.slice(1).join('/')))!==date||!Array.isArray(data.data))return null;
 const entry=pattern=>officialInteger(data.data.find(r=>pattern.test(r[0]))?.[3]);
 const foreign=entry(/^外資及陸資/),trust=entry(/^投信/),own=entry(/^自營商\s*[(（]自行買賣[)）]/),hedge=entry(/^自營商\s*[(（]避險[)）]/),total=entry(/^合\s*計$/);
 return [foreign,trust,own,hedge,total].every(Number.isFinite)?{date,foreign,trust,own,hedge,total}:null;
}
function cashPositionFor(date){
 return memo('cash-positions:'+date,15*60000,()=>json('cash-positions/'+date).then(data=>parseCashPosition(data,date)));
}
const futurePositionState={days:[],failedDates:new Set(),loading:false,at:0,extra:null};
async function loadFuturePositions(){
 const now=Date.now(),data=futurePositionState;
 if(data.loading||now-data.at<15*60000)return;
 data.loading=true;data.at=now;
 const update=()=>{if(isFuture(selected()||{})&&['research','positions'].includes(state.tab))render();};
 const dates=futurePositionDates(now);
 const saved=new Map(data.days.map(row=>[row.date,row]));
 const extra=()=>{
  const latest=data.days[0],previous=data.days[1];
  if(!latest)return Promise.resolve();
  if(!['TX','MTX','TMF'].some(id=>latest.products[id]))return Promise.resolve();
  const current=data.extra?.date===latest.date?data.extra:null;
  return Promise.allSettled([
   memo('taifex-put-call',15*60000,()=>bridge('tf-put-call').then(html=>parsePutCall(positionDoc(html)))),
   current?.cash??cashPositionFor(latest.date),
   memo('taifex-large-traders',15*60000,()=>bridge('tf-large-traders').then(html=>parseLargeTaiexTraders(positionDoc(html)))),
   ...['MTX','TMF'].map(async id=>{
    const current=await retailFuturePosition(id,latest.date,latest.products[id]);
    if(!current)return null;
    const prior=positionCompare(data.days)?await retailFuturePosition(id,previous.date,previous.products[id]).catch(()=>null):null;
    return {id,...current,change:prior?current.ratio-prior.ratio:NaN,previousDate:prior?previous.date:null};
   })
  ]).then(([pc,cash,large,...retail])=>{
   data.extra={date:latest.date,pc:pc.value?.length?pc.value:current?.pc??[],cash:cash.value??null,large:large.value??current?.large,
    retail:retail.map((r,i)=>r.value??current?.retail.find(item=>item.id===['MTX','TMF'][i])).filter(Boolean)};
   update();
  });
 };
 try{
  for(let i=0;i<dates.length;i+=3){
   const batch=dates.slice(i,i+3);
   const result=await Promise.allSettled(batch.map(officialFuturePositionDay));
   result.forEach((response,j)=>{
    const date=batch[j];
    if(response.value){saved.set(date,response.value);data.failedDates.delete(date);}
    else if(response.status==='rejected')data.failedDates.add(date);
    else if(!saved.has(date))data.failedDates.delete(date);
   });
   data.days=[...saved.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,11);
   if(i===0)update();
  }
  await extra();
 }finally{data.loading=false;update();}
}
function futurePositionRows(id){
 return futurePositionState.days.filter(day=>day.products[id]?.外資);
}
function positionCompare(rows){
 const [latest,previous]=rows;
 if(!previous)return null;
 const issue=[...futurePositionState.failedDates].some(date=>date<latest.date&&date>=previous.date);
 return issue?null:previous;
}
function foreignPositionReading(row,prior){
 const position=row.net>0?'淨多 '+fmt(row.net,0)+' 口':row.net<0?'淨空 '+fmt(-row.net,0)+' 口':'多空持平';
 const parts=[[position,toneFor(row.net)]];
 if(!prior)return parts;
 const delta=row.net-prior.net;
 if(!delta)return [...parts,'，淨部位與前次持平'];
 if(row.net>0&&prior.net<0)return [...parts,'，',['由淨空翻為淨多','up']];
 if(row.net<0&&prior.net>0)return [...parts,'，',['由淨多翻為淨空','down']];
 if(row.net===0)return [...parts,'，前次為淨'+(prior.net>0?'多':'空')];
 const grew=Math.abs(row.net)>Math.abs(prior.net);
 return [...parts,'，較前次',[(grew?'增加 ':'減少 ')+fmt(Math.abs(delta),0)+' 口',toneFor(delta)]];
}
function futurePositionChart(rows,id){
 const series=rows.slice(0,10).reverse();
 if(series.length<2)return '';
 const max=Math.max(...series.map(day=>Math.abs(day.products[id].外資.net)),1);
 const step=560/series.length;
 const bars=series.map((day,i)=>{
  const net=day.products[id].外資.net,height=Math.abs(net)*60/max;
  const x=34+step*i;
  return '<rect x="'+x+'" y="'+(net>0?73-height:73)+'" width="'+(step*.7)+'" height="'+Math.max(1,height)+'" rx="2" fill="var('+(net>0?'--red':net<0?'--green':'--quiet')+')"><title>'+day.date+' '+countWithSign(net)+' 口</title></rect>'+
   '<text x="'+(x+step*.35)+'" y="157" text-anchor="middle">'+day.date.slice(5).replace('-','/')+'</text>';
 }).join('');
 return '<svg class="graph positions-graph" viewBox="0 0 620 165" role="img" aria-label="外資近 '+series.length+' 次公布淨部位，零線上為淨多，零線下為淨空">'+
  '<path d="M24 73H608" stroke="var(--quiet)" stroke-dasharray="4 4"/><text x="7" y="77">0</text>'+bars+'</svg>';
}
function positionTable(headers,rows){
 return '<div class="position-table-wrap"><table class="position-table"><thead><tr>'+headers.map(s=>'<th scope="col">'+esc(s)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(([name,...cells])=>'<tr><th scope="row">'+esc(name)+'</th>'+cells.map(cell=>{
   const [value,tone]=Array.isArray(cell)?cell:[cell,''];
   return '<td class="'+tone+'">'+esc(value)+'</td>';
  }).join('')+'</tr>').join('')+'</tbody></table></div>';
}
function futureInstitutionalView(m){
 const id=m.id,rows=futurePositionRows(id),latest=rows[0],previous=positionCompare(rows);
 if(!latest)return '<div class="insight-row"><b>三大法人未平倉</b><p class="sub">'+(futurePositionState.loading?'正在向期交所查詢盤後部位。':'目前沒有可核對的期交所盤後部位。')+'</p></div>';
 const roles=latest.products[id],prior=previous?.products[id];
 const total=values=>Object.fromEntries(['long','short','net'].map(key=>[key,positionRoles.reduce((sum,role)=>sum+values[role][key],0)]));
 const tableRows=[...positionRoles,'三大法人合計'].map(role=>{
  const curr=role==='三大法人合計'?(positionRoles.every(r=>roles[r])?total(roles):null):roles[role];
  const prev=role==='三大法人合計'?(positionRoles.every(r=>prior?.[r])?total(prior):null):prior?.[role];
  const diff=curr&&prev?curr.net-prev.net:NaN;
  return [role,curr?fmt(curr.long,0):'—',curr?fmt(curr.short,0):'—',[countWithSign(curr?.net),positionTone(curr?.net)],[countWithSign(diff),positionTone(diff)]];
 });
 return '<section class="insight-row"><b>外資及陸資｜'+esc(m.name)+'各契約合計</b>'+
  '<p class="future-position-note">'+futureNote(['外資',...foreignPositionReading(roles.外資,prior?.外資),'。'])+'</p>'+
  '<p class="sub">期交所 · '+latest.date+' 盤後'+(previous?' · 比較基準 '+previous.date:'')+' · 口數</p>'+
  positionTable(['身分','多單','空單','淨部位','淨部位變動'],tableRows)+futurePositionChart(rows,id)+
  '<p class="sub">淨部位＝多單減空單；淨部位變動為兩次公布的差額，可能來自多單或空單增減。</p></section>';
}
function futureExtendedPositions(m){
 if(!hasTaiexBasis(m))return '';
 const data=futurePositionState,extra=data.extra;
 const dates=data.days.slice(0,2);
 const comparisons=['TX','MTX','TMF'].flatMap(id=>{
  const curr=dates[0]?.products[id]?.外資,prior=positionCompare(dates)?.products[id]?.外資;
  return curr?[[futuresProducts[id].name,fmt(curr.long,0),fmt(curr.short,0),[countWithSign(curr.net),positionTone(curr.net)],[countWithSign(prior?curr.net-prior.net:NaN),positionTone(prior?curr.net-prior.net:NaN)]]]:[];
 });
 let html=comparisons.length?'<section class="insight-row"><b>外資台指期對照</b><p class="sub">期交所 · '+dates[0].date+' · 各商品所有契約分開統計，單位為各自契約口數。</p>'+
  positionTable(['商品','多單','空單','淨部位','淨部位變動'],comparisons)+'</section>':'';
 if(!extra||extra.date!==dates[0]?.date)return html;
 const retailRows=['MTX','TMF'].map(id=>{
  const r=extra.retail.find(row=>row.id===id);
  return [futuresProducts[id].name,r?fmt(r.long,0):'—',r?fmt(r.short,0):'—',[countWithSign(r?.net),positionTone(r?.net)],
   [r?signed(r.ratio):'—',positionTone(r?.ratio)],Number.isFinite(r?.change)?(r.change>0?'+':'')+fmt(r.change)+' 個百分點':'—'];
 });
 const retailPrevious=extra.retail.find(row=>row.previousDate)?.previousDate;
 const retailNote=extra.retail.map(r=>(r.id==='MTX'?'小台':'微台')+(r.net>0?'偏多':r.net<0?'偏空':'持平')).join('，');
 html+='<section class="insight-row"><b>小台／微台散戶多空比（估算）</b>'+
  review(retailNote?retailNote+'。':'等待同日的法人及全市場留倉資料。')+
  positionTable(['商品','估算多單','估算空單','淨留倉','多空比','前次變動'],retailRows)+
  '<p class="sub">'+extra.date+(retailPrevious?' · 比較基準 '+retailPrevious:'')+' · 以全市場未平倉扣除三大法人估算，亦含其他非法人部位。多空比＝估算淨留倉 ÷ 全市場未平倉。</p></section>';
 const large=extra.large;
 if(large&&large.date<=extra.date){
  const rows=[['前五大',large.long5,large.short5],['前十大',large.long10,large.short10]].map(([label,long,short])=>
   [label,fmt(long,0),fmt(short,0),[countWithSign(long-short),positionTone(long-short)]]);
  html+='<section class="insight-row"><b>台指期大額交易人留倉</b>'+
   review('前十大買方部位合計'+(large.long10>large.short10?'高於':large.long10<large.short10?'低於':'等於')+'前十大賣方。')+
   positionTable(['排名','買方','賣方','買賣方差額'],rows)+
   '<p class="sub">期交所 · '+large.date+' · 大台、小台、微台換算成大台口數。買賣方各自排名，涵蓋不同類別交易人。</p></section>';
 }
 const [pc,prev]=extra.pc.filter(r=>r.date<=extra.date);
 if(pc){
  const change=prev?pc.ratio-prev.ratio:NaN;
  html+='<section class="insight-row"><b>臺指選擇權 Put/Call 未平倉比</b>'+
   review('賣權未平倉量'+(pc.ratio<100?'低於':pc.ratio>100?'高於':'等於')+'買權，比例 '+fmt(pc.ratio)+'%。')+
   '<p class="num">賣權 '+fmt(pc.put,0)+' 口 · 買權 '+fmt(pc.call,0)+' 口'+(prev?' · 較 '+prev.date+' '+(change>0?'+':'')+fmt(change)+' 個百分點':'')+'</p>'+
   '<p class="sub">期交所 · '+pc.date+' · 全市場 · 比率也會受避險與結算影響。</p></section>';
 }
 const cash=extra.cash;
 if(cash){
  const cashAmount=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n)/1e8)+' 億';
  html+='<section class="insight-row"><b>上市現貨三大法人買賣超</b>'+
   review('外資及陸資現貨'+(cash.foreign>0?'買超 '+cashAmount(cash.foreign).slice(1):cash.foreign<0?'賣超 '+cashAmount(-cash.foreign).slice(1):'買賣相抵')+'。',toneFor(cash.foreign))+
   positionTable(['身分','淨買賣金額'],[['外資及陸資',cash.foreign],['投信',cash.trust],['自營商（自行＋避險）',cash.own+cash.hedge],['合計',cash.total]].map(([label,n])=>[label,[cashAmount(n),positionTone(n)]]))+
   '<p class="sub">證交所 · '+cash.date+' · 上市市場。</p></section>';
 }
 return html;
}
