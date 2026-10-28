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
  {name:'clay',background:'#f5e8df',foreground:'#92614b'}
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
 function appearance(value){const id=key(value)||'other',n=hash(id);return {...palette[n%palette.length],icon:Object.hasOwn(icons,id)?icons[id]:fallback[hash('icon:'+id)%fallback.length]};}
 return {canonical,key,label,entries,appearance,palette:Object.freeze(palette)};
});
