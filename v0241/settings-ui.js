const settingsBackupState={ready:false,revision:'',path:'',lastSaved:'',message:'正在讀取設定備份…',error:'',timer:null,interval:null,promise:null,lastData:'',draft:null,conflict:false};
let settingsChangedAt=0,appBooting=true;
function settingsData(){
 return cleanSettings({watch:state.watch,rules:state.rules,watchSort:state.watchSort,watchOrder:state.watchOrder,watchPins:state.watchPins,seconds:state.seconds,notify:state.notify,
  snapshot:state.snapshot,snapshotFields:state.snapshotFields,appearance:state.appearance,chartPeriod:chartPreferredPeriod,chartMonths:state.months,profileDays:state.profileDays,
  backup:state.backup,update:state.update,updatedAt:settingsChangedAt||Date.now()});
}
function storeBrowserSettings(data){
 try{localStorage.setItem(storage,JSON.stringify(data));return true;}
 catch{log({title:'瀏覽器設定無法儲存',body:'檔案備份仍會嘗試儲存，請在設定內確認結果。',kind:'error'});return false;}
}
function applySettingsData(data){
 const value=cleanSettings(data);
 state.run=false;clearTimeout(schedule);state.next=0;dueQuotes.clear();
 for(const key of ['watch','rules','watchSort','watchOrder','watchPins','seconds','notify','snapshot','snapshotFields','appearance','backup','update'])state[key]=value[key];
 state.id=state.watch[0]?.id||null;state.months=value.chartMonths;state.profileDays=value.profileDays;chartPreferredPeriod=value.chartPeriod;setChartPeriod(value.chartPeriod);
 chartZoom=null;chartWheelSize=null;chartHover=null;state.items.clear();state.details.clear();state.tracking.clear();intradaySamples.clear();state.tab='research';
 settingsChangedAt=value.updatedAt||Date.now();applyAppearance(root,state.appearance);storeBrowserSettings(settingsData());render();
}
function backupStatus(){
 const status=el('backupStatus'),path=el('backupPath');
 if(status)status.textContent=settingsBackupState.error||settingsBackupState.message;
 if(path)path.textContent=settingsBackupState.path;
}
function queueSettingsBackup(){
 clearTimeout(settingsBackupState.timer);
 if(!settingsBackupState.ready||!state.backup.enabled||appBooting)return;
 settingsBackupState.timer=setTimeout(()=>writeSettingsBackup().catch(()=>{}),700);
}
function startSettingsBackupTimer(){
 clearInterval(settingsBackupState.interval);
 if(state.backup.enabled)settingsBackupState.interval=setInterval(()=>writeSettingsBackup().catch(()=>{}),state.backup.minutes*60000);
}
async function writeSettingsBackup(snapshot=false,dataOverride=null,keepalive=false){
 if(!sessionReady||!settingsBackupState.ready)throw Error(settingsBackupState.error||'尚未確認本機備份狀態，請先重新讀取。');
 if(settingsBackupState.promise){await settingsBackupState.promise;return writeSettingsBackup(snapshot,dataOverride,keepalive);}
 const data=dataOverride?cleanSettings(dataOverride):settingsData(),comparable=settingsComparable(data);
 if(!snapshot&&comparable===settingsBackupState.lastData)return true;
 const pack=settingsEnvelope(data);
 const task=(async()=>{
  settingsBackupState.message='正在儲存檔案備份…';settingsBackupState.error='';backupStatus();
  try{
   const response=JSON.parse(await bridge('settings-save',{method:'POST',headers:{'Content-Type':'application/json'},keepalive,body:JSON.stringify({pack,baseRevision:settingsBackupState.revision,snapshot})}));
   if(!/^[0-9a-f]{64}$/.test(response.revision))throw Error('本機服務沒有回傳有效的備份確認。');
   settingsBackupState.revision=response.revision;settingsBackupState.path=response.path;settingsBackupState.lastSaved=response.savedAt;settingsBackupState.lastData=comparable;
   settingsBackupState.message='已備份 '+twDate(Date.parse(response.savedAt))+' '+twTime(Date.parse(response.savedAt));settingsBackupState.error='';backupStatus();
   return true;
  }catch(e){
   if(e.status===409){settingsBackupState.ready=false;settingsBackupState.conflict=true;}
   settingsBackupState.error=e.status===409?'另一個視窗已有較新設定，已停止覆寫。請重新讀取備份後選擇要保留的資料。':'檔案備份未完成（'+message(e)+'），目前頁面的設定仍保留。';
   backupStatus();log({title:'設定備份未完成',body:settingsBackupState.error,kind:'error'});throw e;
  }
 })();
 settingsBackupState.promise=task;
 try{return await task;}finally{settingsBackupState.promise=null;if(!dataOverride&&settingsComparable(settingsData())!==comparable)queueSettingsBackup();}
}
async function initSettingsBackup(){
 settingsBackupState.error='';settingsBackupState.message='正在讀取檔案備份…';backupStatus();
 try{
  const response=await json('settings-current');settingsBackupState.path=response.path||'';
  const current=response.current;
  settingsBackupState.revision=current?.revision||'';
  if(current){
   const pack=readSettingsEnvelope(current.pack),disk=pack.data,local=settingsData();
   const same=settingsComparable(local)===settingsComparable(disk);
   if(!browserSettingsPresent||disk.updatedAt>settingsChangedAt&&settingsChangedAt>0||same){
    applySettingsData(disk);settingsBackupState.lastData=settingsComparable(disk);settingsBackupState.lastSaved=pack.savedAt;
    settingsBackupState.message=(current.source==='backup'?'主設定檔異常，已讀取最近有效備份。':'已讀取共用設定檔。')+' '+disk.watch.length+' 檔商品。';
    if(current.source==='backup')log({title:'已從歷史備份還原',body:'原設定檔未通過檢查，已讀取最近有效備份。'});
   }else if(!settingsChangedAt){
    settingsBackupState.conflict=true;settingsBackupState.ready=false;settingsBackupState.error='瀏覽器與檔案內的設定不同，舊瀏覽器設定沒有時間戳記。兩份都已保留，請在「設定 → 備份與更新」選擇。';
    log({title:'請選擇要保留的設定',body:settingsBackupState.error});return;
   }else settingsBackupState.message='目前頁面的設定較新，將備份至共用資料夾。';
  }else settingsBackupState.message='尚無檔案備份，將建立第一份。';
  settingsBackupState.conflict=false;settingsBackupState.ready=true;
  if(!settingsChangedAt)settingsChangedAt=Date.now();
  storeBrowserSettings(settingsData());
 }catch(e){settingsBackupState.ready=false;settingsBackupState.error='共用設定檔暫時無法讀取，已保留瀏覽器設定並停止自動覆寫。請重新讀取或匯出目前設定。';log({title:'備份讀取未完成',body:settingsBackupState.error,kind:'error'});}
 finally{backupStatus();}
}
function downloadSettingsBackup(){
 const text=JSON.stringify(settingsEnvelope(settingsData()),null,2),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='Market_Watch_Settings_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 settingsBackupState.message='已匯出設定檔，請確認瀏覽器的下載位置。';settingsBackupState.error='';backupStatus();
}
function showSettingsRestorePreview(pack,label){
 const value=readSettingsEnvelope(pack);settingsBackupState.draft=value;
 const box=el('backupPreview');if(!box)return;
 box.hidden=false;box.innerHTML='<strong>還原預覽</strong><p>'+esc(label)+' · '+value.data.watch.length+' 檔商品</p><p class="sub">設定時間 '+esc(twDate(value.data.updatedAt)+' '+twTime(value.data.updatedAt))+'</p><p>'+esc(value.data.watch.map(m=>m.name+'（'+m.id+'）').join('、'))+'</p><p class="sub">包含成本、張數、目標、停損、排序、釘選及介面設定。確認後會取代目前設定，監控保持暫停。</p><button class="primary" data-act="backupRestoreConfirm">確認還原設定</button>';
}
async function readSettingsImport(input){
 const file=input.files?.[0];if(!file)return;
 const guard=input;
 try{
  if(file.size>200000)throw Error('設定檔過大，請選擇看盤小助手匯出的 JSON。');
  const pack=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
  if(state.modal!=='backups'||!guard.isConnected)return;
  showSettingsRestorePreview(pack,file.name);
 }catch(e){settingsBackupState.error='無法匯入（'+message(e)+'）。目前設定未變更。';backupStatus();}
 finally{input.value='';}
}
async function loadSettingsBackupList(){
 try{
  const response=await json('settings-backups'),list=el('backupHistory');if(!list)return;
  list.innerHTML=(response.items||[]).map(item=>'<option value="'+esc(item.id)+'">'+esc(twDate(item.updatedAt)+' '+twTime(item.updatedAt)+' · '+item.count+' 檔')+'</option>').join('');
  const button=el('backupHistoryLoad');if(button)button.disabled=!response.items?.length;
 }catch{settingsBackupState.error='歷史備份清單暫時無法讀取。';backupStatus();}
}
let updatePoll=null;
async function showUpdateStatus(){
 try{
  const info=await json('update-status'),text=el('updateStatus');
  if(text)text.textContent=(info.busy?'更新作業進行中。 ':'')+(info.state?.message||'尚未檢查更新')+(info.state?.availableVersion?' · v'+info.state.availableVersion:'');
  const download=el('updateDownload');if(download)download.disabled=info.busy||!['available','error'].includes(info.state?.status)||!info.state?.availableVersion;
 }catch{const text=el('updateStatus');if(text)text.textContent='暫時無法讀取更新狀態。';}
}
function backupsBody(){
 return '<h3>使用者設定備份</h3><p class="sub">新版共用同一份設定檔，保留最近 30 次備份。備份不含 AI 或 Telegram 金鑰、行情快取與分析文字。</p>'+
 '<label><input type="checkbox" data-field="backupEnabled" '+(state.backup.enabled?'checked':'')+'> 自動備份設定</label><label>定時補查備份<select data-field="backupMinutes">'+backupMinutes.map(n=>'<option value="'+n+'" '+(n===state.backup.minutes?'selected':'')+'>'+n+' 分鐘</option>').join('')+'</select></label>'+
 '<p class="sub">啟用時，設定變更後會自動備份，並依間隔補查有無尚未儲存的變更。需保留看盤頁面與啟動視窗。</p><p class="backup-path sub" data-el="backupPath"></p><p role="status" data-el="backupStatus"></p>'+
 '<div class="row wrap dialog-actions"><button data-act="backupNow">立即備份</button><button data-act="backupExport">匯出設定檔</button><button data-act="backupImport">匯入設定檔</button><input hidden type="file" accept="application/json,.json" data-el="backupFile"></div>'+
 '<div class="row wrap"><button data-act="backupReload">重新讀取備份</button><button data-act="backupPreviewCurrent">預覽共用設定</button><button data-act="backupKeepBrowser">以目前頁面設定備份</button></div>'+
 '<label>最近備份<select data-el="backupHistory"></select></label><button data-act="backupHistoryLoad" data-el="backupHistoryLoad" disabled>預覽選取的備份</button><div class="backup-preview" data-el="backupPreview" hidden></div>'+
 '<h3>程式更新</h3><p>目前版本 v'+appVersion+'</p><p class="sub">主來源 GitHub 官方發版區。完成設定讀取後每天檢查一次，離線時下次重試。</p>'+
 '<label><input type="checkbox" data-field="updateEnabled" '+(state.update.enabled?'checked':'')+'> 每天檢查更新</label><label><input type="checkbox" data-field="updateAuto" '+(state.update.autoDownload?'checked':'')+'> 新版自動下載備用，下次啟動套用</label><p role="status" data-el="updateStatus">正在讀取更新狀態…</p>'+
 '<div class="row wrap dialog-actions"><button data-act="updateCheck">立即檢查</button><button data-act="updateDownload" data-el="updateDownload" disabled>下載新版備用</button></div><p class="sub">更新不會強制中斷監控。下載完成後，結束程式再執行 Start-One-Click.cmd 即會套用。程式檔與個人設定分開保存。</p>'+
 '<div class="row between wrap dialog-actions"><button data-act="settings">返回設定</button><button class="primary" data-act="backupOptions">儲存備份與更新設定</button></div>';
}
async function backupAction(action,button){
 if(button)button.disabled=true;
 try{
  if(action==='backupExport')downloadSettingsBackup();
  else if(action==='backupImport')el('backupFile').click();
  else if(action==='backupNow'){await writeSettingsBackup(true);await loadSettingsBackupList();}
  else if(action==='backupReload'){await initSettingsBackup();startSettingsBackupTimer();queueSettingsBackup();}
  else if(action==='backupPreviewCurrent'){
   const info=await json('settings-current');if(!info.current)throw Error('尚無共用設定檔。');showSettingsRestorePreview(info.current.pack,'共用設定檔');
  }else if(action==='backupKeepBrowser'){
   const info=await json('settings-current');settingsBackupState.revision=info.current?.revision||'';settingsBackupState.ready=true;
   settingsChangedAt=Date.now();storeBrowserSettings(settingsData());await writeSettingsBackup(true);settingsBackupState.conflict=false;await loadSettingsBackupList();
  }else if(action==='backupHistoryLoad'){
   const id=el('backupHistory').value;if(!/^\d{8}T\d{9}Z_[0-9a-f]{8}\.json$/.test(id))throw Error('請先選擇有效備份。');
   const info=await json('settings-backup/'+id);showSettingsRestorePreview(info.pack,'歷史備份');
  }else if(action==='backupRestoreConfirm'){
   if(!settingsBackupState.draft)throw Error('請先選擇要還原的備份。');
   const info=await json('settings-current');settingsBackupState.revision=info.current?.revision||'';settingsBackupState.ready=true;
   const data={...settingsBackupState.draft.data,updatedAt:Date.now()};await writeSettingsBackup(true,data);applySettingsData(data);settingsBackupState.conflict=false;settingsBackupState.draft=null;
   modal('backups');startSettingsBackupTimer();refresh(false);if(selected())loadDetails(selected());
  }else if(action==='backupOptions'){
   const get=k=>el('dialog').querySelector('[data-field="'+k+'"]');
   state.backup={enabled:get('backupEnabled').checked,minutes:Number(get('backupMinutes').value)};state.update={enabled:get('updateEnabled').checked,autoDownload:get('updateAuto').checked};
   persist();startSettingsBackupTimer();if(settingsBackupState.ready)await writeSettingsBackup(true);settingsBackupState.message='備份與更新設定已儲存。';backupStatus();
  }else if(action==='updateCheck'||action==='updateDownload'){
   if(settingsBackupState.ready)await writeSettingsBackup();
   await bridge(action==='updateCheck'?'update-check':'update-download',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await showUpdateStatus();
  }
 }catch(e){if(e.status!==409)settingsBackupState.error=message(e);backupStatus();}
 finally{if(button?.isConnected)button.disabled=false;}
}
