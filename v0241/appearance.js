const appearancePresets={
 graphite:{name:'石墨',background:'#141517',foreground:'#e4e6e9',accent:'#a8b8ce'},
 midnight:{name:'純黑',background:'#08090b',foreground:'#f0f0f2',accent:'#82aaff'},
 ocean:{name:'深海',background:'#0f1923',foreground:'#e3edf6',accent:'#75d5e1'}
};
const appearanceColors=[['background','背景色'],['foreground','文字色'],['accent','強調色']];
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
const hexColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const rgb=color=>color.slice(1).match(/../g).map(s=>parseInt(s,16));
function mixColor(a,b,amount){
 const right=rgb(b);
 return '#'+rgb(a).map((n,i)=>Math.round(n+(right[i]-n)*amount).toString(16).padStart(2,'0')).join('');
}
function luminance(color){
 const weights=[.2126,.7152,.0722];
 return rgb(color).reduce((total,n,i)=>{
  const c=n/255;
  return total+weights[i]*(c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 },0);
}
function colorContrast(a,b){
 const x=luminance(a),y=luminance(b);
 return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
function appearanceVars(value){
 const {background:bg,foreground:fg,accent,contrast,font}=value;
 const intensity=contrast/100;
 return {'--base':bg,'--paper':mixColor(bg,fg,.058),'--soft':mixColor(bg,fg,.125),
  '--line':mixColor(bg,fg,.13+intensity*.15),'--ink':fg,'--quiet':mixColor(bg,fg,.58+intensity*.31),
  '--accent':accent,'--chart-bg':mixColor(bg,fg,.019),'--app-font':font+'px'};
}
function validAppearance(value){
 const panel=appearanceVars(value)['--paper'];
 if(luminance(value.background)>.15)return '請選較暗的背景色。';
 if(colorContrast(panel,value.foreground)<4.5)return '請調亮文字色，讓文字和背景更容易區分。';
 if(colorContrast(panel,value.accent)<4.5)return '請調亮強調色，讓連結和圖線保持清楚。';
 return '';
}
function normalizeAppearance(value){
 const theme=Object.hasOwn(appearancePresets,value?.theme)?value.theme:'graphite',preset=appearancePresets[theme];
 const result={theme,font:clamp(value?.font,12,20,13),contrast:clamp(value?.contrast,0,100,60)};
 for(const [key] of appearanceColors)result[key]=hexColor(value?.[key])?value[key]:preset[key];
 if(validAppearance(result))for(const [key] of appearanceColors)result[key]=preset[key];
 return result;
}
function applyAppearance(target,value){
 for(const [key,color] of Object.entries(appearanceVars(value)))target.style.setProperty(key,color);
}
function appearanceBody(value){
 return '<section class="appearance-group"><div class="appearance-row"><strong>主題</strong><select data-field="appearanceTheme">'+
  Object.entries(appearancePresets).map(([key,theme])=>'<option value="'+key+'"'+(key===value.theme?' selected':'')+'>'+theme.name+'</option>').join('')+
  '</select></div>'+appearanceColors.map(([key,label])=>'<label class="appearance-row"><span>'+label+'</span><span class="appearance-color"><input type="color" data-field="'+key+'" value="'+value[key]+'"><span data-el="'+key+'Hex">'+value[key].toUpperCase()+'</span></span></label>').join('')+'</section>'+
  '<section class="appearance-group"><label class="appearance-row"><span>介面文字大小</span><input type="number" data-field="appearanceFont" min="12" max="20" step="1" value="'+value.font+'"></label>'+
  '<label class="appearance-row"><span>介面對比</span><span class="row"><input type="range" data-field="appearanceContrast" min="0" max="100" value="'+value.contrast+'"><span data-el="contrastValue">'+value.contrast+'</span></span></label></section>'+
  '<div class="appearance-preview" data-el="appearancePreview"><strong>盤中走勢</strong><p>在季線下方，盤中回升</p><span>預覽強調色</span></div>'+
  '<p class="sub" data-el="appearanceStatus" aria-live="polite"></p>'+
  '<div class="row between wrap dialog-actions"><button data-act="appearanceReset">恢復預設</button><button data-act="settings">返回設定</button><button class="primary" data-act="appearanceSave">儲存外觀</button></div>';
}
function appearanceField(key){return el('dialog').querySelector('[data-field="'+key+'"]');}
function appearanceDraft(){
 return {theme:appearanceField('appearanceTheme').value,background:appearanceField('background').value,
  foreground:appearanceField('foreground').value,accent:appearanceField('accent').value,
  font:clamp(appearanceField('appearanceFont').valueAsNumber,12,20,13),
  contrast:clamp(appearanceField('appearanceContrast').valueAsNumber,0,100,60)};
}
function previewAppearance(){
 const value=appearanceDraft();
 for(const [key] of appearanceColors)el(key+'Hex').textContent=value[key].toUpperCase();
 el('contrastValue').textContent=value.contrast;
 el('appearanceStatus').textContent=validAppearance(value);
 applyAppearance(el('appearancePreview'),value);
}
function fillAppearance(value){
 appearanceField('appearanceTheme').value=value.theme;
 appearanceField('appearanceFont').value=value.font;
 appearanceField('appearanceContrast').value=value.contrast;
 for(const [key] of appearanceColors)appearanceField(key).value=value[key];
 previewAppearance();
}
