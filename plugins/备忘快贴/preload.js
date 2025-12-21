window.ztools.onDbPull=function(data){
    console.log("onDbPull",data);
}
window.ztools.stopFindInPage=function(){
    console.log("stopFindInPage");
}
window.ztools.findInPage=function(){
    console.log("startFindInPage");
}
window.ztools.onMainPush=function(data){
    console.log("onMainPush",data);
}
console.log("preload.js");
const crypto=require("crypto"),fs=require("fs"),path=require("path"),{pathToFileURL,fileURLToPath}=require("url");window.IS_APP_VERSION4="function"==typeof window.ztools.getAppName,window.services={md5Format:e=>crypto.createHash("md5").update(e).digest("hex"),pathToFileURL:e=>pathToFileURL(e).href,getImageData:e=>{if(e.startsWith("file:")){const t=fileURLToPath(e);if(!fs.existsSync(t))throw new Error("图片文件不存在");const r=path.extname(t).toLowerCase();if(![".png",".jpg",".jpeg"].includes(r))throw new Error("只支持 png、jpg 图片文件");const o=fs.readFileSync(t);if(o.byteLength>10485760)throw new Error("图片大小超过 10 M");return{digest:crypto.createHash("md5").update(o).digest("hex"),data:o,contentType:"image/"+r.replace(".","")}}if(/^data:(image\/(?:png|jpg|jpeg));base64,(.+)$/.test(e)){const e=RegExp.$1,t=Buffer.from(RegExp.$2,"base64");if(t.byteLength>10485760)throw new Error("图片大小超过 10 M");return{digest:crypto.createHash("md5").update(t).digest("hex"),data:t,contentType:e}}throw new Error("图片错误")},saveImgToFileByArrayBuffer:(e,t)=>{const r=Buffer.from(e),o=crypto.createHash("md5").update(r).digest("hex"),a=path.join(window.ztools.getPath("temp"),"ztools.collection"),i=path.join(a,o)+t.replace("image/",".").toLowerCase();if(fs.existsSync(i))return i;fs.existsSync(a)||fs.mkdirSync(a);try{fs.writeFileSync(i,r)}catch(e){return null}return i}};