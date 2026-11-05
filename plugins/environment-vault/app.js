'use strict';
const $=id=>document.getElementById(id);let previewData=null,busy=false,activeGroup="setting",onlyDifferences=false;const selectedIds=new Set();
const {platformName,shortcutText}=window.PlatformUI;let mappingEditing=false,mappingPreference=null,mappingNotice='';let manageLocal=false,managedVersions=[],deleteCandidate=null;
const api=()=>{if(!window.environmentVault)throw Error('插件查询层未初始化，请检查加载日志');return window.environmentVault;};
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error?'error':'';}
async function refreshPermissions(){try{const state=await api().permissions();const complete=state.fullAccess||state.required.every(name=>state.granted.includes(name));$('permissionState').textContent=complete?'已记录全部所需权限；后续操作由宿主核验授权状态':`首次备份或读取版本时申请全部所需权限${state.pending.length?` · ${state.pending.length} 项待审批`:''}；批准后重试操作即可`;}catch(error){$('permissionState').textContent=error.message;}}



function configured(state){return !!(state.config.url&&state.config.username&&state.config.device);}
function status(){const state=api().status();$('localPlatform').textContent='本机 · '+platformName(state.platform);const summary=[];if(configured(state)){summary.push(state.config.device);summary.push(state.config.timed?`每 ${state.config.interval} 分钟上传`:'手动上传');if(!state.hasPassword)summary.push('需补充密码');}else summary.push('首次使用，请配置 WebDAV');$('configSummary').textContent=summary.join(' · ');$('scheduler').textContent=state.config.timed?`定时上传已启用 · 下次 ${state.nextRun?new Date(state.nextRun).toLocaleTimeString():''}`:'定时上传未启用';$('last').textContent=state.lastResult;updateMappingScope();return state;}
/** 页面统一串行化业务操作；恢复所选内容始终由预览 token 与选中卡片共同确定。 */
async function run(message,fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button, #mappingPanel select, #version, #source'))b.disabled=true;$('notice').className='loading';$('notice').textContent=message;try{await fn();}catch(error){notice(error.message,true);}finally{busy=false;for(const b of document.querySelectorAll('button, #mappingPanel select, #version, #source'))b.disabled=false;updateCount();updatePasteButton();$('confirmDelete').disabled=!deleteCandidate;try{status();}catch{}await refreshPermissions();}}
function selected(){return [...selectedIds];}
function updateCount(){
 $('count').textContent=previewData?`已选 ${selectedIds.size} / ${previewData.rows.filter(row=>row.enabled).length}`:'';
 $('restore').disabled=busy||!previewData||!selectedIds.size;
 for(const section of document.querySelectorAll('.restore-category')){const rows=previewData?.rows.filter(row=>row.group==='setting'&&window.RestoreGroups.groupFor(row).id===section.dataset.category&&row.enabled)||[];section.querySelector('.category-count').textContent=`${rows.filter(row=>selectedIds.has(row.id)).length} / ${rows.length}`;}
 for(const card of document.querySelectorAll('.item')){const chosen=selectedIds.has(card.dataset.id);card.classList.toggle('selected',chosen);const toggle=card.querySelector('.item-select');toggle.setAttribute('aria-pressed',String(chosen));toggle.disabled=busy||card.dataset.enabled!=='true';}
}
function selectCategory(category){const rows=previewData.rows.filter(row=>row.group==='setting'&&row.enabled&&window.RestoreGroups.groupFor(row).id===category);const next=rows.some(row=>!selectedIds.has(row.id));for(const row of rows){if(next)selectedIds.add(row.id);else selectedIds.delete(row.id);}updateCount();}
function selectGroup(group){const rows=previewData?.rows.filter(row=>row.enabled&&(!group||row.group===group))||[];const next=rows.some(row=>!selectedIds.has(row.id));for(const row of rows){if(next)selectedIds.add(row.id);else selectedIds.delete(row.id);}updateCount();}
function value(v){return v===undefined?'无':JSON.stringify(v,null,2);}
/** 详情按备份系统和目标系统分别展示按键；Alt 在 Mac 上显示为 Option，不改变恢复数据。 */
function shortcutValue(v,platform){return typeof v==='string'?shortcutText(v,platform):v&&typeof v==='object'?{...v,shortcut:shortcutText(v.shortcut,platform)}:v;}
function showDetail(row){
 const isShortcut=row.sourcePlatform!==undefined;$('detailTitle').textContent=row.title;
 $('detailReason').textContent=[row.name,row.reason,isShortcut?`备份：${platformName(row.sourcePlatform)} → 本机：${platformName(row.targetPlatform)}；macOS 的 Option 对应内部 Alt。`:''].filter(Boolean).join(' · ');
 $('originalSection').hidden=!isShortcut;$('backupLabel').textContent=isShortcut?'恢复到 '+platformName(row.targetPlatform)+' 的值':'备份中的值';
 if(isShortcut){$('originalLabel').textContent='备份原值 · '+platformName(row.sourcePlatform);$('originalValue').textContent=value(shortcutValue(row.sourceValue,row.sourcePlatform));}
 $('backupValue').textContent=value(row.needsMapping?'请先选择映射方案':isShortcut?shortcutValue(row.value,row.targetPlatform):row.value);$('currentValue').textContent=value(isShortcut?shortcutValue(row.current,row.targetPlatform):row.current);$('itemDetail').showModal();
}
function filterItems(){
 const query=$('search').value.trim().toLocaleLowerCase();
 for(const row of previewData?.rows||[]){const card=[...document.querySelectorAll('.item')].find(node=>node.dataset.id===row.id);card.hidden=!(row.title+' '+(row.name||'')+' '+(row.group==='setting'?window.RestoreGroups.groupFor(row).title:'')).toLocaleLowerCase().includes(query)||(onlyDifferences&&!row.different);}
 for(const section of document.querySelectorAll('.restore-category')){section.hidden=!section.querySelector('.item:not([hidden])');if(query||onlyDifferences)section.open=true;}
 $('settings').hidden=activeGroup!=='setting';$('plugins').hidden=activeGroup!=='plugin';
 $('settingsTab').setAttribute('aria-selected',String(activeGroup==='setting'));$('pluginsTab').setAttribute('aria-selected',String(activeGroup==='plugin'));
 $('empty').hidden=!!document.querySelector(`#${activeGroup==='setting'?'settings':'plugins'} .item:not([hidden])`);
}
/** 选中状态独立于筛选；信息按钮与选择按钮并列，避免查看详情时误改恢复范围。 */
function renderPreview(data,preserve=false){const previousSelection=new Set(selectedIds),previousGroup=activeGroup,previousDifferences=onlyDifferences,previousQuery=$('search').value;previewData=data;if(!preserve)mappingEditing=false;selectedIds.clear();activeGroup='setting';onlyDifferences=false;$('search').value='';$('differences').setAttribute('aria-pressed','false');$('settings').replaceChildren();$('plugins').replaceChildren();$('selection').hidden=false;$('resultsCard').hidden=true;$('manifest').textContent=`${data.manifest.device} · 备份 ${platformName(data.manifest.platform)} → 本机 ${platformName(data.targetPlatform)} · ${new Date(data.manifest.createdAt).toLocaleString()}${data.marketError?' · 插件市场未就绪，设置仍可选择；授权后重新读取版本':''}${data.shortcutError?' · 快捷键指令核对未就绪：'+data.shortcutError:''}`;
 if(preserve){activeGroup=previousGroup;onlyDifferences=previousDifferences;$('search').value=previousQuery;$('differences').setAttribute('aria-pressed',String(onlyDifferences));for(const row of data.rows)if(row.enabled&&previousSelection.has(row.id))selectedIds.add(row.id);}
 if(!preserve)initializeMapping();
 const pluginNames=Object.fromEntries(data.rows.filter(row=>row.group==='plugin').map(row=>[row.name,row.title]));
 const buckets=new Map();
 for(const row of [...data.rows].sort((a,b)=>window.RestoreGroups.rank(a)-window.RestoreGroups.rank(b))){
  let destination=$('plugins');if(row.group==='setting'){const category=window.RestoreGroups.groupFor(row);if(!buckets.has(category.id)){const section=document.createElement('details');section.className='restore-category';section.dataset.category=category.id;section.open=true;const heading=document.createElement('summary');const label=document.createElement('span');label.textContent=category.title;const count=document.createElement('span');count.className='category-count';label.append(count);const all=document.createElement('button');all.textContent='全选本组';all.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();selectCategory(category.id);});heading.append(label,all);const grid=document.createElement('div');grid.className='item-grid';section.append(heading,grid);$('settings').append(section);buckets.set(category.id,grid);}destination=buckets.get(category.id);}
  const box=document.createElement('div');box.className=`item${row.enabled?'':' disabled'}${row.different?' different':''}`;box.dataset.id=row.id;box.dataset.enabled=String(row.enabled);
  const toggle=document.createElement('button');toggle.className='item-select';toggle.disabled=!row.enabled;toggle.setAttribute('aria-pressed','false');toggle.title=row.enabled?'点击选择或取消选择':row.reason||'不可恢复';
  const title=document.createElement('span');title.className='item-title';title.textContent=row.title;
  const tag=document.createElement('span');tag.className='tag';tag.textContent=window.SettingValues.card(row,pluginNames);tag.title=tag.textContent;if(tag.textContent.length>26)tag.classList.add('long-value');
  const mark=document.createElement('span');mark.className='selection-mark';mark.textContent='✓';mark.setAttribute('aria-hidden','true');toggle.append(title,tag);if(row.different&&!row.needsMapping&&row.group==='setting'){const current=document.createElement('span');current.className='current-value';current.textContent='本机：'+window.SettingValues.format(row,row.current,pluginNames);current.title=current.textContent;toggle.append(current);}if(!row.enabled){const warning=document.createElement('span');warning.className='item-warning';warning.textContent='不可恢复';warning.title=row.reason;toggle.append(warning);}toggle.append(mark);
  toggle.addEventListener('click',()=>{if(busy||!row.enabled)return;if(selectedIds.has(row.id))selectedIds.delete(row.id);else selectedIds.add(row.id);updateCount();});
  const info=document.createElement('button');info.className='icon-button item-info';info.title='查看详情';info.setAttribute('aria-label',`查看${row.title}详情`);info.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg>';info.addEventListener('click',()=>showDetail(row));
  box.append(toggle,info);destination.append(box);
 }
 $('settingsTotal').textContent=data.rows.filter(row=>row.group==='setting').length;$('pluginsTotal').textContent=data.rows.filter(row=>row.group==='plugin').length;filterItems();updateCount();updateMappingScope();
}
/** 一份双向共用的本机对照表；展示不依赖当前备份或操作系统。 */
function initializeMapping(){
 const config=mappingPreference;$('mappingPanel').classList.remove('mapping-required');$('mappingMode').value=config?.mode||'';$('customMapping').replaceChildren();$('customMapping').hidden=config?.mode!=='custom';
 $('mappingDirection').textContent='Mac 与 Windows 共用一张对应表；Shift 和其他按键保持不变。';
 for(const key of window.KeyMapping.keys('darwin')){const label=document.createElement('label');label.className='small';label.textContent='Mac '+shortcutText(key,'darwin')+' ↔ Windows';const select=document.createElement('select');select.dataset.sourceKey=key;select.setAttribute('aria-label','Mac '+shortcutText(key,'darwin')+' 对应 Windows');select.add(new Option('请选择对应键',''));for(const target of window.KeyMapping.keys('win32'))select.add(new Option(shortcutText(target,'win32'),target));select.value=config?.custom?.[key]||'';select.addEventListener('change',mappingChanged);label.append(select);$('customMapping').append(label);}
 renderMappingSummary(config);$('mappingPanel').open=!config||!!mappingNotice;$('mappingHint').textContent=mappingNotice||(config?'已加载本机保存的方案；跨系统恢复时自动用于预览。':'有效配置自动保存在本机；未配置时不能恢复跨系统快捷键。');
}
function updateMappingScope(){$('mappingScope').textContent=previewData?(previewData.manifest.platform===previewData.targetPlatform?'当前预览为同系统恢复：不使用映射，快捷键保留备份原按键。':'当前预览为跨系统恢复：仅所选快捷键（含主唤起键）使用映射。'):'仅在跨系统恢复快捷键时生效；同系统恢复保留备份原按键。';}
function renderMappingSummary(config){$('mappingCollapsedSummary').textContent=({standard:'标准功能映射',position:'键盘位置映射',custom:'自定义映射'}[config?.mode]||'尚未配置')+(config?' · 已保存本机':'');const map=config?window.KeyMapping.resolve(config,'darwin','win32'):null;$('mappingSummary').textContent=map?Object.entries(map).map(([a,b])=>'Mac '+shortcutText(a,'darwin')+' ↔ '+shortcutText(b,'win32')).join('；'):'';}
function mappingInput(){const mode=$('mappingMode').value;if(!mode)return null;const config={mode};if(mode==='custom')config.custom=Object.fromEntries([...$('customMapping').querySelectorAll('select')].map(select=>[select.dataset.sourceKey,select.value]));return config;}
async function mappingChanged(){
 if(busy)return;const applies=previewData&&previewData.manifest.platform!==previewData.targetPlatform;if(applies)mappingEditing=true;$('customMapping').hidden=$('mappingMode').value!=='custom';let config=mappingInput(),problem='';try{config=window.KeyMapping.preference(config);}catch(error){problem=error.message;config=null;}
 const before=selectedIds.size;await run('正在保存本机映射偏好…',async()=>{
  const saved=await api().saveMapping(config);mappingPreference=saved;mappingNotice='';
  if(applies){const result=await api().remap(previewData.token,saved);renderPreview(result,true);mappingEditing=false;}
  renderMappingSummary(saved);$('mappingPanel').open=!saved;$('mappingPanel').classList.toggle('mapping-required',!saved);$('mappingHint').textContent=problem||(!saved?'未配置有效方案，旧偏好已清除。':`已自动保存在本机${applies?'，快捷键预览已更新':''}${before>selectedIds.size?'；冲突或不可恢复项目已取消选择':''}。`);
  notice(saved?'映射偏好已保存于本机，尚未恢复任何设置。':problem||'映射偏好已清除。');
 });
}
$('mappingPanel').addEventListener('toggle',()=>{$('mappingToggle').textContent=$('mappingPanel').open?'收起配置':'展开配置';});
$('mappingMode').addEventListener('change',mappingChanged);
function requireMapping(){
 if(!previewData||previewData.manifest.platform===previewData.targetPlatform||!selected().some(id=>id.startsWith('shortcut:')))return false;
 if(previewData.mapping&&!mappingEditing)return false;
 $('mappingPanel').open=true;$('mappingPanel').classList.add('mapping-required');$('mappingHint').textContent='你已选择快捷键，请先选择映射方案或完整配置自定义映射。';$('mappingPanel').scrollIntoView({behavior:'smooth',block:'center'});$('mappingMode').focus();notice('请先完成跨系统快捷键映射；本机尚未修改。',true);return true;
}
function versionLabel(row){return `${row.time} · ${row.device} · ${platformName(row.platform)} · ${(row.bytes/1024).toFixed(1)} KB`;}
function populateVersions(rows,wanted=''){$('version').replaceChildren(new Option(rows.length?'请选择版本':'没有备份版本',''));for(const row of rows)$('version').add(new Option(versionLabel(row),row.name));if(rows.some(row=>row.name===wanted))$('version').value=wanted;}
async function list(){previewData=null;$('selection').hidden=true;$('manifest').textContent='';const rows=await api().versions($('source').value==='local');populateVersions(rows);notice(`找到 ${rows.length} 个版本。选择版本后点击“读取版本”。`);}
/** 管理页只渲染当前来源的快照，每个删除动作都先展示文件、时间和设备供用户确认。 */
function renderManagedVersions(){
 $('backupRows').replaceChildren();$('managerSource').textContent=(manageLocal?'本机恢复前备份':'WebDAV 备份')+' · '+managedVersions.length+' 个版本';
 if(!managedVersions.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='没有备份版本';$('backupRows').append(empty);}
 for(const row of managedVersions){const box=document.createElement('div');box.className='backup-row';const body=document.createElement('div');const title=document.createElement('strong');title.textContent=row.time+' · '+row.device;const meta=document.createElement('p');meta.className='muted small';meta.textContent=platformName(row.platform)+' · '+(row.bytes/1024).toFixed(1)+' KB';const filename=document.createElement('p');filename.className='backup-file';filename.textContent=row.name;body.append(title,meta,filename);const button=document.createElement('button');button.className='icon-button delete-backup';button.title='删除备份';button.setAttribute('aria-label','删除备份 '+row.name);button.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';button.addEventListener('click',()=>{deleteCandidate=row;$('deleteInfo').textContent=(manageLocal?'本机恢复前备份':'WebDAV 备份')+' · '+versionLabel(row);$('deleteName').textContent=row.name;$('deleteError').textContent='';$('confirmDelete').disabled=false;$('deleteDialog').showModal();});box.append(body,button);$('backupRows').append(box);}
}
$('manage').addEventListener('click',()=>run('正在读取历史备份…',async()=>{manageLocal=$('source').value==='local';managedVersions=await api().versions(manageLocal);$('managerError').textContent='';renderManagedVersions();$('backupManager').showModal();}));
$('closeManager').addEventListener('click',()=>$('backupManager').close());
$('cancelDelete').addEventListener('click',()=>{deleteCandidate=null;$('deleteDialog').close();});
$('deleteDialog').addEventListener('cancel',()=>{deleteCandidate=null;});
$('confirmDelete').addEventListener('click',()=>run('正在删除并确认备份已移除…',async()=>{
 if(!deleteCandidate)return;const name=deleteCandidate.name;
 try{
  await api().deleteVersion(name,manageLocal);deleteCandidate=null;$('deleteDialog').close();
  const current=$('version').value;if(manageLocal===($('source').value==='local')&&current===name){previewData=null;$('selection').hidden=true;$('manifest').textContent='';}
  managedVersions=managedVersions.filter(row=>row.name!==name);renderManagedVersions();if(manageLocal===($('source').value==='local'))populateVersions(managedVersions,current);
  notice('备份已删除：'+name);
 }catch(error){$('deleteError').textContent=error.message;notice(error.message,true);}
}));
$('save').addEventListener('click',()=>run('正在保存配置…',async()=>{const input={};for(const id of ['url','username','password','device','interval'])input[id]=$(id).value;input.timed=$('timed').checked;input.remember=$('remember').checked;await api().save(input);$('configPanel').open=false;notice('配置已保存。定时任务只上传，不自动下载或恢复。');}));
$('upload').addEventListener('click',()=>run('正在压缩、上传并回读校验…',async()=>{const r=await api().upload();notice(`上传完成：${r.settings} 项设置、${r.plugins} 个插件、${r.shortcuts} 项快捷键/开关。${r.name}`);}));
$('list').addEventListener('click',()=>run('正在读取版本列表…',list));
$('source').addEventListener('change',()=>run('正在读取备份来源…',list));
$('version').addEventListener('change',()=>{previewData=null;$('selection').hidden=true;updateCount();updateMappingScope();});
$('preview').addEventListener('click',()=>run('正在下载并校验备份，尚未修改本机…',async()=>{if(!$('version').value)throw Error('请先选择一个备份版本');const r=await api().preview($('version').value,$('source').value==='local');renderPreview(r);notice('预览完成。请点击卡片选择要恢复的项目，也可以一键全选。');}));
$('all').addEventListener('click',()=>selectGroup());$('allGroup').addEventListener('click',()=>selectGroup(activeGroup));
$('settingsTab').addEventListener('click',()=>{activeGroup='setting';filterItems();});$('pluginsTab').addEventListener('click',()=>{activeGroup='plugin';filterItems();});
$('search').addEventListener('input',filterItems);$('differences').addEventListener('click',()=>{onlyDifferences=!onlyDifferences;$('differences').setAttribute('aria-pressed',String(onlyDifferences));filterItems();});
$('closeDetail').addEventListener('click',()=>$('itemDetail').close());
$('restore').addEventListener('click',()=>{if(requireMapping())return;return run('正在保存本机备份并恢复所选项目，请勿退出 ZTools…',async()=>{const result=await api().restore(previewData.token,selected());previewData=null;$('selection').hidden=true;$('resultsCard').hidden=false;$('resultSummary').textContent=result.summary;$('results').replaceChildren();for(const row of result.results){const li=document.createElement('li');li.className=row.status;li.textContent=`${{success:'✓',skipped:'－',failed:'✕'}[row.status]} ${row.title}：${row.message}`;$('results').append(li);}$('recovery').textContent=`本机恢复前备份：${result.backupPath}。未立即生效的设置请重启 ZTools；可切换到“本机恢复前备份”选择性撤销。`;notice(result.summary,result.results.some(row=>row.status==='failed'));});});
window.addEventListener('vault-status',event=>{if(event.detail?.permissionsChanged){refreshPermissions();if(!busy)notice('授权状态已更新。请重新点击之前的操作，所需权限齐备后才会执行。');return;}if(event.detail?.progress){$('notice').textContent=event.detail.progress;}else{try{status();}catch{}refreshPermissions();}});
$('configPanel').addEventListener('toggle',()=>{$('configToggle').textContent=$('configPanel').open?'收起配置':'展开配置';});
try{const state=status();mappingPreference=state.mappingPreference||null;mappingNotice=state.mappingNotice||'';initializeMapping();$('configPanel').open=!configured(state);if(configured(state))notice('配置已加载。可立即上传，或选择备份版本预览恢复项目。');for(const id of ['url','username','device','interval'])$(id).value=state.config[id];$('timed').checked=state.config.timed;$('remember').checked=state.config.remember;if(state.hasPassword)$('password').placeholder='本机已保存；留空保存会清除密码';if(state.config.timed&&!state.hasPassword)notice('定时配置已恢复，请输入 WebDAV 密码并保存后才能上传。',true);}catch(error){notice(error.message,true);}

refreshPermissions();

function updatePasteButton(){$('parseConfig').disabled=busy||!$('pasteConfig').value.trim();}
/** 先完整解析，再一次性填入三个字段；失败保留原表单，成功清空粘贴区中的凭据。 */
function fillPastedConfig(text){
 if(busy)return;
 try{const parsed=window.WebdavConfigParser.parse(text);for(const id of ['url','username','password'])$(id).value=parsed[id];$('configPanel').open=true;$('pasteConfig').value='';$('pasteResult').className='paste-success small';$('pasteResult').textContent='已填入 3 项配置，尚未保存。可继续调整后点击“保存配置”。';}
 catch(error){$('pasteResult').className='paste-error small';$('pasteResult').textContent=error.message+'；原表单未更改。';}
 updatePasteButton();
}
$('parseConfig').addEventListener('click',()=>fillPastedConfig($('pasteConfig').value));
$('pasteConfig').addEventListener('input',()=>{updatePasteButton();$('pasteResult').className='muted small';$('pasteResult').textContent='文本已编辑，请点击“识别并填入”；尚未更改表单。';});
updatePasteButton();
