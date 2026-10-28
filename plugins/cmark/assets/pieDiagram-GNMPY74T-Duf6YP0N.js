import{p as tt}from"./chunk-JWPE2WC7-BXnjDdh1.js";import{g as et,s as at,a as rt,b as it,t as nt,q as st,_ as l,l as E,c as ot,N as lt,Q as ct,R as dt,S as I,T as gt,d as ht,z as pt,U as ut,O as ft}from"./mermaid-C_q9pug0.js";import{p as mt}from"./cynefin-EF2NZ3EQ-DypLIJxl.js";import"./markdown-DVehI1Sg.js";var vt=ft.pie,R={sections:new Map,showData:!1},T=R.sections,L=R.showData,St=structuredClone(vt),xt=l(()=>structuredClone(St),"getConfig"),wt=l(()=>{T=new Map,L=R.showData,pt()},"clear"),Ct=l(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);T.has(t)||(T.set(t,a),E.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),$t=l(()=>T,"getSections"),Dt=l(t=>{L=t},"setShowData"),yt=l(()=>L,"getShowData"),U={getConfig:xt,clear:wt,setDiagramTitle:st,getDiagramTitle:nt,setAccTitle:it,getAccTitle:rt,setAccDescription:at,getAccDescription:et,addSection:Ct,getSections:$t,setShowData:Dt,getShowData:yt},Tt=l((t,a)=>{tt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),bt={parse:l(async t=>{const a=await mt("pie",t);E.debug(a),Tt(a,U)},"parse")},At=l(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),_t=At,kt=l(t=>{const a=[...t.values()].reduce((s,m)=>s+m,0),O=[...t.entries()].map(([s,m])=>({label:s,value:m})).filter(s=>s.value/a*100>=1);return ut().value(s=>s.value).sort(null)(O)},"createPieArcs"),zt=l((t,a,O,W)=>{E.debug(`rendering pie chart
`+t);const s=W.db,m=ot(),p=lt(s.getConfig(),m.pie),F=40,i=18,c=4,C=450,S=C,b=ct(a),$=b.append("g");$.attr("transform","translate("+S/2+","+C/2+")");const{themeVariables:n}=m;let[H]=dt(n.pieOuterStrokeWidth);H??=2;const q=p.legendPosition,M=p.textPosition,Q=p.donutHole>0&&p.donutHole<=.9?p.donutHole:0,u=Math.min(S,C)/2-F,V=I().innerRadius(Q*u).outerRadius(u),X=I().innerRadius(u*M).outerRadius(u*M),x=$.append("g");x.append("circle").attr("cx",0).attr("cy",0).attr("r",u+H/2).attr("class","pieOuterCircle");const D=s.getSections(),Z=kt(D),j=[n.pie1,n.pie2,n.pie3,n.pie4,n.pie5,n.pie6,n.pie7,n.pie8,n.pie9,n.pie10,n.pie11,n.pie12];let A=0;D.forEach(e=>{A+=e});const P=Z.filter(e=>(e.data.value/A*100).toFixed(0)!=="0"),_=gt(j).domain([...D.keys()]);x.selectAll("mySlices").data(P).enter().append("path").attr("d",V).attr("fill",e=>_(e.data.label)).attr("class",e=>{let r="pieCircle";return p.highlightSlice==="hover"?r+=" highlightedOnHover":p.highlightSlice===e.data.label&&(r+=" highlighted"),r}),x.selectAll("mySlices").data(P).enter().append("text").text(e=>(e.data.value/A*100).toFixed(0)+"%").attr("transform",e=>"translate("+X.centroid(e)+")").style("text-anchor","middle").attr("class","slice");const J=$.append("text").text(s.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),w=[...D.entries()].map(([e,r])=>({label:e,value:r})),f=$.selectAll(".legend").data(w).enter().append("g").attr("class","legend");f.append("rect").attr("width",i).attr("height",i).style("fill",e=>_(e.label)).style("stroke",e=>_(e.label)),f.append("text").attr("x",i+c).attr("y",i-c).text(e=>s.getShowData()?`${e.label} [${e.value}]`:e.label);const v=Math.max(...f.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0));let y=C,k=S+F;const o=i+c,z=w.length*o;switch(q){case"center":f.attr("transform",(e,r)=>{const d=o*w.length/2,g=-v/2-(i+c),h=r*o-d;return"translate("+g+","+h+")"});break;case"top":y+=z,f.attr("transform",(e,r)=>{const d=u,g=-v/2-(i+c),h=r*o-d;return`translate(${g}, ${h})`}),x.attr("transform",()=>`translate(0, ${z+o})`);break;case"bottom":y+=z,f.attr("transform",(e,r)=>{const d=-u-o,g=-v/2-(i+c),h=r*o-d;return"translate("+g+","+h+")"});break;case"left":k+=i+c+v,f.attr("transform",(e,r)=>{const d=o*w.length/2,g=-u-(i+c),h=r*o-d;return"translate("+g+","+h+")"}),x.attr("transform",()=>`translate(${v+i+c}, 0)`);break;case"right":default:k+=i+c+v,f.attr("transform",(e,r)=>{const d=o*w.length/2,g=12*i,h=r*o-d;return"translate("+g+","+h+")"});break}const G=J.node()?.getBoundingClientRect().width??0,K=S/2-G/2,Y=S/2+G/2,N=Math.min(0,K),B=Math.max(k,Y)-N;b.attr("viewBox",`${N} 0 ${B} ${y}`),ht(b,y,B,p.useMaxWidth)},"draw"),Et={draw:zt},Ht={parser:bt,db:U,renderer:Et,styles:_t};export{Ht as diagram};
