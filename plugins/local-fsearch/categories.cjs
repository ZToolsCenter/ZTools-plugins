/** 分类使用引擎端过滤，不能先取前 100 条再按扩展名筛选。 */
module.exports = [
  { id: 'all', label: '全部文件', icon: 'grid', contentSupported: true },
  { id: 'folder', label: '文件夹', icon: 'folder', kind: 'dir' },
  { id: 'text', label: '文本', icon: 'file', contentSupported: true, ext: 'txt,text,md,mdx,markdown,rst,org,tex,json,jsonc,json5,jsonl,ndjson,yaml,yml,toml,xml,ini,cfg,conf,env,properties,plist,log,diff,patch,srt,vtt,rtf,csv,tsv' },
  { id: 'code', label: '代码', icon: 'code', contentSupported: true, ext: 'rs,c,h,cc,cpp,cxx,hpp,hh,m,mm,swift,go,py,pyi,js,mjs,cjs,ts,mts,cts,tsx,jsx,java,kt,kts,scala,rb,php,cs,fs,sh,zsh,bash,fish,lua,sql,html,htm,css,scss,sass,less,vue,svelte,astro,zig,nim,hs,ml,mli,ex,exs,erl,clj,dart,r,jl,metal,glsl,wgsl,hlsl,proto,graphql,gql,nix,tf,hcl,gradle,cmake,mk,make,dockerfile,pl,pm,ps1,bat,vim,el,lisp,scm,rkt,elm,purs,sol,v,sv,vhd,asm,s,d,cr,pas,f90,cmd,service,desktop,gitignore,editorconfig' },
  { id: 'excel', label: '表格', icon: 'table', contentSupported: true, contentLabel: '文本表格', contentExt: 'csv,tsv', ext: 'xls,xlsx,xlsm,xlsb,csv,numbers,ods' },
  { id: 'word', label: '文档', icon: 'file', ext: 'doc,docx,docm,rtf,odt,pages' },
  { id: 'ppt', label: '演示文稿', icon: 'slides', ext: 'ppt,pptx,pptm,pps,ppsx,key,odp' },
  { id: 'pdf', label: 'PDF', icon: 'file', ext: 'pdf' },
  { id: 'image', label: '图片', icon: 'image', ext: 'jpg,jpeg,png,gif,webp,bmp,heic,svg,tif,tiff,avif' },
  { id: 'video', label: '视频', icon: 'video', ext: 'mp4,mov,m4v,avi,mkv,flv,wmv,webm' },
  { id: 'audio', label: '音频', icon: 'audio', ext: 'mp3,wav,m4a,aac,flac,ogg,aiff' },
  { id: 'archive', label: '压缩文件', icon: 'archive', ext: 'zip,rar,7z,tar,gz,bz2,xz,tgz' }
]
