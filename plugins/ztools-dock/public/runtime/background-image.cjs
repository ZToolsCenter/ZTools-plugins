'use strict';
const fs=require('node:fs'),path=require('node:path');
function normalizeBackground(filename) {
 const stat=fs.statSync(filename);
 if(!stat.isFile()||stat.size>5*1024*1024||!['.png','.jpg','.jpeg','.webp'].includes(path.extname(filename).toLowerCase()))throw new Error('请选择5MB以内的PNG、JPG或WebP图片');
 const {nativeImage}=require('electron');
 let image=nativeImage.createFromBuffer(fs.readFileSync(filename));
 if(image.isEmpty())throw new Error('背景图片无法解码');
 const size=image.getSize();
 if(size.width>8192||size.height>8192)throw new Error('图片尺寸不能超过8192px');
 const ratio=Math.min(1,1600/Math.max(size.width,size.height));
 if(ratio<1)image=image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio)),quality:'best'});
 const pixels=image.toBitmap();let visible=false;
 for(let i=3;i<pixels.length;i+=4)if(pixels[i]){visible=true;break;}
 if(!visible)throw new Error('背景图片完全透明，请选择可见图片');
 let png=image.toPNG();
 while(png.length>1024*1024){const s=image.getSize();if(Math.max(s.width,s.height)<256)throw new Error('背景图片过大，请选择更小的图片');image=image.resize({width:Math.max(1,Math.round(s.width*.75)),height:Math.max(1,Math.round(s.height*.75)),quality:'best'});png=image.toPNG();}
 return `data:image/png;base64,${png.toString('base64')}`;
}
function validateBackgroundImage(settings){
 if(!settings.backgroundImage)return;
 const image=require('electron').nativeImage.createFromDataURL(settings.backgroundImage);
 if(image.isEmpty())throw new Error('背景图片无法解码');
 const pixels=image.toBitmap();
 for(let i=3;i<pixels.length;i+=4)if(pixels[i])return;
 throw new Error('背景图片完全透明，请选择可见图片');
}
module.exports={normalizeBackground,validateBackgroundImage};
