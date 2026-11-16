function reportTone(title){
 if(/風險|承壓|偏空|賣出|減碼|停損|失效/.test(title))return 'risk';
 if(/有利|偏多|利多|正向|買進|進場/.test(title))return 'positive';
 return 'neutral';
}
function reportInline(line){
 const pattern=/(\*\*\*|\*\*|__|\*)([^\n]+?)\1/g;
 let html='',start=0;
 for(const match of line.matchAll(pattern)){
  html+=esc(line.slice(start,match.index))+'<strong>'+esc(match[2])+'</strong>';
  start=match.index+match[0].length;
 }
 return html+esc(line.slice(start));
}
function aiReport(text){
 const blocks=[];
 let list=[],paragraph=[];
 const flush=()=>{
  if(paragraph.length){blocks.push('<p>'+paragraph.join('<br>')+'</p>');paragraph=[];}
  if(list.length){blocks.push('<ul>'+list.map(item=>'<li>'+item+'</li>').join('')+'</ul>');list=[];}
 };
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.trim();
  if(!line||/^```/.test(line)){flush();continue;}
  const heading=/^#{1,6}\s*(.+)$/.exec(line);
  const boldHeading=/^(?:\*\*|__)([^：:]{1,40})(?:\*\*|__)$/.exec(line);
  if(heading||boldHeading){
   flush();
   const title=(heading||boldHeading)[1].replace(/\*{1,3}|__/g,'').trim();
   blocks.push('<h4 class="report-'+reportTone(title)+'">'+esc(title)+'</h4>');continue;
  }
  const item=/^(?:[-*+•]\s+|\d{1,2}[.)、]\s*)(.+)$/.exec(line);
  if(item){
   if(paragraph.length)flush();
   list.push(reportInline(item[1]));continue;
  }
  if(list.length)flush();
  paragraph.push(reportInline(line));
 }
 flush();
 return '<div class="ai-report">'+blocks.join('')+'</div>';
}

function isEquity(m){return m.id!=='TAIEX'&&!isFuture(m);}
function positionPlan(m,q,rule){
 if(!isEquity(m)||!rule)return null;
 const positive=value=>valid(value)?value:null;
 const cost=positive(rule.cost),lots=positive(rule.lots),entry=positive(rule.entry),stop=positive(rule.stop),
  target=positive(rule.target),riskBudget=positive(rule.riskBudget),price=positive(q?.price);
 const shares=lots?Math.round(lots*(isUS(m)?1:1000)):null;
 if(!cost&&!shares&&!entry&&!stop&&!target&&!riskBudget)return null;
 const stopReached=price&&stop?price<=stop:null;
 const riskCents=(from)=>from&&stop?Math.max(0,Math.round(from*100)-Math.round(stop*100)):0;
 const entryRisk=riskCents(entry),currentRisk=riskCents(price);
 const sharesAtRisk=risk=>risk>0&&riskBudget?Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Math.round(riskBudget*100)/risk)):null;
 const maxShares=sharesAtRisk(entryRisk),holdLimit=sharesAtRisk(currentRisk);
 return {cost,shares,entry,stop,target,riskBudget,stopReached,
  currentPnl:price&&cost&&shares?(price-cost)*shares:null,
  stopPnl:stop&&cost&&shares?(stop-cost)*shares:null,
  targetPnl:target&&cost&&shares?(target-cost)*shares:null,
  maxShares,reduceScenario:shares&&holdLimit!==null?Math.max(0,shares-holdLimit):null,
  rewardRisk:entryRisk&&target&&target>entry?(target-entry)*100/entryRisk:null};
}
function pnlHtml(value,m){
 const tone=value>0?'positive':value<0?'risk':'neutral';
 return '<strong class="research-'+tone+'">'+(value>0?'+':'')+fmt(value,isUS(m)?2:0)+(isUS(m)?' 美元':' 元')+'</strong>';
}
function positionView(m,q,rule){
 if(!isEquity(m))return '';
 const p=positionPlan(m,q,rule);
 const configure='<button type="button" data-act="rule">設定持倉／試算</button>';
 if(!p)return '<section class="insight-row position-plan"><div class="row between wrap"><b>持倉與風險試算</b>'+configure+'</div><p class="sub">可填寫成本、'+(isUS(m)?'股數':'張數')+'，以及計畫進場價、停損價和可承受虧損。</p></section>';
 const rows=[];
 if(p.cost||p.shares)rows.push('<p>平均成本 <b>'+fmt(p.cost)+'</b> · 股數 <b>'+fmt(p.shares,0)+'</b></p>');
 if(p.currentPnl!==null)rows.push('<p>'+(fresh(q)&&!q.error?'目前':'依最後可用報價估算')+'未實現損益 '+pnlHtml(p.currentPnl,m)+'</p>');
 if(p.stop)rows.push('<p>停損價 <b>'+fmt(p.stop)+'</b>'+(p.stopReached===null?'':p.stopReached?' · <strong class="research-risk">'+(fresh(q)&&!q.error?'已碰到設定線':'最後報價已碰到設定線')+'</strong>':' · 報價仍在設定線上方')+(p.stopPnl===null?'':' · 假設於此價出場 '+pnlHtml(p.stopPnl,m))+'</p>');
 if(p.target)rows.push('<p>目標價 <b>'+fmt(p.target)+'</b>'+(p.targetPnl===null?'':' · 假設於此價出場 '+pnlHtml(p.targetPnl,m))+'</p>');
 if(p.maxShares!==null)rows.push('<p>風險預算上限 <b>'+fmt(p.maxShares,0)+' 股</b> · 進場 '+fmt(p.entry)+'／停損 '+fmt(p.stop)+'</p>');
 if(p.reduceScenario!==null)rows.push('<p>持倉超出風險預算的情境股數 <b>'+fmt(p.reduceScenario,0)+' 股</b><span class="sub"> · 以報價到停損價的價差試算</span></p>');
 if(p.rewardRisk!==null)rows.push('<p>計畫報酬／風險比 <b>'+fmt(p.rewardRisk)+' 倍</b></p>');
 if(p.riskBudget&&p.maxShares===null)rows.push('<p class="sub">估算股數需要計畫進場價高於停損價。</p>');
 return '<section class="insight-row position-plan"><div class="row between wrap"><b>持倉與風險試算</b>'+configure+'</div>'+rows.join('')+
  '<p class="sub">試算未計手續費、稅、滑價或跳空。觸及設定線不代表可按該價格成交。</p></section>';
}
