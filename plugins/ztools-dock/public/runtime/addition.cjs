'use strict';
const { randomUUID } = require('node:crypto');
const { describeFile } = require('./file-actions.cjs');
const { validUrl } = require('./core.cjs');
const TYPES = { url:['web','网址','Globe','#087fe7'], app:['tools','常用工具','BriefcaseBusiness','#ef9309'], file:['files','文件处理','FilePenLine','#6475e8'], folder:['folders','文件夹','Folder','#087fe7'] };
function prepareAddition(param, config, api, readText = () => '') {
  let payload = param.payload;
  if (!payload || payload === '添加到程序坞') {
    const copied = api.getCopyedFiles?.(); payload = copied?.length ? copied : readText();
  }
  const values = Array.isArray(payload) ? payload.map(f => typeof f === 'string' ? f : f?.path) : typeof payload === 'string' ? payload.trim().split(/\r?\n/).filter(Boolean) : [];
  if (!values.length || values.length > 100) throw new Error('请先复制网址、应用、文件或文件夹，一次最多 100 项');
  const categories = [], entries = [];
  for (let target of [...new Set(values)]) {
    if (typeof target !== 'string') throw new Error('复制的内容无效，请重新复制');
    target = target.trim().replace(/^"(.*)"$/, '$1');
    if (/^www\./i.test(target)) target = 'https://' + target;
    let entry;
    if (/^https?:\/\//i.test(target)) {
      validUrl(target); entry = { name: new URL(target).hostname, target, type:'url', icon:'Globe' };
    } else entry = describeFile(target, api);
    const [id,name,icon,color] = TYPES[entry.type];
    let category = [...config.categories,...categories].find(c=>c.id===id) || [...config.categories,...categories].find(c=>c.name===name);
    if (!category) {
      if(config.categories.length+categories.length>=40) throw new Error('分类已达 40 个，请先在设置中整理分类');
      category={id:config.categories.some(c=>c.id===id)?randomUUID():id,name,icon,color};categories.push(category);
    }
    entries.push({ ...entry, id:randomUUID(),categoryId:category.id,color:category.color });
  }
  return { categories, entries };
}
module.exports = { prepareAddition };
