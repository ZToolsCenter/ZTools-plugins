// SPDX-License-Identifier: LGPL-3.0-only
// JavaScript adaptation of rany2/edge-tts 7.3.0 src/edge_tts/drm.py (rany, HarryXiaoCN).
// Modified for the research-English desktop plugin, 2026-10-24.
// Source: https://github.com/rany2/edge-tts/tree/7.3.0
// This replaceable CommonJS module is distributed in source form; see ENGLISH-LICENSES.txt.
const _SHA256_INITIAL=[1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
const _SHA256_STATE=[4255104674, 2435071207, 3192492180, 3442351626, 1811967817, 79508907, 4272990180, 66059218];
const _SHA256_SCHEDULE=[3945054110, 358115615, 2696978146, 217723578, 2787307148, 3520959633, 3235718560, 4192668342, 4039316851, 1884868174, 1904797190, 15051571, 3529027680, 1920361828];
const _SHA256_ROUND_CONSTANTS=[1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
const _CS64_COEFFICIENTS=[[3895366065, 3005677776], [1155409094, 2296378653], [1005282748, 693190712], [3365689651, 3005795295], [2367603217, 3557143765], [827258325, 652566332], [3911487921, 1618477510], [4037392853, 2192753147], [101076211, 4199654362], [3665427040, 545047652], [3201434976, 1010595059], [2314848760, 3536931681], [905590982, 3137643201], [3410617286, 3311559015]];
const rot=(x,n)=>(x>>>n)|(x<<(32-n));
const s0=x=>(rot(x,7)^rot(x,18)^(x>>>3))>>>0;
const s1=x=>(rot(x,17)^rot(x,19)^(x>>>10))>>>0;
function expand(w,start=16){for(let i=start;i<64;i++)w[i]=(s1(w[i-2])+w[i-7]+s0(w[i-15])+w[i-16])>>>0;}
function rounds(state,w,start=0){
 let [a,b,c,d,e,f,g,h]=state;
 for(let i=start;i<64;i++){
  const k=start===14&&i===14?0xc9dc06a7:_SHA256_ROUND_CONSTANTS[i];
  const t1=(h+((rot(e,6)^rot(e,11)^rot(e,25))>>>0)+((g^(e&(f^g)))>>>0)+k+w[i])>>>0;
  const t2=(((rot(a,2)^rot(a,13)^rot(a,22))>>>0)+(((a&b)|(c&(a|b)))>>>0))>>>0;
  [a,b,c,d,e,f,g,h]=[(t1+t2)>>>0,a,b,c,(d+t1)>>>0,e,f,g];
 }
 return [a,b,c,d,e,f,g,h];
}
function hash(data){
 const w=Array(14).fill(0);w.push(data.readUIntBE(0,3),data.readUInt32BE(3));
 for(let i=16;i<30;i++){
  let v=_SHA256_SCHEDULE[i-16];
  if(i-2>=14)v+=(s1(w[i-2])^(i===16?0x000b92c0:0))>>>0;
  if(i-7>=14)v+=w[i-7];
  if(i-15>=14)v+=(s0(w[i-15])^(i===29?0x059c0b80:0))>>>0;
  w.push(v>>>0);
 }
 w.push((s1(w[28])+w[23]+s0(w[15])+w[14]+0xc9dc06a7-_SHA256_ROUND_CONSTANTS[14])>>>0);expand(w,31);
 let state=rounds(_SHA256_STATE,w,14).map((x,i)=>(x+_SHA256_INITIAL[i])>>>0);
 const length=57+data.length,zeros=((55-length)%64+64)%64;
 const padded=Buffer.concat([data.subarray(7),Buffer.from([128]),Buffer.alloc(zeros+8)]);padded.writeBigUInt64BE(BigInt(length*8),padded.length-8);
 for(let off=0;off<padded.length;off+=64){const words=Array.from({length:16},(_,i)=>padded.readUInt32BE(off+i*4));expand(words);state=rounds(state,words).map((x,i)=>(x+state[i])>>>0);}
 const out=Buffer.alloc(32);state.forEach((x,i)=>out.writeUInt32BE(x,i*4));return out;
}
function checksum(data,digest){
 const keys=[(digest.readUInt32LE(0)|1)>>>0,(digest.readUInt32LE(4)|1)>>>0];
 const factors=keys.map(k=>Math.imul(k,0x82893933)>>>0);
 const terms=_CS64_COEFFICIENTS.map(([c],i)=>Math.imul(c,factors[i%2])>>>0),offsets=_CS64_COEFFICIENTS.map(x=>x[1]);
 const words=Buffer.alloc(Math.ceil((data.length+1)/8)*8);data.copy(words,1);
 const rol=x=>((x<<16)|(x>>>16))>>>0;
 for(let i=0;i<words.length/4;i++){
  const x=words.readUInt32LE(i*4);
  terms.push((Math.imul(x,keys[i%2])+(i===0?Math.imul(0xf2f90b1a,factors[0]):0))>>>0);
  offsets.push((Math.imul(rol(x),i%2?0xc31713db:0xef0569fb)+(i===0?0x0b1a0000:0))>>>0);
 }
 let swapAcc=0,swapLast=0,state=0,acc=0;
 for(let i=0;i<terms.length;i+=2){
  let q=Math.imul(rol((offsets[i]+terms[i])>>>0),0x76f50f34)>>>0;
  swapAcc=(swapAcc+Math.imul(rol(q),0xc3efea97)+q)>>>0;
  q=Math.imul(rol((offsets[i+1]+terms[i+1])>>>0),0x1881ce3c)>>>0;
  swapLast=(Math.imul(rol(q),0x35bd1ec9)+q)>>>0;swapAcc=(swapAcc+swapLast)>>>0;
  state=(Math.imul(state,keys[0])+terms[i])>>>0;
  for(const c of [0xcf98b111,0x87085b9f,0x12ceb96d,0x257e1d83])state=Math.imul(rol(state),c)>>>0;
  acc=(acc+state)>>>0;state=(Math.imul(state,keys[1])+terms[i+1])>>>0;
  for(const c of [0xa27416f5,0xd38396ff,0x7c932b89,0xbfa49f69])state=Math.imul(rol(state),c)>>>0;
  acc=(acc+state)>>>0;
 }
 const out=Buffer.alloc(8);out.writeUInt32LE((swapLast^state)>>>0,0);out.writeUInt32LE((swapAcc^acc)>>>0,4);return out;
}
module.exports=function token(clientToken,seconds=Date.now()/1000){
 let ticks=seconds+11644473600;ticks-=ticks%300;ticks*=1e7;
 const data=Buffer.from(ticks.toFixed(0)+clientToken,'ascii'),digest=hash(data);
 return (checksum(data,digest).toString('hex')+'-'+digest.toString('hex')).toUpperCase();
};
