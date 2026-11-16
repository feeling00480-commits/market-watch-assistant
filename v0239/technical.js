const maPeriods=[5,10,20,60];
const maColors=['#ffcc68','#ff866d','#72aef9','#45d5d0'];
function indicators(bars){
 const meanClose=(i,n)=>i+1>=n?mean(bars.slice(i+1-n,i+1).map(b=>b.c)):NaN;
 let fast=bars[0]?.c,slow=fast,signal=0,k=50,d=50,gain=0,loss=0;
 const ema=(old,x,n)=>old+(x-old)*2/(n+1);
 return bars.map((b,i)=>{
  if(i){
   const delta=b.c-bars[i-1].c,g=Math.max(0,delta),l=Math.max(0,-delta);
   if(i<=14){gain+=g/14;loss+=l/14;}
   else{gain=(gain*13+g)/14;loss=(loss*13+l)/14;}
  }
  const rsi=i<14?NaN:loss?100-100/(1+gain/loss):gain?100:50;
  let kdK=NaN,kdD=NaN;
  if(i>=8){
   const window=bars.slice(i-8,i+1);
   const lo=Math.min(...window.map(x=>x.l)),hi=Math.max(...window.map(x=>x.h));
   const rsv=hi>lo?(b.c-lo)/(hi-lo)*100:50;
   k=(2*k+rsv)/3;d=(2*d+k)/3;kdK=k;kdD=d;
  }
  fast=ema(fast,b.c,12);slow=ema(slow,b.c,26);
  const dif=fast-slow;
  if(i>=25)signal=i===25?dif:ema(signal,dif,9);
  const ready=i>=33;
  return {ma:maPeriods.map(n=>meanClose(i,n)),k:kdK,d:kdD,rsi,
   macd:ready?dif:NaN,signal:ready?signal:NaN,hist:ready?dif-signal:NaN};
 });
}
function aggregateBars(bars,period){
 if(period==='day'||period==='1m')return bars;
 const minutes=Number(/^(5|30|60)m$/.exec(period)?.[1]);
 const group=b=>{
  if(minutes)return Math.floor(b.t/(minutes*60000))*minutes*60000;
  const date=twDate(b.t);
  if(period==='month')return date.slice(0,7);
  const ts=Date.parse(date+'T00:00:00Z'),weekday=new Date(ts).getUTCDay();
  return ts-((weekday+6)%7)*86400000;
 };
 const out=[];
 let prevKey;
 for(const b of bars){
  const key=group(b),last=out.at(-1);
  if(last&&key===prevKey){
   last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);
   last.c=b.c;last.end=b.t;last.v=Number.isFinite(last.v)&&Number.isFinite(b.v)?last.v+b.v:NaN;
  }else{
   out.push({...b,t:minutes?key:b.t,end:b.t});
   prevKey=key;
  }
 }
 return out;
}
function rangeStart(end,months){
 const d=new Date(end);
 const target=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-months,1));
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 target.setUTCDate(Math.min(d.getUTCDate(),last));
 return +target;
}
function technicalMood(trend,momentum){
 if(trend===null||momentum===null)return '技術資料不足';
 const direction=n=>n>=4?1:n<=2?-1:0;
 const t=direction(trend),m=direction(momentum);
 if(t===m)return t>0?'技術面偏多':t<0?'技術面偏空':'技術面中性';
 if(t&&m)return '趨勢與動能分歧';
 if(t)return t>0?'趨勢偏多・動能中性':'趨勢偏空・動能中性';
 return m>0?'趨勢中性・動能偏強':'趨勢中性・動能偏弱';
}
function researchVolume(q,bars,intradayRatio,now){
 const today=twDate(now),beforeClose=twTime(now)<dailyCloseTime;
 if(beforeClose&&valid(intradayRatio)&&valid(q?.prev)&&valid(q?.price)&&
    Number.isFinite(q.ts)&&twDate(q.ts)===today&&twTime(q.ts)<dailyCloseTime){
  return {mode:'intraday',at:q.ts,ratio:intradayRatio,delta:(q.price/q.prev-1)*100};
 }
 const completed=bars.filter(b=>Number.isFinite(b.t)&&b.t<=now&&(!beforeClose||twDate(b.t)!==today));
 const last=completed.at(-1),previous=completed.at(-2);
 const baseline=completed.slice(-21,-1).map(b=>b.v);
 const hasVolume=v=>Number.isFinite(v)&&v>=0;
 const average=mean(baseline);
 if(!hasVolume(last?.v)||!valid(last?.c)||!valid(previous?.c)||baseline.length!==20||!baseline.every(hasVolume)||!valid(average))return null;
 return {mode:'daily',at:last.t,ratio:last.v/average,delta:(last.c/previous.c-1)*100};
}
function assessment(q,bars,fund,ratio,now=Date.now()){
 const last=bars.at(-1), i=indicators(bars).at(-1);
 const [,,ma20,ma60]=i?.ma||[];
 const rows=[];
 const add=(name,score,detail)=>rows.push({name,score:Number.isFinite(score)?Math.max(1,Math.min(5,score)):null,detail});
 const movement=(a,b)=>a>b?1:a<b?-1:0;
 add('趨勢',last&&valid(ma20)&&valid(ma60)?3+movement(last.c,ma20)+movement(ma20,ma60):null,
  '日 K 收盤對 MA20、MA20 對 MA60，各加減 1 分。');
 add('動能',Number.isFinite(i?.rsi)&&Number.isFinite(i?.hist)?3+(i.rsi>=55?1:i.rsi<=45?-1:0)+movement(i.hist,0):null,
  'RSI ≥55／≤45 與 MACD 柱體正負，各加減 1 分。');
 const volume=researchVolume(q,bars,ratio,now);
 add('量價',volume?3+(volume.ratio>=2?2:volume.ratio>=1?1:0)*movement(volume.delta,0):null,
  volume?.mode==='intraday'?'盤中估算量比達 1／2 倍，依漲跌加減 1／2 分。':
  '日 K 成交量除以前 20 個交易日均量，量比達 1／2 倍時依收盤漲跌加減 1／2 分。');
 const yoy=fund?.yoy;
 add('營收',Number.isFinite(yoy)?3+(yoy>=15?2:yoy>0?1:yoy<=-15?-2:yoy<0?-1:0):null,
  '以最近揭露月營收年增率衡量，±15% 對應兩分。');
 const pe=fund?.pe;
 add('估值',valid(pe)?pe<=10?5:pe<=18?4:pe<=28?3:pe<=45?2:1:null,
  '依本益比 10／18／28／45 倍分級，未做同業或歷史比較。');
 const [trend,momentum]=rows;
 const mood=technicalMood(trend.score,momentum.score);
 const moodTone=mood==='技術面偏多'?'up':mood==='技術面偏空'?'down':'neutral';
 return {rows,mood,moodTone,volume,dailyAt:last?.t,days:bars.length,close:last?.c,ma20,ma60,rsi:i?.rsi,macdHist:i?.hist};
}
const radarMeaning={
 趨勢:'比較收盤價、月線和季線，分數越高代表股價方向越偏多。',
 動能:'用 RSI 和 MACD 柱看漲跌力道，分數越高代表上漲動能越強。',
 量價:'看成交量有沒有比平常大，再看價格往哪邊走，分數越高代表放量上漲訊號越強。',
 營收:'看最新公布的單月營收比去年同期增減多少，分數越高代表年增幅越大。',
 估值:'看股價是每股盈餘的幾倍，分數越高代表本益比落在越低的級距。'
};
function radar(rows,active){
 const cx=170,cy=145,r=98;
 const point=(i,dist)=>{
  const a=(i/rows.length-.25)*2*Math.PI;
  return [(cx+dist*Math.cos(a)).toFixed(2),(cy+dist*Math.sin(a)).toFixed(2)];
 };
 const ring=dist=>rows.map((_,i)=>point(i,dist).join(',')).join(' ');
 const dots=rows.map((row,i)=>row.score===null?null:point(i,r*row.score/5));
 const axes=rows.map((_,i)=>'<path d="M'+cx+' '+cy+'L'+point(i,r).join(' ')+'" stroke="#545057"/>').join('');
 const legend=rows.map((row,i)=>{
  const [x,y]=point(i,124),label=row.name+' '+(row.score===null?'資料不足':row.score+'／5');
  return '<g class="radar-axis" role="button" tabindex="0" data-act="radarMetric" data-id="'+i+'" aria-pressed="'+(i===active)+'" aria-label="'+esc(label)+'">'+
   '<rect x="'+(+x-26)+'" y="'+(+y-9)+'" width="52" height="35" rx="5"/>'+
   '<text x="'+x+'" y="'+y+'" text-anchor="middle" dominant-baseline="central" fill="#e5e3ea" font-size="13">'+esc(row.name)+'</text>'+
   '<text x="'+x+'" y="'+(+y+17)+'" text-anchor="middle" dominant-baseline="central" fill="'+(row.score===null?'#aeb1bc':'#ffd17b')+'" font-weight="700" font-size="14">'+(row.score??'—')+'</text></g>';
 }).join('');
 const shape=dots.every(Boolean)?
  '<polygon class="radar-score" points="'+dots.map(p=>p.join(',')).join(' ')+'" fill="#edb85c" fill-opacity=".42" stroke="#ffc66b" stroke-width="2.4" stroke-linejoin="round"/>':
  dots.map((p,i)=>{
   const next=dots[(i+1)%dots.length];
   return p&&next?'<polygon class="radar-score" points="'+cx+','+cy+' '+p.join(',')+' '+next.join(',')+'" fill="#edb85c" fill-opacity=".33"/><path d="M'+p.join(' ')+'L'+next.join(' ')+'" stroke="#ffc66b" stroke-width="2.4"/>':'';
  }).join('');
 const markers=dots.map((p,i)=>{
  if(p)return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4.5" fill="#ffd37d" stroke="#322413"/>';
  const [x,y]=point(i,r);return '<circle cx="'+x+'" cy="'+y+'" r="4" fill="#18191c" stroke="#878995" stroke-dasharray="2 2"/>';
 }).join('');
 return '<svg viewBox="0 0 340 281" class="radar" role="group" aria-label="研究雷達五項評分">'+
  '<polygon class="radar-frame" points="'+ring(r)+'" fill="#28252a" stroke="#82705d" stroke-width="1.5"/>'+
  [1,2,3,4].map(n=>'<polygon points="'+ring(r*n/5)+'" fill="none" stroke="#4b444b"/>').join('')+axes+shape+markers+legend+'</svg>';
}
