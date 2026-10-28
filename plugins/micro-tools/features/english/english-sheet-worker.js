/* Parse user spreadsheets locally, off the UI thread. Never evaluate formulas. */
importScripts('../../vendor/sheetjs/xlsx.full.min.js');
onmessage=event=>{try{const book=XLSX.read(event.data,{type:'array',cellFormula:false,cellHTML:false,sheetRows:20002});postMessage({sheets:book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false,blankrows:false})}))})}catch{postMessage({error:'无法读取 Excel，请检查文件是否损坏或加密。'})}};
