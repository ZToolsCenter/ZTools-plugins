/* Shared domain identity for catalog filters, editable suggestions and cover art.
 * SVGs: Lucide, ISC; originals and license in ../vendor/lucide/. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CommunityDomains=factory();})(typeof window!=='undefined'?window:this,()=>{
 'use strict';
 const legacy={communication:'科研交流',methods:'生物信息与方法',environment:'环境与微生物组',reading:'论文阅读',other:'其他主题'};
 const aliases=new Map(Object.entries(legacy).flatMap(([key,label])=>[[key,key],[label,key]]));
 aliases.set('科研表达与面试','communication');aliases.set('生物信息与方法','methods');aliases.set('自选主题','other');
 const clean=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
 const canonical=value=>{const text=clean(value);return aliases.get(text)||aliases.get(text.toLowerCase())||text;};
 const key=value=>canonical(value).toLowerCase();
 const label=value=>{const text=canonical(value);return Object.hasOwn(legacy,text)?legacy[text]:text;};
 function entries(values){const unique=new Map();for(const value of values){const id=key(value);if(id&&!unique.has(id))unique.set(id,{key:id,label:label(value)});}return [...unique.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));}
 // Fixed slots: adding or reordering domains never changes an existing cover.
 const palette=[
  {name:'mint',background:'#e3f1ec',foreground:'#356f5b'},
  {name:'sky',background:'#e6f0fa',foreground:'#3d6792'},
  {name:'violet',background:'#eee9f7',foreground:'#72558e'},
  {name:'rose',background:'#f7e7eb',foreground:'#9a4c65'},
  {name:'amber',background:'#f7edda',foreground:'#86621f'},
  {name:'teal',background:'#e1f1f1',foreground:'#326e73'},
  {name:'indigo',background:'#e8ebf8',foreground:'#515f98'},
  {name:'clay',background:'#f5e8df',foreground:'#92614b'},
  {name:'cobalt',background:'#dfeaff',foreground:'#244898'},
  {name:'lime',background:'#f0f4cf',foreground:'#526323'},
  {name:'coral',background:'#ffe2d6',foreground:'#963e28'},
  {name:'plum',background:'#efdaef',foreground:'#713873'},
  {name:'charcoal',background:'#e5e7eb',foreground:'#3f4652'},
  {name:'lemon',background:'#fff4ba',foreground:'#715813'}
 ].map(Object.freeze);
 const icons={
  '分子生物学与遗传学':'dna','临床医学与转化研究':'stethoscope','公共卫生与流行病学':'heart-pulse',
  '药学与药理学':'pill','神经科学与心理学':'brain','农业科学与食品科学':'wheat','化学与分析化学':'flask-conical',
  '材料科学与工程':'gem','物理学与天文学':'orbit','地球科学与气候研究':'earth','机械工程与能源研究':'cog',
  '电子电气与自动化':'circuit-board','计算机科学与人工智能':'cpu','数学与统计学':'chart-no-axes-combined',
  '经济学与管理学':'chart-no-axes-column','社会学与教育研究':'graduation-cap','微生物':'microscope','生物信息':'network',
  communication:'graduation-cap',methods:'network',environment:'earth',reading:'brain'
 };
 const fallback=['orbit','network','gem','cpu','earth','chart-no-axes-combined','flask-conical','graduation-cap'];
 function hash(text){let h=2166136261;for(const char of text)h=Math.imul(h^char.codePointAt(0),16777619);return h>>>0;}
 function appearance(value){const id=key(value)||'other',n=hash(id);return {...palette[n%8],icon:Object.hasOwn(icons,id)?icons[id]:fallback[hash('icon:'+id)%fallback.length]};}
 const colorLabels={mint:'薄荷绿',sky:'天空蓝',violet:'紫罗兰',rose:'玫瑰粉',amber:'琥珀黄',teal:'青绿色',indigo:'靛蓝色',clay:'陶土色',cobalt:'钴蓝',lime:'青柠',coral:'珊瑚',plum:'梅紫',charcoal:'石墨',lemon:'柠檬'};
 const iconOptions=[['graduation-cap','学术'],['microscope','微生物'],['dna','遗传'],['flask-conical','实验'],['network','网络'],['brain','思考'],['earth','地球'],['orbit','天文'],['cpu','计算'],['gem','材料'],['stethoscope','医学'],['heart-pulse','健康'],['pill','药学'],['wheat','农业'],['cog','工程'],['circuit-board','电子'],['chart-no-axes-column','统计'],['chart-no-axes-combined','趋势'],['book-open','阅读'],['bookmark','书签'],['star','星标'],['folder','文件夹'],['library','藏书'],['leaf','自然'],['beaker','烧杯'],['lightbulb','灵感'],['target','目标'],['trophy','奖杯'],['rocket','探索'],['puzzle','拼图']];
 function cleanCardStyle(raw){if(!raw||!palette.some(p=>p.name===raw.palette)||!iconOptions.some(([id])=>id===raw.icon))throw Error('请选择有效的卡片颜色与图标');return {palette:raw.palette,icon:raw.icon}}
 function cardStyle(domain,custom=false,override){const base=custom?{...palette[1],icon:'graduation-cap'}:appearance(domain);if(!override)return {...base,palette:base.name};try{const value=cleanCardStyle(override);return {...palette.find(p=>p.name===value.palette),...value}}catch{return {...base,palette:base.name}}}
 function cover(domain,custom=false,override){const style=cardStyle(domain,custom,override),n=document.createElement('span'),name=document.createElement('span'),icon=document.createElement('span');n.className='en-material-cover';n.dataset.palette=style.palette;n.dataset.icon=style.icon;n.style.setProperty('--material-background',style.background);n.style.setProperty('--material-foreground',style.foreground);name.textContent=label(domain)||(custom?'自建素材':'学习素材');icon.className='en-material-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--material-icon','url("'+new URL('vendor/lucide/'+style.icon+'.svg',document.baseURI).href+'")');n.append(name,icon);return n}
 function picker(initial={},domain='自建素材'){
  let value=cardStyle(domain,true,initial),root=document.createElement('fieldset'),legend=document.createElement('legend'),colors=document.createElement('div'),iconsGrid=document.createElement('div'),colorTitle=document.createElement('span'),iconTitle=document.createElement('span'),preview=cover(domain,true,value);root.className='en-appearance-picker';legend.textContent='预览与选择';colorTitle.textContent='颜色';iconTitle.textContent='图标';colorTitle.className=iconTitle.className='en-appearance-section-title';colors.className='en-appearance-colors';colors.setAttribute('role','group');colors.setAttribute('aria-label','卡片颜色');iconsGrid.className='en-appearance-icons';iconsGrid.setAttribute('role','group');iconsGrid.setAttribute('aria-label','卡片图标');
  const update=()=>{for(const b of colors.children)b.setAttribute('aria-pressed',String(b.dataset.palette===value.palette));for(const b of iconsGrid.children)b.setAttribute('aria-pressed',String(b.dataset.icon===value.icon));const next=cover(domain,true,value);preview.replaceWith(next);preview=next};
  for(const p of palette){const b=document.createElement('button');b.type='button';b.dataset.palette=p.name;b.className='en-appearance-color';b.title=colorLabels[p.name];b.setAttribute('aria-label',colorLabels[p.name]);b.style.setProperty('--swatch',p.background);b.style.setProperty('--swatch-ink',p.foreground);b.onclick=()=>{value={...value,palette:p.name};update()};colors.append(b)}
  for(const [id,name]of iconOptions){const b=document.createElement('button'),icon=document.createElement('span');b.type='button';b.dataset.icon=id;b.className='en-appearance-icon';b.title=name;b.setAttribute('aria-label',name);icon.className='en-material-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--material-icon','url("'+new URL('vendor/lucide/'+id+'.svg',document.baseURI).href+'")');b.append(icon);b.onclick=()=>{value={...value,icon:id};update()};iconsGrid.append(b)}root.append(legend,preview,colorTitle,colors,iconTitle,iconsGrid);update();return {element:root,value:()=>cleanCardStyle(value)};
 }
 async function editCardStyle({api,id,domain,custom=false,defaultStyle,onSaved}){
  const styles=await api.materialAppearance(),initial=cardStyle(domain,custom,styles[id]||defaultStyle),choice=picker(initial,domain),dialog=document.createElement('dialog'),head=document.createElement('header'),title=document.createElement('h3'),cancel=document.createElement('button'),save=document.createElement('button'),status=document.createElement('p'),focus=document.activeElement;dialog.className='panel en-appearance-dialog';dialog.setAttribute('aria-label','编辑卡片外观');head.className='list-heading';title.textContent='卡片外观';cancel.textContent='取消';cancel.className='secondary';save.textContent='保存外观';save.className='primary';status.setAttribute('role','status');const close=()=>{dialog.close();dialog.remove();if(focus?.isConnected)focus.focus()};cancel.onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();if(!save.disabled)close()});save.onclick=async()=>{save.disabled=cancel.disabled=true;try{await api.materialAppearance('set',{id,...choice.value()});await onSaved?.();close()}catch(e){status.textContent=e.message}finally{save.disabled=cancel.disabled=false}};head.append(title,cancel,save);dialog.append(head,choice.element,status);(document.getElementById('view-english')||document.body).append(dialog);dialog.showModal();cancel.focus();
 }
 return {canonical,key,label,entries,appearance,palette:Object.freeze(palette),iconOptions,cleanCardStyle,cardStyle,cover,picker,editCardStyle};
});
