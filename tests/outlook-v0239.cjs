const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let count=0;function ok(v,s){assert(v,s);count++;console.log('PASS',s)}
const prelude=`
const number=v=>v===null||v===undefined?NaN:Number(v),valid=v=>Number.isFinite(v)&&v>0,mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;
const dateFmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const twDate=t=>dateFmt.format(t),twTime=t=>timeFmt.format(t),isUS=m=>m.exchange==='us',marketDate=(m,t)=>twDate(t),isFuture=m=>m.id==='TX';
const esc=s=>String(s).replaceAll('<','&lt;'),modeET=dateFmt;
const alertSession=(m,q,now)=>q&&!q.delayed&&!q.closing&&!q.error&&q.ts<=now+60000&&now-q.ts<=120000&&twTime(now)>='09:00:00'&&twTime(now)<'13:33:00'?'regular':'';
`;
const context=vm.createContext({console,Date,Intl,Map,Set});
vm.runInContext(prelude+fs.readFileSync('v0239/outlook.js','utf8')+'\nthis.api={outlookSpec,outlookFeatures,outlookPrepared,outlookAnalogs,outlookPercents,outlookClass,outlookWilson,outlookValidation,outlookContext,outlookHistory,outlookView};',context);
const a=context.api;
const m={id:'2884',exchange:'tse'},now=Date.parse('2026-11-16T03:00:00Z');
function fixture(n=6000){let p=50,seed=12345;return Array.from({length:n},(_,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;p*=Math.exp(((seed/2**32)-.48)*.06);const t=Date.parse('2000-01-03T01:00:00Z')+i*86400000;return {t,date:new Date(t).toISOString().slice(0,10),c:p,a:p};});}
let bars=fixture(),data=a.outlookPrepared(bars),query=data.features.at(-1);
for(const spec of a.outlookSpec){
 const result=a.outlookAnalogs(data,query,bars.length-1,spec);
 ok(result.n>=12&&result.n<=30,spec.days+' days has actual bounded sample counts');
 ok(result.selected.every(x=>x.i+spec.days<bars.length-1),'all '+spec.days+' day outcomes mature before query');
 ok(result.selected.every((x,i)=>result.selected.slice(i+1).every(y=>Math.abs(x.i-y.i)>spec.days)),spec.days+' day outcomes never overlap');
 const percent=a.outlookPercents(result.counts);ok(percent.reduce((x,y)=>x+y,0)===100,'rounded proportions sum to exactly 100');
 const validation=a.outlookValidation(data,spec);ok(validation.n>0&&validation.brier>=0&&validation.brier<=2,'walk-forward Brier is finite for '+spec.days+' days');
}
ok(a.outlookClass(.01,.01)===1&&a.outlookClass(-.01,.01)===1&&a.outlookClass(.01001,.01)===0&&a.outlookClass(-.01001,.01)===2,'boundary equal to threshold is flat; up/down are correctly oriented');
ok(a.outlookPercents([1,1,1]).reduce((x,y)=>x+y,0)===100,'three equal classes round without losing a percentage point');
ok(a.outlookPercents([0,0,0])===null,'empty data never produces made-up percentages');
const interval=a.outlookWilson(12,20);ok(interval[0]<60&&interval[1]>60&&interval[0]>=0&&interval[1]<=100,'Wilson interval brackets empirical proportion');
const short=a.outlookPrepared(fixture(80));ok(a.outlookAnalogs(short,short.features.at(-1),79,a.outlookSpec[2]).n===0,'short history cannot produce long-horizon percentages');
const at=3000,original=JSON.stringify(a.outlookFeatures(data.prices,at)),copy=data.prices.slice();copy.fill(1e9,at+1);
ok(JSON.stringify(a.outlookFeatures(copy,at))===original,'historical features cannot see any future prices');
const hist=bars.slice(-2500).map((b,i)=>({...b,t:now-(2500-i)*86400000,date:new Date(now-(2500-i)*86400000).toISOString().slice(0,10)}));
const d={outlookHistory:{bars:hist,loadedAt:1},outlookPrepared:a.outlookPrepared(hist),outlookValidation:[{n:0},{n:0},{n:0}]};
const last=hist.at(-1),q={price:last.c,prev:last.c,ts:now};
let c=a.outlookContext(m,q,d,now);ok(c.live&&c.origin===hist.length,'valid new-day quote participates as provisional close');
const first=c.query.slice(),before=JSON.stringify(d.outlookPrepared.prices);q.price*=1.05;c=a.outlookContext(m,q,d,now);
ok(JSON.stringify(c.query)!==JSON.stringify(first),'new intraday price changes the features immediately');
ok(JSON.stringify(d.outlookPrepared.prices)===before,'intraday query never mutates settled history or its outcomes');
ok(!a.outlookContext(m,{...q,delayed:true},d,now).live,'delayed quote falls back to settled daily analysis');
ok(!a.outlookContext(m,{...q,ts:now-121000},d,now).live,'stale quote is never described as live');
ok(!a.outlookContext(m,{...q,ts:now+61000},d,now).live,'future-timestamp quote is never described as live');
ok(a.outlookContext(m,{...q,prev:last.c/2},d,now).reason.includes('不一致'),'split/dividend or cross-source mismatch pauses live estimate');
assert.throws(()=>a.outlookHistory({meta:{dataGranularity:'1mo'}},m,now));ok(true,'monthly resampling cannot masquerade as daily bars');
const raw={meta:{dataGranularity:'1d'},timestamp:[(now-86400000)/1000,now/1000],indicators:{quote:[{close:[100,101]}],adjclose:[{adjclose:[50,50.5]}]}};
let normalized=a.outlookHistory(raw,m,now);ok(normalized.length===1&&normalized[0].a===50,'intraday unfinished source bar is excluded and adjusted prices retained');
const broken=JSON.parse(JSON.stringify(raw));broken.indicators.adjclose[0].adjclose[0]=null;const gaps=a.outlookHistory(broken,m,now);ok(gaps[0].gap&&!Number.isFinite(gaps[0].a),'unknown weekday gap is retained, never replaced by unadjusted close');
const gdata=a.outlookPrepared(fixture());gdata.prices[3000]=NaN;gdata.bars[3000].a=NaN;const clean=a.outlookPrepared(gdata.bars);const matching=a.outlookAnalogs(clean,clean.features.at(-1),clean.bars.length-1,a.outlookSpec[2]);ok(matching.selected.every(s=>s.i>3000||s.i+120<3000),'no analogue outcome may cross missing adjusted history');
if(fs.existsSync('/tmp/cas-yahoo39-period.json')){
 const real=JSON.parse(fs.readFileSync('/tmp/cas-yahoo39-period.json')).chart.result[0];
 const normalized=a.outlookHistory(real,m,now),p=a.outlookPrepared(normalized);
 console.time('actual-history');
 const report=a.outlookSpec.map(s=>{const r=a.outlookAnalogs(p,p.features.at(-1),p.bars.length-1,s);return {days:s.days,n:r.n,percent:a.outlookPercents(r.counts),validation:a.outlookValidation(p,s)};});
 console.timeEnd('actual-history');console.log('LIVE SOURCE CHECK',JSON.stringify({symbol:real.meta.symbol,bars:normalized.length,last:normalized.at(-1).date,report}));
 ok(normalized.length>5000,'actual Yahoo daily response supplies long adjusted history');
}
console.log('Outlook checks passed:',count);
