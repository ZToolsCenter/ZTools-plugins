'use strict';
const {spawn}=require('node:child_process');
const {join}=require('node:path');
const fs=require('node:fs');
const {createInterface}=require('node:readline');
const core=require('./core.cjs');
const art=require('./action-art.cjs');
const pluginActions=require('./plugin-actions.cjs');
const {createPipe}=require('./pipe.cjs');
let child=null,pipe=null,nativeReady=false,config=null,file=null,prefsFile=null;
let paused=false,settingsVisible=true,status='正在初始化',lastError='';
const listeners=new Set();let resolveReady;const ready=new Promise(resolve=>resolveReady=resolve);
function emit(){for(const fn of listeners)try{fn({paused,status,lastError,running:!!child})}catch{}}
function send(message){return pipe?.send(message)||false}
function persistPause(){fs.mkdirSync(require('node:path').dirname(prefsFile),{recursive:true});fs.writeFileSync(prefsFile+'.tmp',JSON.stringify({paused}));fs.renameSync(prefsFile+'.tmp',prefsFile)}
function applySaved(){send({op:'configure',config:art.decorate(config),paused,settingsVisible,hostPid:process.ppid})}
async function executePlugin(id){try{const result=await pluginActions.execute(window.ztools,config,id);status=result;lastError='';send({op:'feedback',message:result,image:art.decorate(config).actions.find(a=>a.id===id)?.image})}catch(e){status='插件指令失败';lastError=e.message;send({op:'feedback',message:'插件指令失败：'+e.message})}emit()}
function start(){
 if(child)return;const proc=spawn(join(__dirname,'native','MouseService.exe'),process.env?.SK_MOUSE_TEST==='1'?['--integration']:[],{stdio:['pipe','pipe','pipe'],windowsHide:true});child=proc;nativeReady=false;
 pipe=createPipe(proc.stdin,error=>{if(child===proc){lastError=error.message;status='不可用';paused=true;emit()}});status='正在启动';emit();
 createInterface({input:proc.stdout}).on('line',line=>{try{const message=JSON.parse(line);if(message.kind==='plugin-action'){void executePlugin(message.message);return}status=message.message;if(message.kind==='error')lastError=message.message;else if(message.kind==='status'){lastError='';nativeReady=true;}if(message.kind==='ready')applySaved();emit()}catch{}});
 proc.stderr.on('data',()=>{});proc.on('error',error=>{lastError=error.message;status='不可用';emit()});
 proc.on('exit',()=>{if(child===proc){child=null;pipe=null;nativeReady=false;status='已停止';emit()}});
}
function stopChild(){const proc=child;if(!proc)return;send({op:'stop'});setTimeout(()=>{if(child===proc)proc.kill()},1500)}
window.skk={
 async actionName(action){await ready;return action.type==='url'?art.websiteName(action.value):''},
 async actionIcon(action){await ready;return art.resolve(window.ztools,action)},
 async pickActionIcon(){await ready;const result=await window.ztools.showOpenDialog({properties:['openFile'],filters:[{name:'图标图片',extensions:['png','jpg','jpeg','webp','ico','svg']}]});const p=Array.isArray(result)?result[0]:result?.filePaths?.[0];if(!p)return null;if(fs.statSync(p).size>280000)throw Error('图标请小于 280KB');const ext=require('node:path').extname(p).slice(1).toLowerCase();const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ico:'image/x-icon',svg:'image/svg+xml'}[ext];if(!mime)throw Error('不支持的图片格式');return 'data:'+mime+';base64,'+fs.readFileSync(p).toString('base64')},
 async pluginCatalog(){await ready;return pluginActions.catalog(window.ztools)},
 async authorizePluginCatalog(){await ready;return pluginActions.authorize(window.ztools)},
 subscribe(fn){listeners.add(fn);emit();return()=>listeners.delete(fn)},
 async snapshot(){await ready;return {config:structuredClone(art.decorate(config)),paused,status,lastError,running:!!child}},
 async save(draft){await ready;const errors=core.validate(draft);if(errors.length)throw Error(errors.join('；'));const next=core.upgrade(draft);core.saveAtomic(file,next);config=next;applySaved();return true},
 async pause(value){await ready;paused=!!value;persistPause();if(!child)start();send({op:'pause',value:paused});status=paused?'已暂停':'运行中';emit()},
 async activate(){await ready;paused=false;persistPause();if(!child)start();applySaved();await window.ztools.hideMainWindow(true);emit()},
 async stop(){await ready;paused=true;persistPause();stopChild();emit()},
 async testGesture(strokes){await ready;const ranking=core.rankShapes(strokes,config.gestures),threshold=config.gesture.shapeThreshold;return {matched:!!ranking[0]&&ranking[0].score>=threshold,closest:ranking[0]?{name:ranking[0].name,score:ranking[0].score}:null,threshold}},
 async test(id){await ready;if(!config.actions.some(a=>a.id===id))throw Error('动作不存在');if(!child)start();for(let i=0;!nativeReady&&i<100;i++)await new Promise(r=>setTimeout(r,50));if(!nativeReady)throw Error('后台服务未就绪');const hidden=await window.ztools.hideMainWindow(true);if(hidden===false)throw Error('无法切换到原窗口');await new Promise(r=>setTimeout(r,180));if(!send({op:'test',id}))throw Error('后台服务不可用')},
 validate:core.validate,recognize:core.recognize,defaults:core.defaults,
 async choose(kind){await ready;const properties=kind==='folder'?['openDirectory']:['openFile'];const result=await window.ztools.showOpenDialog({properties});return Array.isArray(result)?result[0]:result?.filePaths?.[0]},
 async export(){await ready;const result=await window.ztools.showSaveDialog({defaultPath:'鼠快快配置.json',filters:[{name:'JSON',extensions:['json']}]});const target=typeof result==='string'?result:result?.filePath;if(target)fs.writeFileSync(target,JSON.stringify(config,null,2));return !!target},
 async import(){await ready;const result=await window.ztools.showOpenDialog({properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});const path=Array.isArray(result)?result[0]:result?.filePaths?.[0];if(!path)return null;if(fs.statSync(path).size>8e6)throw Error('配置文件过大');const draft=JSON.parse(fs.readFileSync(path,'utf8')),errors=core.validate(draft);if(errors.length)throw Error(errors.join('；'));return core.upgrade(draft)}
};
function init(){
 if(!window.ztools){setTimeout(init,40);return}const api=window.ztools;
 try{
  const root=join(api.getPath('userData'),'shukuaikuai');file=join(root,'config.json');prefsFile=join(root,'runtime.json');config=core.loadSafe(file);
  try{paused=JSON.parse(fs.readFileSync(prefsFile,'utf8')).paused===true}catch{paused=false}
  start();
  api.onPluginEnter(async param=>{settingsVisible=true;send({op:'settings-visible',value:true,hostPid:process.ppid});if(param.code==='start')await window.skk.activate();else if(param.code==='pause')await window.skk.pause(true);else{status=paused?'已暂停':'运行中（使用已保存配置）';emit()}});
  api.onPluginOut(killed=>{settingsVisible=false;send({op:'settings-visible',value:false,hostPid:process.ppid});if(killed)stopChild()});
  api.onThemeChange?.(theme=>{document.documentElement.dataset.theme=theme.isDark?'dark':'light'});resolveReady();emit();
 }catch(error){lastError=error.message;status='初始化失败';emit();resolveReady()}
}
window.addEventListener('beforeunload',stopChild);init();
