// PDF.js is vendored with its license; extraction never uploads documents.
import * as pdfjs from '../../vendor/pdfjs/english-pdf-vendor.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../../vendor/pdfjs/english-pdf-worker.mjs',import.meta.url).href;
export async function extractPDF(bytes,{onProgress=()=>{}}={}){
 if(bytes.byteLength>10*1024*1024)throw Error('PDF 最大 10 MB，请截取要学习的章节。');
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 try{const doc=await task.promise;if(doc.numPages>120)throw Error('最多读取 120 页，请截取摘要或章节。');let text='';
 for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();text+=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('')+'\n\n';page.cleanup();onProgress(i,doc.numPages);if(text.length>180000)throw Error('正文超过 18 万字符，请截取要学习的部分。')}
 if(!text.trim())throw Error('未提取到文字；扫描 PDF 请先 OCR 或粘贴正文。');return text.trim();
 }finally{await task.destroy()}
}
