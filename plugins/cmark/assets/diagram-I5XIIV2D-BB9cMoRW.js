import{p as T}from"./chunk-JWPE2WC7-BXnjDdh1.js";import{_ as f,N as y,Q as z,d as E,l as B,b as F,a as P,q as A,t as W,g as _,s as N,L,O as M,z as O}from"./mermaid-C_q9pug0.js";import{p as Y}from"./cynefin-EF2NZ3EQ-DypLIJxl.js";import"./markdown-DVehI1Sg.js";var I=M.packet,$=class{constructor(){this.packet=[],this.setAccTitle=F,this.getAccTitle=P,this.setDiagramTitle=A,this.getDiagramTitle=W,this.getAccDescription=_,this.setAccDescription=N}static{f(this,"PacketDB")}getConfig(){const t=y({...I,...L().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){O(),this.packet=[]}},j=1e4,q=f((t,e)=>{T(t,e);let r=-1,s=[],i=1;const{bitsPerRow:l}=e.getConfig();for(let{start:a,end:o,bits:d,label:g}of t.blocks){if(a!==void 0&&o!==void 0&&o<a)throw new Error(`Packet block ${a} - ${o} is invalid. End must be greater than start.`);if(a??=r+1,a!==r+1)throw new Error(`Packet block ${a} - ${o??a} is not contiguous. It should start from ${r+1}.`);if(d===0)throw new Error(`Packet block ${a} is invalid. Cannot have a zero bit field.`);for(o??=a+(d??1)-1,d??=o-a+1,r=o,B.debug(`Packet block ${a} - ${r} with label ${g}`);s.length<=l+1&&e.getPacket().length<j;){const[c,p]=G({start:a,end:o,bits:d,label:g},i,l);if(s.push(c),c.end+1===i*l&&(e.pushWord(s),s=[],i++),!p)break;({start:a,end:o,bits:d,label:g}=p)}}e.pushWord(s)},"populate"),G=f((t,e,r)=>{if(t.start===void 0)throw new Error("start should have been set during first phase");if(t.end===void 0)throw new Error("end should have been set during first phase");if(t.start>t.end)throw new Error(`Block start ${t.start} is greater than block end ${t.end}.`);if(t.end+1<=e*r)return[t,void 0];const s=e*r-1,i=e*r;return[{start:t.start,end:s,label:t.label,bits:s-t.start},{start:i,end:t.end,label:t.label,bits:t.end-i}]},"getNextFittingBlock"),C={parser:{yy:void 0},parse:f(async t=>{const e=await Y("packet",t),r=C.parser?.yy;if(!(r instanceof $))throw new Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");B.debug(e),q(e,r)},"parse")},H=f((t,e,r,s)=>{const i=s.db,l=i.getConfig(),{rowHeight:a,paddingY:o,bitWidth:d,bitsPerRow:g}=l,c=i.getPacket(),p=i.getDiagramTitle(),b=a+o,n=b*(c.length+1)-(p?0:a),h=d*g+2,k=z(e);k.attr("viewBox",`0 0 ${h} ${n}`),E(k,n,h,l.useMaxWidth);for(const[v,u]of c.entries())K(k,u,v,l);k.append("text").text(p).attr("x",h/2).attr("y",n-b/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),K=f((t,e,r,{rowHeight:s,paddingX:i,paddingY:l,bitWidth:a,bitsPerRow:o,showBits:d,bitOrder:g})=>{const c=t.append("g"),p=r*(s+l)+l,b=g==="descending";for(const n of e){const h=n.end-n.start+1,k=n.start%o,u=(b?o-k-h:k)*a+1,m=h*a-i;if(c.append("rect").attr("x",u).attr("y",p).attr("width",m).attr("height",s).attr("class","packetBlock"),c.append("text").attr("x",u+m/2).attr("y",p+s/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(n.label),!d)continue;const[S,D]=b?[n.end,n.start]:[n.start,n.end],w=h===1,x=p-2;c.append("text").attr("x",u+(w?m/2:0)).attr("y",x).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",w?"middle":"start").text(S),w||c.append("text").attr("x",u+m).attr("y",x).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(D)}},"drawWord"),Q={draw:H},U={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},X=f(({packet:t}={})=>{const e=y(U,t);return`
	.packetByte {
		font-size: ${e.byteFontSize};
	}
	.packetByte.start {
		fill: ${e.startByteColor};
	}
	.packetByte.end {
		fill: ${e.endByteColor};
	}
	.packetLabel {
		fill: ${e.labelColor};
		font-size: ${e.labelFontSize};
	}
	.packetTitle {
		fill: ${e.titleColor};
		font-size: ${e.titleFontSize};
	}
	.packetBlock {
		stroke: ${e.blockStrokeColor};
		stroke-width: ${e.blockStrokeWidth};
		fill: ${e.blockFillColor};
	}
	`},"styles"),tt={parser:C,get db(){return new $},renderer:Q,styles:X};export{tt as diagram};
