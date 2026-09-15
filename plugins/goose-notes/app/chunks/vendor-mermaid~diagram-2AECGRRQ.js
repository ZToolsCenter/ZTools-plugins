import{r as e}from"./rolldown-runtime.js";import{t}from"./vendor-mermaid~wardleyDiagram-YWT4CUSO~pieDiagram-4H26LBE5~infoDiagram-5YYISTIA~gitGraphDia~dq5dflnn.js";import{g as n,h as r}from"./vendor-mermaid~mermaid.core~xychartDiagram-2RQKCTM6~wardleyDiagram-YWT4CUSO~vennDiagram-CII~i4ce8ps1.js";import{D as i,H as a,K as o,U as s,a as c,b as l,c as u,f as d,v as f,w as p,y as m}from"./vendor-mermaid~mermaid.core~xychartDiagram-2RQKCTM6~wardleyDiagram-YWT4CUSO~vennDiagram-CII~lndayhh4.js";import{i as h}from"./vendor-mermaid~mermaid.core~xychartDiagram-2RQKCTM6~wardleyDiagram-YWT4CUSO~vennDiagram-CII~kp9zuyku.js";import{t as g}from"./vendor-mermaid~mermaid.core~xychartDiagram-2RQKCTM6~wardleyDiagram-YWT4CUSO~vennDiagram-CII~lg03ah0v.js";import{t as _}from"./vendor-mermaid~wardleyDiagram-YWT4CUSO~pieDiagram-4H26LBE5~gitGraphDiagram-PVQCEYII~diagram~o4w9isvw.js";var v=e({diagram:()=>W}),y={showLegend:!0,ticks:5,max:null,min:0,graticule:`circle`},b={axes:[],curves:[],options:y},x=structuredClone(b),S=d.radar,C=r(()=>h({...S,...l().radar}),`getConfig`),w=r(()=>x.axes,`getAxes`),T=r(()=>x.curves,`getCurves`),E=r(()=>x.options,`getOptions`),D=r(e=>{x.axes=e.map(e=>({name:e.name,label:e.label??e.name}))},`setAxes`),O=r(e=>{x.curves=e.map(e=>({name:e.name,label:e.label??e.name,entries:k(e.entries)}))},`setCurves`),k=r(e=>{if(e[0].axis==null)return e.map(e=>e.value);let t=w();if(t.length===0)throw Error(`Axes must be populated before curves for reference entries`);return t.map(t=>{let n=e.find(e=>e.axis?.$refText===t.name);if(n===void 0)throw Error(`Missing entry for axis `+t.label);return n.value})},`computeCurveEntries`),A={getAxes:w,getCurves:T,getOptions:E,setAxes:D,setCurves:O,setOptions:r(e=>{let t=e.reduce((e,t)=>(e[t.name]=t,e),{});x.options={showLegend:t.showLegend?.value??y.showLegend,ticks:t.ticks?.value??y.ticks,max:t.max?.value??y.max,min:t.min?.value??y.min,graticule:t.graticule?.value??y.graticule}},`setOptions`),getConfig:C,clear:r(()=>{c(),x=structuredClone(b)},`clear`),setAccTitle:s,getAccTitle:m,setDiagramTitle:o,getDiagramTitle:p,getAccDescription:f,setAccDescription:a},j=r(e=>{_(e,A);let{axes:t,curves:n,options:r}=e;A.setAxes(t),A.setCurves(n),A.setOptions(r)},`populate`),M={parse:r(async e=>{let r=await t(`radar`,e);n.debug(r),j(r)},`parse`)},N=r((e,t,n,r)=>{let i=r.db,a=i.getAxes(),o=i.getCurves(),s=i.getOptions(),c=i.getConfig(),l=i.getDiagramTitle(),u=P(g(t),c),d=s.max??Math.max(...o.map(e=>Math.max(...e.entries))),f=s.min,p=Math.min(c.width,c.height)/2;F(u,a,p,s.ticks,s.graticule),I(u,a,p,c),L(u,a,o,f,d,s.graticule,c),B(u,o,s.showLegend,c),u.append(`text`).attr(`class`,`radarTitle`).text(l).attr(`x`,0).attr(`y`,-c.height/2-c.marginTop)},`draw`),P=r((e,t)=>{let n=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,i={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return u(e,r,n,t.useMaxWidth??!0),e.attr(`viewBox`,`0 0 ${n} ${r}`),e.append(`g`).attr(`transform`,`translate(${i.x}, ${i.y})`)},`drawFrame`),F=r((e,t,n,r,i)=>{if(i===`circle`)for(let t=0;t<r;t++){let i=n*(t+1)/r;e.append(`circle`).attr(`r`,i).attr(`class`,`radarGraticule`)}else if(i===`polygon`){let i=t.length;for(let a=0;a<r;a++){let o=n*(a+1)/r,s=t.map((e,t)=>{let n=2*t*Math.PI/i-Math.PI/2;return`${o*Math.cos(n)},${o*Math.sin(n)}`}).join(` `);e.append(`polygon`).attr(`points`,s).attr(`class`,`radarGraticule`)}}},`drawGraticule`),I=r((e,t,n,r)=>{let i=t.length;for(let a=0;a<i;a++){let o=t[a].label,s=2*a*Math.PI/i-Math.PI/2;e.append(`line`).attr(`x1`,0).attr(`y1`,0).attr(`x2`,n*r.axisScaleFactor*Math.cos(s)).attr(`y2`,n*r.axisScaleFactor*Math.sin(s)).attr(`class`,`radarAxisLine`),e.append(`text`).text(o).attr(`x`,n*r.axisLabelFactor*Math.cos(s)).attr(`y`,n*r.axisLabelFactor*Math.sin(s)).attr(`class`,`radarAxisLabel`)}},`drawAxes`);function L(e,t,n,r,i,a,o){let s=t.length,c=Math.min(o.width,o.height)/2;n.forEach((t,n)=>{if(t.entries.length!==s)return;let l=t.entries.map((e,t)=>{let n=2*Math.PI*t/s-Math.PI/2,a=R(e,r,i,c);return{x:a*Math.cos(n),y:a*Math.sin(n)}});a===`circle`?e.append(`path`).attr(`d`,z(l,o.curveTension)).attr(`class`,`radarCurve-${n}`):a===`polygon`&&e.append(`polygon`).attr(`points`,l.map(e=>`${e.x},${e.y}`).join(` `)).attr(`class`,`radarCurve-${n}`)})}r(L,`drawCurves`);function R(e,t,n,r){return r*(Math.min(Math.max(e,t),n)-t)/(n-t)}r(R,`relativeRadius`);function z(e,t){let n=e.length,r=`M${e[0].x},${e[0].y}`;for(let i=0;i<n;i++){let a=e[(i-1+n)%n],o=e[i],s=e[(i+1)%n],c=e[(i+2)%n],l={x:o.x+(s.x-a.x)*t,y:o.y+(s.y-a.y)*t},u={x:s.x-(c.x-o.x)*t,y:s.y-(c.y-o.y)*t};r+=` C${l.x},${l.y} ${u.x},${u.y} ${s.x},${s.y}`}return`${r} Z`}r(z,`closedRoundCurve`);function B(e,t,n,r){if(!n)return;let i=(r.width/2+r.marginRight)*3/4,a=-(r.height/2+r.marginTop)*3/4;t.forEach((t,n)=>{let r=e.append(`g`).attr(`transform`,`translate(${i}, ${a+n*20})`);r.append(`rect`).attr(`width`,12).attr(`height`,12).attr(`class`,`radarLegendBox-${n}`),r.append(`text`).attr(`x`,16).attr(`y`,0).attr(`class`,`radarLegendText`).text(t.label)})}r(B,`drawLegend`);var V={draw:N},H=r((e,t)=>{let n=``;for(let r=0;r<e.THEME_COLOR_LIMIT;r++){let i=e[`cScale${r}`];n+=`
		.radarCurve-${r} {
			color: ${i};
			fill: ${i};
			fill-opacity: ${t.curveOpacity};
			stroke: ${i};
			stroke-width: ${t.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${i};
			fill-opacity: ${t.curveOpacity};
			stroke: ${i};
		}
		`}return n},`genIndexStyles`),U=r(e=>{let t=h(i(),l().themeVariables);return{themeVariables:t,radarOptions:h(t.radar,e)}},`buildRadarStyleOptions`),W={parser:M,db:A,renderer:V,styles:r(({radar:e}={})=>{let{themeVariables:t,radarOptions:n}=U(e);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${n.axisColor};
		stroke-width: ${n.axisStrokeWidth};
	}
	.radarAxisLabel {
		dominant-baseline: middle;
		text-anchor: middle;
		font-size: ${n.axisLabelFontSize}px;
		color: ${n.axisColor};
	}
	.radarGraticule {
		fill: ${n.graticuleColor};
		fill-opacity: ${n.graticuleOpacity};
		stroke: ${n.graticuleColor};
		stroke-width: ${n.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${n.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${H(t,n)}
	`},`styles`)};export{v as t};