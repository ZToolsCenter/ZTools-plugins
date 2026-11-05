import{aL as Mt,g as ye,s as ge,t as ve,q as pe,a as xe,b as Te,_ as l,c as dt,k as pt,aR as be,aS as we,aT as _e,d as De,V as Se,aU as Ce,aV as j,l as rt,aW as Me,aX as Gt,aY as Ut,aZ as Ee,a_ as Ie,a$ as $e,b0 as Ye,b1 as Ae,b2 as Le,b3 as Fe,b4 as Xt,b5 as jt,b6 as Zt,b7 as Qt,b8 as Kt,b9 as Oe,m as We,$ as Pe,z as Ve,u as Re}from"./mermaid-C_q9pug0.js";import"./markdown-DVehI1Sg.js";var xt={exports:{}},ze=xt.exports,Jt;function Ne(){return Jt||(Jt=1,(function(t,r){(function(i,e){t.exports=e()})(ze,(function(){var i="day";return function(e,a,g){var v=function(F){return F.add(4-F.isoWeekday(),i)},b=a.prototype;b.isoWeekYear=function(){return v(this).year()},b.isoWeek=function(F){if(!this.$utils().u(F))return this.add(7*(F-this.isoWeek()),i);var w,O,Y,H,z=v(this),R=(w=this.isoWeekYear(),O=this.$u,Y=(O?g.utc:g)().year(w).startOf("year"),H=4-Y.isoWeekday(),Y.isoWeekday()>4&&(H+=7),Y.add(H,i));return z.diff(R,"week")+1},b.isoWeekday=function(F){return this.$utils().u(F)?this.day()||7:this.day(this.day()%7?F:F-7)};var A=b.startOf;b.startOf=function(F,w){var O=this.$utils(),Y=!!O.u(w)||w;return O.p(F)==="isoweek"?Y?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):A.bind(this)(F,w)}}}))})(xt)),xt.exports}var He=Ne();const Be=Mt(He);var Tt={exports:{}},qe=Tt.exports,te;function Ge(){return te||(te=1,(function(t,r){(function(i,e){t.exports=e()})(qe,(function(){var i={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},e=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,a=/\d/,g=/\d\d/,v=/\d\d?/,b=/\d*[^-_:/,()\s\d]+/,A={},F=function(k){return(k=+k)+(k>68?1900:2e3)},w=function(k){return function(E){this[k]=+E}},O=[/[+-]\d\d:?(\d\d)?|Z/,function(k){(this.zone||(this.zone={})).offset=(function(E){if(!E||E==="Z")return 0;var W=E.match(/([+-]|\d\d)/g),L=60*W[1]+(+W[2]||0);return L===0?0:W[0]==="+"?-L:L})(k)}],Y=function(k){var E=A[k];return E&&(E.indexOf?E:E.s.concat(E.f))},H=function(k,E){var W,L=A.meridiem;if(L){for(var X=1;X<=24;X+=1)if(k.indexOf(L(X,0,E))>-1){W=X>12;break}}else W=k===(E?"pm":"PM");return W},z={A:[b,function(k){this.afternoon=H(k,!1)}],a:[b,function(k){this.afternoon=H(k,!0)}],Q:[a,function(k){this.month=3*(k-1)+1}],S:[a,function(k){this.milliseconds=100*+k}],SS:[g,function(k){this.milliseconds=10*+k}],SSS:[/\d{3}/,function(k){this.milliseconds=+k}],s:[v,w("seconds")],ss:[v,w("seconds")],m:[v,w("minutes")],mm:[v,w("minutes")],H:[v,w("hours")],h:[v,w("hours")],HH:[v,w("hours")],hh:[v,w("hours")],D:[v,w("day")],DD:[g,w("day")],Do:[b,function(k){var E=A.ordinal,W=k.match(/\d+/);if(this.day=W[0],E)for(var L=1;L<=31;L+=1)E(L).replace(/\[|\]/g,"")===k&&(this.day=L)}],w:[v,w("week")],ww:[g,w("week")],M:[v,w("month")],MM:[g,w("month")],MMM:[b,function(k){var E=Y("months"),W=(Y("monthsShort")||E.map((function(L){return L.slice(0,3)}))).indexOf(k)+1;if(W<1)throw new Error;this.month=W%12||W}],MMMM:[b,function(k){var E=Y("months").indexOf(k)+1;if(E<1)throw new Error;this.month=E%12||E}],Y:[/[+-]?\d+/,w("year")],YY:[g,function(k){this.year=F(k)}],YYYY:[/\d{4}/,w("year")],Z:O,ZZ:O};function R(k){var E,W;E=k,W=A&&A.formats;for(var L=(k=E.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(m,x,p){var y=p&&p.toUpperCase();return x||W[p]||i[p]||W[y].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(n,d,f){return d||f.slice(1)}))}))).match(e),X=L.length,q=0;q<X;q+=1){var $=L[q],T=z[$],h=T&&T[0],I=T&&T[1];L[q]=I?{regex:h,parser:I}:$.replace(/^\[|\]$/g,"")}return function(m){for(var x={},p=0,y=0;p<X;p+=1){var n=L[p];if(typeof n=="string")y+=n.length;else{var d=n.regex,f=n.parser,u=m.slice(y),_=d.exec(u)[0];f.call(x,_),m=m.replace(_,"")}}return(function(s){var D=s.afternoon;if(D!==void 0){var o=s.hours;D?o<12&&(s.hours+=12):o===12&&(s.hours=0),delete s.afternoon}})(x),x}}return function(k,E,W){W.p.customParseFormat=!0,k&&k.parseTwoDigitYear&&(F=k.parseTwoDigitYear);var L=E.prototype,X=L.parse;L.parse=function(q){var $=q.date,T=q.utc,h=q.args;this.$u=T;var I=h[1];if(typeof I=="string"){var m=h[2]===!0,x=h[3]===!0,p=m||x,y=h[2];x&&(y=h[2]),A=this.$locale(),!m&&y&&(A=W.Ls[y]),this.$d=(function(u,_,s,D){try{if(["x","X"].indexOf(_)>-1)return new Date((_==="X"?1e3:1)*u);var o=R(_)(u),B=o.year,c=o.month,S=o.day,C=o.hours,V=o.minutes,M=o.seconds,N=o.milliseconds,P=o.zone,it=o.week,at=new Date,yt=S||(B||c?1:at.getDate()),lt=B||at.getFullYear(),G=0;B&&!c||(G=c>0?c-1:at.getMonth());var K,Z=C||0,ot=V||0,J=M||0,nt=N||0;return P?new Date(Date.UTC(lt,G,yt,Z,ot,J,nt+60*P.offset*1e3)):s?new Date(Date.UTC(lt,G,yt,Z,ot,J,nt)):(K=new Date(lt,G,yt,Z,ot,J,nt),it&&(K=D(K).week(it).toDate()),K)}catch{return new Date("")}})($,I,T,W),this.init(),y&&y!==!0&&(this.$L=this.locale(y).$L),p&&$!=this.format(I)&&(this.$d=new Date("")),A={}}else if(I instanceof Array)for(var n=I.length,d=1;d<=n;d+=1){h[1]=I[d-1];var f=W.apply(this,h);if(f.isValid()){this.$d=f.$d,this.$L=f.$L,this.init();break}d===n&&(this.$d=new Date(""))}else X.call(this,q)}}}))})(Tt)),Tt.exports}var Ue=Ge();const Xe=Mt(Ue);var bt={exports:{}},je=bt.exports,ee;function Ze(){return ee||(ee=1,(function(t,r){(function(i,e){t.exports=e()})(je,(function(){return function(i,e){var a=e.prototype,g=a.format;a.format=function(v){var b=this,A=this.$locale();if(!this.isValid())return g.bind(this)(v);var F=this.$utils(),w=(v||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(O){switch(O){case"Q":return Math.ceil((b.$M+1)/3);case"Do":return A.ordinal(b.$D);case"gggg":return b.weekYear();case"GGGG":return b.isoWeekYear();case"wo":return A.ordinal(b.week(),"W");case"w":case"ww":return F.s(b.week(),O==="w"?1:2,"0");case"W":case"WW":return F.s(b.isoWeek(),O==="W"?1:2,"0");case"k":case"kk":return F.s(String(b.$H===0?24:b.$H),O==="k"?1:2,"0");case"X":return Math.floor(b.$d.getTime()/1e3);case"x":return b.$d.getTime();case"z":return"["+b.offsetName()+"]";case"zzz":return"["+b.offsetName("long")+"]";default:return O}}));return g.bind(this)(w)}}}))})(bt)),bt.exports}var Qe=Ze();const Ke=Mt(Qe);var wt={exports:{}},Je=wt.exports,se;function ts(){return se||(se=1,(function(t,r){(function(i,e){t.exports=e()})(Je,(function(){var i,e,a=1e3,g=6e4,v=36e5,b=864e5,A=31536e6,F=2628e6,w=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,O=/\[([^\]]+)]|YYYY|YY|Y|M{1,2}|D{1,2}|H{1,2}|m{1,2}|s{1,2}|SSS/g,Y={years:A,months:F,days:b,hours:v,minutes:g,seconds:a,milliseconds:1,weeks:6048e5},H=function($){return $ instanceof X},z=function($,T,h){return new X($,h,T.$l)},R=function($){return e.p($)+"s"},k=function($){return $<0},E=function($){return k($)?Math.ceil($):Math.floor($)},W=function($){return Math.abs($)},L=function($,T){return $?k($)?{negative:!0,format:""+W($)+T}:{negative:!1,format:""+$+T}:{negative:!1,format:""}},X=(function(){function $(h,I,m){var x=this;if(this.$d={},this.$l=m,h===void 0&&(this.$ms=0,this.parseFromMilliseconds()),I)return z(h*Y[R(I)],this);if(typeof h=="number")return this.$ms=h,this.parseFromMilliseconds(),this;if(typeof h=="object")return Object.keys(h).forEach((function(n){x.$d[R(n)]=h[n]})),this.calMilliseconds(),this;if(typeof h=="string"){var p=h.match(w);if(p){var y=p.slice(2).map((function(n){return n!=null?Number(n):0}));return this.$d.years=y[0],this.$d.months=y[1],this.$d.weeks=y[2],this.$d.days=y[3],this.$d.hours=y[4],this.$d.minutes=y[5],this.$d.seconds=y[6],this.calMilliseconds(),this}}return this}var T=$.prototype;return T.calMilliseconds=function(){var h=this;this.$ms=Object.keys(this.$d).reduce((function(I,m){return I+(h.$d[m]||0)*Y[m]}),0)},T.parseFromMilliseconds=function(){var h=this.$ms;this.$d.years=E(h/A),h%=A,this.$d.months=E(h/F),h%=F,this.$d.days=E(h/b),h%=b,this.$d.hours=E(h/v),h%=v,this.$d.minutes=E(h/g),h%=g,this.$d.seconds=E(h/a),h%=a,this.$d.milliseconds=h},T.toISOString=function(){var h=L(this.$d.years,"Y"),I=L(this.$d.months,"M"),m=+this.$d.days||0;this.$d.weeks&&(m+=7*this.$d.weeks);var x=L(m,"D"),p=L(this.$d.hours,"H"),y=L(this.$d.minutes,"M"),n=this.$d.seconds||0;this.$d.milliseconds&&(n+=this.$d.milliseconds/1e3,n=Math.round(1e3*n)/1e3);var d=L(n,"S"),f=h.negative||I.negative||x.negative||p.negative||y.negative||d.negative,u=p.format||y.format||d.format?"T":"",_=(f?"-":"")+"P"+h.format+I.format+x.format+u+p.format+y.format+d.format;return _==="P"||_==="-P"?"P0D":_},T.toJSON=function(){return this.toISOString()},T.format=function(h){var I=h||"YYYY-MM-DDTHH:mm:ss",m={Y:this.$d.years,YY:e.s(this.$d.years,2,"0"),YYYY:e.s(this.$d.years,4,"0"),M:this.$d.months,MM:e.s(this.$d.months,2,"0"),D:this.$d.days,DD:e.s(this.$d.days,2,"0"),H:this.$d.hours,HH:e.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:e.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:e.s(this.$d.seconds,2,"0"),SSS:e.s(this.$d.milliseconds,3,"0")};return I.replace(O,(function(x,p){return p||String(m[x])}))},T.as=function(h){return this.$ms/Y[R(h)]},T.get=function(h){var I=this.$ms,m=R(h);return m==="milliseconds"?I%=1e3:I=m==="weeks"?E(I/Y[m]):this.$d[m],I||0},T.add=function(h,I,m){var x;return x=I?h*Y[R(I)]:H(h)?h.$ms:z(h,this).$ms,z(this.$ms+x*(m?-1:1),this)},T.subtract=function(h,I){return this.add(h,I,!0)},T.locale=function(h){var I=this.clone();return I.$l=h,I},T.clone=function(){return z(this.$ms,this)},T.humanize=function(h){return i().add(this.$ms,"ms").locale(this.$l).fromNow(!h)},T.valueOf=function(){return this.asMilliseconds()},T.milliseconds=function(){return this.get("milliseconds")},T.asMilliseconds=function(){return this.as("milliseconds")},T.seconds=function(){return this.get("seconds")},T.asSeconds=function(){return this.as("seconds")},T.minutes=function(){return this.get("minutes")},T.asMinutes=function(){return this.as("minutes")},T.hours=function(){return this.get("hours")},T.asHours=function(){return this.as("hours")},T.days=function(){return this.get("days")},T.asDays=function(){return this.as("days")},T.weeks=function(){return this.get("weeks")},T.asWeeks=function(){return this.as("weeks")},T.months=function(){return this.get("months")},T.asMonths=function(){return this.as("months")},T.years=function(){return this.get("years")},T.asYears=function(){return this.as("years")},$})(),q=function($,T,h){return $.add(T.years()*h,"y").add(T.months()*h,"M").add(T.days()*h,"d").add(T.hours()*h,"h").add(T.minutes()*h,"m").add(T.seconds()*h,"s").add(T.milliseconds()*h,"ms")};return function($,T,h){i=h,e=h().$utils(),h.duration=function(x,p){var y=h.locale();return z(x,{$l:y},p)},h.isDuration=H;var I=T.prototype.add,m=T.prototype.subtract;T.prototype.add=function(x,p){return H(x)?q(this,x,1):I.bind(this)(x,p)},T.prototype.subtract=function(x,p){return H(x)?q(this,x,-1):m.bind(this)(x,p)}}}))})(wt)),wt.exports}var es=ts();const ss=Mt(es);var $t=(function(){var t=l(function(y,n,d,f){for(d=d||{},f=y.length;f--;d[y[f]]=n);return d},"o"),r=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],i=[1,26],e=[1,27],a=[1,28],g=[1,29],v=[1,30],b=[1,31],A=[1,32],F=[1,33],w=[1,34],O=[1,9],Y=[1,10],H=[1,11],z=[1,12],R=[1,13],k=[1,14],E=[1,15],W=[1,16],L=[1,19],X=[1,20],q=[1,21],$=[1,22],T=[1,23],h=[1,25],I=[1,35],m={trace:l(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:l(function(n,d,f,u,_,s,D){var o=s.length-1;switch(_){case 1:return s[o-1];case 2:this.$=[];break;case 3:s[o-1].push(s[o]),this.$=s[o-1];break;case 4:case 5:this.$=s[o];break;case 6:case 7:this.$=[];break;case 8:u.setWeekday("monday");break;case 9:u.setWeekday("tuesday");break;case 10:u.setWeekday("wednesday");break;case 11:u.setWeekday("thursday");break;case 12:u.setWeekday("friday");break;case 13:u.setWeekday("saturday");break;case 14:u.setWeekday("sunday");break;case 15:u.setWeekend("friday");break;case 16:u.setWeekend("saturday");break;case 17:u.setDateFormat(s[o].substr(11)),this.$=s[o].substr(11);break;case 18:u.enableInclusiveEndDates(),this.$=s[o].substr(18);break;case 19:u.TopAxis(),this.$=s[o].substr(8);break;case 20:u.setAxisFormat(s[o].substr(11)),this.$=s[o].substr(11);break;case 21:u.setTickInterval(s[o].substr(13)),this.$=s[o].substr(13);break;case 22:u.setExcludes(s[o].substr(9)),this.$=s[o].substr(9);break;case 23:u.setIncludes(s[o].substr(9)),this.$=s[o].substr(9);break;case 24:u.setTodayMarker(s[o].substr(12)),this.$=s[o].substr(12);break;case 27:u.setDiagramTitle(s[o].substr(6)),this.$=s[o].substr(6);break;case 28:this.$=s[o].trim(),u.setAccTitle(this.$);break;case 29:case 30:this.$=s[o].trim(),u.setAccDescription(this.$);break;case 31:u.addSection(s[o].substr(8)),this.$=s[o].substr(8);break;case 33:u.addTask(s[o-1],s[o]),this.$="task";break;case 34:this.$=s[o-1],u.setClickEvent(s[o-1],s[o],null);break;case 35:this.$=s[o-2],u.setClickEvent(s[o-2],s[o-1],s[o]);break;case 36:this.$=s[o-2],u.setClickEvent(s[o-2],s[o-1],null),u.setLink(s[o-2],s[o]);break;case 37:this.$=s[o-3],u.setClickEvent(s[o-3],s[o-2],s[o-1]),u.setLink(s[o-3],s[o]);break;case 38:this.$=s[o-2],u.setClickEvent(s[o-2],s[o],null),u.setLink(s[o-2],s[o-1]);break;case 39:this.$=s[o-3],u.setClickEvent(s[o-3],s[o-1],s[o]),u.setLink(s[o-3],s[o-2]);break;case 40:this.$=s[o-1],u.setLink(s[o-1],s[o]);break;case 41:case 47:this.$=s[o-1]+" "+s[o];break;case 42:case 43:case 45:this.$=s[o-2]+" "+s[o-1]+" "+s[o];break;case 44:case 46:this.$=s[o-3]+" "+s[o-2]+" "+s[o-1]+" "+s[o];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(r,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:i,13:e,14:a,15:g,16:v,17:b,18:A,19:18,20:F,21:w,22:O,23:Y,24:H,25:z,26:R,27:k,28:E,29:W,30:L,31:X,33:q,35:$,36:T,37:24,38:h,40:I},t(r,[2,7],{1:[2,1]}),t(r,[2,3]),{9:36,11:17,12:i,13:e,14:a,15:g,16:v,17:b,18:A,19:18,20:F,21:w,22:O,23:Y,24:H,25:z,26:R,27:k,28:E,29:W,30:L,31:X,33:q,35:$,36:T,37:24,38:h,40:I},t(r,[2,5]),t(r,[2,6]),t(r,[2,17]),t(r,[2,18]),t(r,[2,19]),t(r,[2,20]),t(r,[2,21]),t(r,[2,22]),t(r,[2,23]),t(r,[2,24]),t(r,[2,25]),t(r,[2,26]),t(r,[2,27]),{32:[1,37]},{34:[1,38]},t(r,[2,30]),t(r,[2,31]),t(r,[2,32]),{39:[1,39]},t(r,[2,8]),t(r,[2,9]),t(r,[2,10]),t(r,[2,11]),t(r,[2,12]),t(r,[2,13]),t(r,[2,14]),t(r,[2,15]),t(r,[2,16]),{41:[1,40],43:[1,41]},t(r,[2,4]),t(r,[2,28]),t(r,[2,29]),t(r,[2,33]),t(r,[2,34],{42:[1,42],43:[1,43]}),t(r,[2,40],{41:[1,44]}),t(r,[2,35],{43:[1,45]}),t(r,[2,36]),t(r,[2,38],{42:[1,46]}),t(r,[2,37]),t(r,[2,39])],defaultActions:{},parseError:l(function(n,d){if(d.recoverable)this.trace(n);else{var f=new Error(n);throw f.hash=d,f}},"parseError"),parse:l(function(n){var d=this,f=[0],u=[],_=[null],s=[],D=this.table,o="",B=0,c=0,S=2,C=1,V=s.slice.call(arguments,1),M=Object.create(this.lexer),N={yy:{}};for(var P in this.yy)Object.prototype.hasOwnProperty.call(this.yy,P)&&(N.yy[P]=this.yy[P]);M.setInput(n,N.yy),N.yy.lexer=M,N.yy.parser=this,typeof M.yylloc>"u"&&(M.yylloc={});var it=M.yylloc;s.push(it);var at=M.options&&M.options.ranges;typeof N.yy.parseError=="function"?this.parseError=N.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function yt(Q){f.length=f.length-2*Q,_.length=_.length-Q,s.length=s.length-Q}l(yt,"popStack");function lt(){var Q;return Q=u.pop()||M.lex()||C,typeof Q!="number"&&(Q instanceof Array&&(u=Q,Q=u.pop()),Q=d.symbols_[Q]||Q),Q}l(lt,"lex");for(var G,K,Z,ot,J={},nt,tt,qt,vt;;){if(K=f[f.length-1],this.defaultActions[K]?Z=this.defaultActions[K]:((G===null||typeof G>"u")&&(G=lt()),Z=D[K]&&D[K][G]),typeof Z>"u"||!Z.length||!Z[0]){var Et="";vt=[];for(nt in D[K])this.terminals_[nt]&&nt>S&&vt.push("'"+this.terminals_[nt]+"'");M.showPosition?Et="Parse error on line "+(B+1)+`:
`+M.showPosition()+`
Expecting `+vt.join(", ")+", got '"+(this.terminals_[G]||G)+"'":Et="Parse error on line "+(B+1)+": Unexpected "+(G==C?"end of input":"'"+(this.terminals_[G]||G)+"'"),this.parseError(Et,{text:M.match,token:this.terminals_[G]||G,line:M.yylineno,loc:it,expected:vt})}if(Z[0]instanceof Array&&Z.length>1)throw new Error("Parse Error: multiple actions possible at state: "+K+", token: "+G);switch(Z[0]){case 1:f.push(G),_.push(M.yytext),s.push(M.yylloc),f.push(Z[1]),G=null,c=M.yyleng,o=M.yytext,B=M.yylineno,it=M.yylloc;break;case 2:if(tt=this.productions_[Z[1]][1],J.$=_[_.length-tt],J._$={first_line:s[s.length-(tt||1)].first_line,last_line:s[s.length-1].last_line,first_column:s[s.length-(tt||1)].first_column,last_column:s[s.length-1].last_column},at&&(J._$.range=[s[s.length-(tt||1)].range[0],s[s.length-1].range[1]]),ot=this.performAction.apply(J,[o,c,B,N.yy,Z[1],_,s].concat(V)),typeof ot<"u")return ot;tt&&(f=f.slice(0,-1*tt*2),_=_.slice(0,-1*tt),s=s.slice(0,-1*tt)),f.push(this.productions_[Z[1]][0]),_.push(J.$),s.push(J._$),qt=D[f[f.length-2]][f[f.length-1]],f.push(qt);break;case 3:return!0}}return!0},"parse")},x=(function(){var y={EOF:1,parseError:l(function(d,f){if(this.yy.parser)this.yy.parser.parseError(d,f);else throw new Error(d)},"parseError"),setInput:l(function(n,d){return this.yy=d||this.yy||{},this._input=n,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:l(function(){var n=this._input[0];this.yytext+=n,this.yyleng++,this.offset++,this.match+=n,this.matched+=n;var d=n.match(/(?:\r\n?|\n).*/g);return d?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),n},"input"),unput:l(function(n){var d=n.length,f=n.split(/(?:\r\n?|\n)/g);this._input=n+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-d),this.offset-=d;var u=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),f.length-1&&(this.yylineno-=f.length-1);var _=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:f?(f.length===u.length?this.yylloc.first_column:0)+u[u.length-f.length].length-f[0].length:this.yylloc.first_column-d},this.options.ranges&&(this.yylloc.range=[_[0],_[0]+this.yyleng-d]),this.yyleng=this.yytext.length,this},"unput"),more:l(function(){return this._more=!0,this},"more"),reject:l(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:l(function(n){this.unput(this.match.slice(n))},"less"),pastInput:l(function(){var n=this.matched.substr(0,this.matched.length-this.match.length);return(n.length>20?"...":"")+n.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:l(function(){var n=this.match;return n.length<20&&(n+=this._input.substr(0,20-n.length)),(n.substr(0,20)+(n.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:l(function(){var n=this.pastInput(),d=new Array(n.length+1).join("-");return n+this.upcomingInput()+`
`+d+"^"},"showPosition"),test_match:l(function(n,d){var f,u,_;if(this.options.backtrack_lexer&&(_={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(_.yylloc.range=this.yylloc.range.slice(0))),u=n[0].match(/(?:\r\n?|\n).*/g),u&&(this.yylineno+=u.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:u?u[u.length-1].length-u[u.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+n[0].length},this.yytext+=n[0],this.match+=n[0],this.matches=n,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(n[0].length),this.matched+=n[0],f=this.performAction.call(this,this.yy,this,d,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),f)return f;if(this._backtrack){for(var s in _)this[s]=_[s];return!1}return!1},"test_match"),next:l(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var n,d,f,u;this._more||(this.yytext="",this.match="");for(var _=this._currentRules(),s=0;s<_.length;s++)if(f=this._input.match(this.rules[_[s]]),f&&(!d||f[0].length>d[0].length)){if(d=f,u=s,this.options.backtrack_lexer){if(n=this.test_match(f,_[s]),n!==!1)return n;if(this._backtrack){d=!1;continue}else return!1}else if(!this.options.flex)break}return d?(n=this.test_match(d,_[u]),n!==!1?n:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:l(function(){var d=this.next();return d||this.lex()},"lex"),begin:l(function(d){this.conditionStack.push(d)},"begin"),popState:l(function(){var d=this.conditionStack.length-1;return d>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:l(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:l(function(d){return d=this.conditionStack.length-1-Math.abs(d||0),d>=0?this.conditionStack[d]:"INITIAL"},"topState"),pushState:l(function(d){this.begin(d)},"pushState"),stateStackSize:l(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:l(function(d,f,u,_){switch(u){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}};return y})();m.lexer=x;function p(){this.yy={}}return l(p,"Parser"),p.prototype=m,m.Parser=p,new p})();$t.parser=$t;var rs=$t;j.extend(Be);j.extend(Xe);j.extend(Ke);var re={friday:5,saturday:6},et="",Ft="",Ot=void 0,Wt="",ht=[],mt=[],Pt=new Map,Vt=[],St=[],kt="",Rt="",ae=["active","done","crit","milestone","vert"],zt=[],ut="",gt=!1,Nt=!1,Ht="sunday",Ct="saturday",Yt=0,is=l(function(){Vt=[],St=[],kt="",zt=[],_t=0,Lt=void 0,Dt=void 0,U=[],et="",Ft="",Rt="",Ot=void 0,Wt="",ht=[],mt=[],gt=!1,Nt=!1,Yt=0,Pt=new Map,ut="",Ve(),Ht="sunday",Ct="saturday"},"clear"),ns=l(function(t){ut=t},"setDiagramId"),as=l(function(t){Ft=t},"setAxisFormat"),os=l(function(){return Ft},"getAxisFormat"),cs=l(function(t){Ot=t},"setTickInterval"),ls=l(function(){return Ot},"getTickInterval"),us=l(function(t){Wt=t},"setTodayMarker"),ds=l(function(){return Wt},"getTodayMarker"),fs=l(function(t){et=t},"setDateFormat"),hs=l(function(){gt=!0},"enableInclusiveEndDates"),ms=l(function(){return gt},"endDatesAreInclusive"),ks=l(function(){Nt=!0},"enableTopAxis"),ys=l(function(){return Nt},"topAxisEnabled"),gs=l(function(t){Rt=t},"setDisplayMode"),vs=l(function(){return Rt},"getDisplayMode"),ps=l(function(){return et},"getDateFormat"),oe=l((t,r)=>{const i=r.toLowerCase().split(/[\s,]+/).filter(e=>e!=="");return[...new Set([...t,...i])]},"mergeTokens"),xs=l(function(t){ht=oe(ht,t)},"setIncludes"),Ts=l(function(){return ht},"getIncludes"),bs=l(function(t){mt=oe(mt,t)},"setExcludes"),ws=l(function(){return mt},"getExcludes"),_s=l(function(){return Pt},"getLinks"),Ds=l(function(t){kt=t,Vt.push(t)},"addSection"),Ss=l(function(){return Vt},"getSections"),Cs=l(function(){let t=ie();const r=10;let i=0;for(;!t&&i<r;)t=ie(),i++;return St=U,St},"getTasks"),ce=l(function(t,r,i,e){const a=t.format(r.trim()),g=t.format("YYYY-MM-DD");return e.includes(a)||e.includes(g)?!1:i.includes("weekends")&&(t.isoWeekday()===re[Ct]||t.isoWeekday()===re[Ct]+1)||i.includes(t.format("dddd").toLowerCase())?!0:i.includes(a)||i.includes(g)},"isInvalidDate"),Ms=l(function(t){Ht=t},"setWeekday"),Es=l(function(){return Ht},"getWeekday"),Is=l(function(t){Ct=t},"setWeekend"),le=l(function(t,r,i,e){if(!i.length||t.manualEndTime)return;let a;t.startTime instanceof Date?a=j(t.startTime):a=j(t.startTime,r,!0),a=a.add(1,"d");let g;t.endTime instanceof Date?g=j(t.endTime):g=j(t.endTime,r,!0);const[v,b]=$s(a,g,r,i,e);t.endTime=v.toDate(),t.renderEndTime=b},"checkTaskDates"),$s=l(function(t,r,i,e,a){let g=!1,v=null;const b=r.add(1e4,"d");for(;t<=r;){if(g||(v=r.toDate()),g=ce(t,i,e,a),g&&(r=r.add(1,"d"),r>b))throw new Error("Failed to find a valid date that was not excluded by `excludes` after 10,000 iterations.");t=t.add(1,"d")}return[r,v]},"fixTaskDates"),ue=l(function(t,r){rt.warn(`Gantt: the "${t}" statement references unknown task id(s): ${r.join(", ")}. Make sure the referenced tasks exist and declare an id. Milestones need both an id and a duration, e.g. "Milestone :milestone, m1, 2023-01-01, 0d".`)},"warnAboutUnknownTaskIds"),At=l(function(t,r,i){if(i=i.trim(),l(b=>{const A=b.trim();return A==="x"||A==="X"},"isTimestampFormat")(r)&&/^\d+$/.test(i))return new Date(Number(i));const g=/^after\s+(?<ids>[\d\w- ]+)/.exec(i);if(g!==null){let b=null;const A=[],F=g.groups.ids.split(" ").filter(O=>O!=="");for(const O of F){const Y=ct(O);if(Y===void 0){A.push(O);continue}(!b||Y.endTime>b.endTime)&&(b=Y)}if(A.length>0&&ue("after",A),b)return b.endTime;const w=new Date;return w.setHours(0,0,0,0),w}let v=j(i,r.trim(),!0);if(v.isValid())return v.toDate();{rt.debug("Invalid date:"+i),rt.debug("With date format:"+r.trim());const b=new Date(i);if(b===void 0||isNaN(b.getTime())||b.getFullYear()<-1e4||b.getFullYear()>1e4)throw new Error("Invalid date:"+i);return b}},"getStartDate"),de=l(function(t){const r=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return r!==null?[Number.parseFloat(r[1]),r[2]]:[NaN,"ms"]},"parseDuration"),fe=l(function(t,r,i,e=!1){i=i.trim();const g=/^until\s+(?<ids>[\d\w- ]+)/.exec(i);if(g!==null){let w=null;const O=[],Y=g.groups.ids.split(" ").filter(z=>z!=="");for(const z of Y){const R=ct(z);if(R===void 0){O.push(z);continue}(!w||R.startTime<w.startTime)&&(w=R)}if(O.length>0&&ue("until",O),w)return w.startTime;const H=new Date;return H.setHours(0,0,0,0),H}let v=j(i,r.trim(),!0);if(v.isValid())return e&&(v=v.add(1,"d")),v.toDate();let b=j(t);const[A,F]=de(i);if(Number.isNaN(A))rt.warn(`Gantt: "${i}" is neither a valid date for the "${r.trim()}" date format nor a valid duration (e.g. "3d"), so it is ignored and the task gets a zero duration. Milestones need a duration too, e.g. "Milestone :milestone, m1, 2023-01-01, 0d".`);else{const w=b.add(A,F);w.isValid()&&(b=w)}return b.toDate()},"getEndDate"),_t=0,ft=l(function(t){return t===void 0?(_t=_t+1,"task"+_t):t},"parseId"),Ys=l(function(t,r){let i;r.substr(0,1)===":"?i=r.substr(1,r.length):i=r;const e=i.split(","),a={};Bt(e,a,ae);for(let v=0;v<e.length;v++)e[v]=e[v].trim();let g="";switch(e.length){case 1:a.id=ft(),a.startTime=t.endTime,g=e[0];break;case 2:a.id=ft(),a.startTime=At(void 0,et,e[0]),g=e[1];break;case 3:a.id=ft(e[0]),a.startTime=At(void 0,et,e[1]),g=e[2];break}return g&&(a.endTime=fe(a.startTime,et,g,gt),a.manualEndTime=j(g,"YYYY-MM-DD",!0).isValid(),le(a,et,mt,ht)),a},"compileData"),As=l(function(t,r){let i;r.substr(0,1)===":"?i=r.substr(1,r.length):i=r;const e=i.split(","),a={};Bt(e,a,ae);for(let g=0;g<e.length;g++)e[g]=e[g].trim();switch(e.length){case 1:a.id=ft(),a.startTime={type:"prevTaskEnd",id:t},a.endTime={data:e[0]};break;case 2:a.id=ft(),a.startTime={type:"getStartDate",startData:e[0]},a.endTime={data:e[1]};break;case 3:a.id=ft(e[0]),a.startTime={type:"getStartDate",startData:e[1]},a.endTime={data:e[2]};break}return a},"parseData"),Lt,Dt,U=[],he={},Ls=l(function(t,r){const i={section:kt,type:kt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:r},task:t,classes:[]},e=As(Dt,r);i.raw.startTime=e.startTime,i.raw.endTime=e.endTime,i.id=e.id,i.prevTaskId=Dt,i.active=e.active,i.done=e.done,i.crit=e.crit,i.milestone=e.milestone,i.vert=e.vert,i.vert?i.order=-1:(i.order=Yt,Yt++);const a=U.push(i);Dt=i.id,he[i.id]=a-1},"addTask"),ct=l(function(t){const r=he[t];return U[r]},"findTaskById"),Fs=l(function(t,r){const i={section:kt,type:kt,description:t,task:t,classes:[]},e=Ys(Lt,r);i.startTime=e.startTime,i.endTime=e.endTime,i.id=e.id,i.active=e.active,i.done=e.done,i.crit=e.crit,i.milestone=e.milestone,i.vert=e.vert,Lt=i,St.push(i)},"addTaskOrg"),ie=l(function(){const t=l(function(i){const e=U[i];let a="";switch(U[i].raw.startTime.type){case"prevTaskEnd":{const g=ct(e.prevTaskId);e.startTime=g.endTime;break}case"getStartDate":a=At(void 0,et,U[i].raw.startTime.startData),a&&(U[i].startTime=a);break}return U[i].startTime&&(U[i].endTime=fe(U[i].startTime,et,U[i].raw.endTime.data,gt),U[i].endTime&&(U[i].processed=!0,U[i].manualEndTime=j(U[i].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),le(U[i],et,mt,ht))),U[i].processed},"compileTask");let r=!0;for(const[i,e]of U.entries())t(i),r=r&&e.processed;return r},"compileTasks"),Os=l(function(t,r){let i=r;dt().securityLevel!=="loose"&&(i=Pe.sanitizeUrl(r)),t.split(",").forEach(function(e){ct(e)!==void 0&&(ke(e,()=>{window.open(i,"_self")}),Pt.set(e,i))}),me(t,"clickable")},"setLink"),me=l(function(t,r){t.split(",").forEach(function(i){let e=ct(i);e!==void 0&&e.classes.push(r)})},"setClass"),Ws=l(function(t,r,i){if(dt().securityLevel!=="loose"||r===void 0)return;let e=[];if(typeof i=="string"){e=i.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let g=0;g<e.length;g++){let v=e[g].trim();v.startsWith('"')&&v.endsWith('"')&&(v=v.substr(1,v.length-2)),e[g]=v}}e.length===0&&e.push(t),ct(t)!==void 0&&ke(t,()=>{Re.runFunc(r,...e)})},"setClickFun"),ke=l(function(t,r){zt.push(function(){const i=ut?`${ut}-${t}`:t,e=document.querySelector(`[id="${i}"]`);e!==null&&e.addEventListener("click",function(){r()})},function(){const i=ut?`${ut}-${t}`:t,e=document.querySelector(`[id="${i}-text"]`);e!==null&&e.addEventListener("click",function(){r()})})},"pushFun"),Ps=l(function(t,r,i){t.split(",").forEach(function(e){Ws(e,r,i)}),me(t,"clickable")},"setClickEvent"),Vs=l(function(t){zt.forEach(function(r){r(t)})},"bindFunctions"),Rs={getConfig:l(()=>dt().gantt,"getConfig"),clear:is,setDateFormat:fs,getDateFormat:ps,enableInclusiveEndDates:hs,endDatesAreInclusive:ms,enableTopAxis:ks,topAxisEnabled:ys,setAxisFormat:as,getAxisFormat:os,setTickInterval:cs,getTickInterval:ls,setTodayMarker:us,getTodayMarker:ds,setAccTitle:Te,getAccTitle:xe,setDiagramTitle:pe,getDiagramTitle:ve,setDiagramId:ns,setDisplayMode:gs,getDisplayMode:vs,setAccDescription:ge,getAccDescription:ye,addSection:Ds,getSections:Ss,getTasks:Cs,addTask:Ls,findTaskById:ct,addTaskOrg:Fs,setIncludes:xs,getIncludes:Ts,setExcludes:bs,getExcludes:ws,setClickEvent:Ps,setLink:Os,getLinks:_s,bindFunctions:Vs,parseDuration:de,isInvalidDate:ce,setWeekday:Ms,getWeekday:Es,setWeekend:Is};function Bt(t,r,i){let e=!0;for(;e;)e=!1,i.forEach(function(a){const g="^\\s*"+a+"\\s*$",v=new RegExp(g);t[0].match(v)&&(r[a]=!0,t.shift(1),e=!0)})}l(Bt,"getTaskTags");j.extend(ss);var zs=l(function(){rt.debug("Something is calling, setConf, remove the call")},"setConf"),ne={monday:Fe,tuesday:Le,wednesday:Ae,thursday:Ye,friday:$e,saturday:Ie,sunday:Ee},Ns=l((t,r)=>{let i=[...t].map(()=>-1/0),e=[...t].sort((g,v)=>g.startTime-v.startTime||g.order-v.order),a=0;for(const g of e)for(let v=0;v<i.length;v++)if(g.startTime>=i[v]){i[v]=g.endTime,g.order=v+r,v>a&&(a=v);break}return a},"getMaxIntersections"),st,It=1e4,Hs=l(function(t,r,i,e){const a=dt().gantt;e.db.setDiagramId(r);const g=dt().securityLevel;let v;g==="sandbox"&&(v=pt("#i"+r));const b=g==="sandbox"?pt(v.nodes()[0].contentDocument.body):pt("body"),A=g==="sandbox"?v.nodes()[0].contentDocument:document,F=A.getElementById(r);st=F.parentElement.offsetWidth,st===void 0&&(st=1200),a.useWidth!==void 0&&(st=a.useWidth);const w=e.db.getTasks(),O=w.filter(m=>!m.vert);let Y=[];for(const m of O)Y.push(m.type);Y=I(Y);const H={};let z=2*a.topPadding;if(e.db.getDisplayMode()==="compact"||a.displayMode==="compact"){const m={};for(const p of O)m[p.section]===void 0?m[p.section]=[p]:m[p.section].push(p);let x=0;for(const p of Object.keys(m)){const y=Ns(m[p],x)+1;x+=y,z+=y*(a.barHeight+a.barGap),H[p]=y}}else{z+=O.length*(a.barHeight+a.barGap);for(const m of Y)H[m]=O.filter(x=>x.type===m).length}F.setAttribute("viewBox","0 0 "+st+" "+z);const R=b.select(`[id="${r}"]`),k=be().domain([we(w,function(m){return m.startTime}),_e(w,function(m){return m.endTime})]).rangeRound([0,st-a.leftPadding-a.rightPadding]);function E(m,x){const p=m.startTime,y=x.startTime;let n=0;return p>y?n=1:p<y&&(n=-1),n}l(E,"taskCompare"),w.sort(E),W(w,st,z),De(R,z,st,a.useMaxWidth),R.append("text").text(e.db.getDiagramTitle()).attr("x",st/2).attr("y",a.titleTopMargin).attr("class","titleText");function W(m,x,p){const y=a.barHeight,n=y+a.barGap,d=a.topPadding,f=a.leftPadding,u=Se().domain([0,Y.length]).range(["#00B9FA","#F95002"]).interpolate(Ce);X(n,d,f,x,p,m,e.db.getExcludes(),e.db.getIncludes()),$(f,d,x,p),L(m,n,d,f,y,u,x),T(n,d),h(f,d,x,p)}l(W,"makeGantt");function L(m,x,p,y,n,d,f){m.sort((c,S)=>c.vert===S.vert?0:c.vert?1:-1);const u=m.filter(c=>!c.vert),s=[...new Set(u.map(c=>c.order))].map(c=>u.find(S=>S.order===c));R.append("g").selectAll("rect").data(s).enter().append("rect").attr("x",0).attr("y",function(c,S){return S=c.order,S*x+p-2}).attr("width",function(){return f-a.rightPadding/2}).attr("height",x).attr("class",function(c){for(const[S,C]of Y.entries())if(c.type===C)return"section section"+S%a.numberSectionStyles;return"section section0"}).enter();const D=R.append("g").selectAll("rect").data(m).enter(),o=e.db.getLinks();if(D.append("rect").attr("id",function(c){return r+"-"+c.id}).attr("rx",3).attr("ry",3).attr("x",function(c){return c.milestone?k(c.startTime)+y+.5*(k(c.endTime)-k(c.startTime))-.5*n:k(c.startTime)+y}).attr("y",function(c,S){return S=c.order,c.vert?a.gridLineStartPadding:S*x+p}).attr("width",function(c){return c.milestone?n:c.vert?.08*n:k(c.renderEndTime||c.endTime)-k(c.startTime)}).attr("height",function(c){return c.vert?u.length*(a.barHeight+a.barGap)+a.barHeight*2:n}).attr("transform-origin",function(c,S){return S=c.order,(k(c.startTime)+y+.5*(k(c.endTime)-k(c.startTime))).toString()+"px "+(S*x+p+.5*n).toString()+"px"}).attr("class",function(c){const S="task";let C="";c.classes.length>0&&(C=c.classes.join(" "));let V=0;for(const[N,P]of Y.entries())c.type===P&&(V=N%a.numberSectionStyles);let M="";return c.active?c.crit?M+=" activeCrit":M=" active":c.done?c.crit?M=" doneCrit":M=" done":c.crit&&(M+=" crit"),M.length===0&&(M=" task"),c.milestone&&(M=" milestone "+M),c.vert&&(M=" vert "+M),M+=V,M+=" "+C,S+M}),D.append("text").attr("id",function(c){return r+"-"+c.id+"-text"}).text(function(c){return c.task}).attr("font-size",a.fontSize).attr("x",function(c){let S=k(c.startTime),C=k(c.renderEndTime||c.endTime);if(c.milestone&&(S+=.5*(k(c.endTime)-k(c.startTime))-.5*n,C=S+n),c.vert)return k(c.startTime)+y;const V=this.getBBox().width;return V>C-S?C+V+1.5*a.leftPadding>f?S+y-5:C+y+5:(C-S)/2+S+y}).attr("y",function(c,S){return c.vert?a.gridLineStartPadding+u.length*(a.barHeight+a.barGap)+60:(S=c.order,S*x+a.barHeight/2+(a.fontSize/2-2)+p)}).attr("text-height",n).attr("class",function(c){const S=k(c.startTime);let C=k(c.endTime);c.milestone&&(C=S+n);const V=this.getBBox().width;let M="";c.classes.length>0&&(M=c.classes.join(" "));let N=0;for(const[it,at]of Y.entries())c.type===at&&(N=it%a.numberSectionStyles);let P="";return c.active&&(c.crit?P="activeCritText"+N:P="activeText"+N),c.done?c.crit?P=P+" doneCritText"+N:P=P+" doneText"+N:c.crit&&(P=P+" critText"+N),c.milestone&&(P+=" milestoneText"),c.vert&&(P+=" vertText"),V>C-S?C+V+1.5*a.leftPadding>f?M+" taskTextOutsideLeft taskTextOutside"+N+" "+P:M+" taskTextOutsideRight taskTextOutside"+N+" "+P+" width-"+V:M+" taskText taskText"+N+" "+P+" width-"+V}),dt().securityLevel==="sandbox"){let c;c=pt("#i"+r);const S=c.nodes()[0].contentDocument;D.filter(function(C){return o.has(C.id)}).each(function(C){var V=S.querySelector("#"+CSS.escape(r+"-"+C.id)),M=S.querySelector("#"+CSS.escape(r+"-"+C.id+"-text"));const N=V.parentNode;var P=S.createElement("a");P.setAttribute("xlink:href",o.get(C.id)),P.setAttribute("target","_top"),N.appendChild(P),P.appendChild(V),P.appendChild(M)})}}l(L,"drawRects");function X(m,x,p,y,n,d,f,u){if(f.length===0&&u.length===0)return;let _,s;for(const{startTime:C,endTime:V}of d)(_===void 0||C<_)&&(_=C),(s===void 0||V>s)&&(s=V);if(!_||!s)return;if(j(s).diff(j(_),"year")>5){rt.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const D=e.db.getDateFormat(),o=[];let B=null,c=j(_);for(;c.valueOf()<=s;)e.db.isInvalidDate(c,D,f,u)?B?B.end=c:B={start:c,end:c}:B&&(o.push(B),B=null),c=c.add(1,"d");R.append("g").selectAll("rect").data(o).enter().append("rect").attr("id",C=>r+"-exclude-"+C.start.format("YYYY-MM-DD")).attr("x",C=>k(C.start.startOf("day"))+p).attr("y",a.gridLineStartPadding).attr("width",C=>k(C.end.endOf("day"))-k(C.start.startOf("day"))).attr("height",n-x-a.gridLineStartPadding).attr("transform-origin",function(C,V){return(k(C.start)+p+.5*(k(C.end)-k(C.start))).toString()+"px "+(V*m+.5*n).toString()+"px"}).attr("class","exclude-range")}l(X,"drawExcludeDays");function q(m,x,p,y){if(p<=0||m>x)return 1/0;const n=x-m,d=j.duration({[y??"day"]:p}).asMilliseconds();return d<=0?1/0:Math.ceil(n/d)}l(q,"getEstimatedTickCount");function $(m,x,p,y){const n=e.db.getDateFormat(),d=e.db.getAxisFormat();let f;d?f=d:n==="D"?f="%d":f=a.axisFormat??"%Y-%m-%d";let u=Me(k).tickSize(-y+x+a.gridLineStartPadding).tickFormat(Gt(f));const s=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(e.db.getTickInterval()||a.tickInterval);if(s!==null){const D=parseInt(s[1],10);if(isNaN(D)||D<=0)rt.warn(`Invalid tick interval value: "${s[1]}". Skipping custom tick interval.`);else{const o=s[2],B=e.db.getWeekday()||a.weekday,c=k.domain(),S=c[0],C=c[1],V=q(S,C,D,o);if(V>It)rt.warn(`The tick interval "${D}${o}" would generate ${V} ticks, which exceeds the maximum allowed (${It}). This may indicate an invalid date or time range. Skipping custom tick interval.`);else switch(o){case"millisecond":u.ticks(Kt.every(D));break;case"second":u.ticks(Qt.every(D));break;case"minute":u.ticks(Zt.every(D));break;case"hour":u.ticks(jt.every(D));break;case"day":u.ticks(Xt.every(D));break;case"week":u.ticks(ne[B].every(D));break;case"month":u.ticks(Ut.every(D));break}}}if(R.append("g").attr("class","grid").attr("transform","translate("+m+", "+(y-50)+")").call(u).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),e.db.topAxisEnabled()||a.topAxis){let D=Oe(k).tickSize(-y+x+a.gridLineStartPadding).tickFormat(Gt(f));if(s!==null){const o=parseInt(s[1],10);if(isNaN(o)||o<=0)rt.warn(`Invalid tick interval value: "${s[1]}". Skipping custom tick interval.`);else{const B=s[2],c=e.db.getWeekday()||a.weekday,S=k.domain(),C=S[0],V=S[1];if(q(C,V,o,B)<=It)switch(B){case"millisecond":D.ticks(Kt.every(o));break;case"second":D.ticks(Qt.every(o));break;case"minute":D.ticks(Zt.every(o));break;case"hour":D.ticks(jt.every(o));break;case"day":D.ticks(Xt.every(o));break;case"week":D.ticks(ne[c].every(o));break;case"month":D.ticks(Ut.every(o));break}}}R.append("g").attr("class","grid").attr("transform","translate("+m+", "+x+")").call(D).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}l($,"makeGrid");function T(m,x){let p=0;const y=Object.keys(H).map(n=>[n,H[n]]);R.append("g").selectAll("text").data(y).enter().append(function(n){const d=n[0].split(We.lineBreakRegex),f=-(d.length-1)/2,u=A.createElementNS("http://www.w3.org/2000/svg","text");u.setAttribute("dy",f+"em");for(const[_,s]of d.entries()){const D=A.createElementNS("http://www.w3.org/2000/svg","tspan");D.setAttribute("alignment-baseline","central"),D.setAttribute("x","10"),_>0&&D.setAttribute("dy","1em"),D.textContent=s,u.appendChild(D)}return u}).attr("x",10).attr("y",function(n,d){if(d>0)for(let f=0;f<d;f++)return p+=y[d-1][1],n[1]*m/2+p*m+x;else return n[1]*m/2+x}).attr("font-size",a.sectionFontSize).attr("class",function(n){for(const[d,f]of Y.entries())if(n[0]===f)return"sectionTitle sectionTitle"+d%a.numberSectionStyles;return"sectionTitle"})}l(T,"vertLabels");function h(m,x,p,y){const n=e.db.getTodayMarker();if(n==="off")return;const d=R.append("g").attr("class","today"),f=new Date,u=d.append("line");u.attr("x1",k(f)+m).attr("x2",k(f)+m).attr("y1",a.titleTopMargin).attr("y2",y-a.titleTopMargin).attr("class","today"),n!==""&&u.attr("style",n.replace(/,/g,";"))}l(h,"drawToday");function I(m){const x={},p=[];for(let y=0,n=m.length;y<n;++y)Object.prototype.hasOwnProperty.call(x,m[y])||(x[m[y]]=!0,p.push(m[y]));return p}l(I,"checkUnique")},"draw"),Bs={setConf:zs,draw:Hs},qs=l(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done task text displayed outside the bar sits against the diagram background,
     not against the done-task bar, so it must use the outside/contrast color. */
  .doneText0.taskTextOutsideLeft,
  .doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,
  .doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,
  .doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,
  .doneText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done-crit task text outside the bar — same reasoning as doneText above. */
  .doneCritText0.taskTextOutsideLeft,
  .doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,
  .doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,
  .doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,
  .doneCritText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles"),Gs=qs,js={parser:rs,db:Rs,renderer:Bs,styles:Gs};export{js as diagram};
