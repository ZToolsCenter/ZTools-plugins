export function buildPdfMergePlan(files, options = {}) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return {
    outputName: options.outputName || 'merged.pdf',
    totalPages: sorted.reduce((sum, file) => sum + (file.pages || 0), 0),
    files: sorted.map(file => file.path)
  };
}

export function buildPdfSplitPlan(source, expression) {
  const base = basename(source);
  return parsePageRanges(expression).map(([start, end]) => {
    return {
      source,
      range: [start, end],
      targetName: `${base}-p${start}${end === start ? '' : `-${end}`}.pdf`
    };
  });
}

/** Parse a user-facing page expression such as "1-3,5,8-9". */
export function parsePageRanges(expression) {
  const ranges = String(expression ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!match) throw new Error(`无效页码范围：${part}`);
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new Error(`无效页码范围：${part}`);
      }
      return [start, end];
    });

  if (ranges.length === 0) throw new Error('请输入至少一个页码范围');
  return ranges;
}

export function extractInvoiceFields(text) {
  const source = String(text);
  return {
    invoiceNumber: pick(source, /发票号码[:：\s]*([A-Za-z0-9-]+)/),
    date: pick(source, /开票日期[:：\s]*(\d{4}-\d{2}-\d{2})/),
    amount: pick(source, /(?:金额|价税合计)[^\d]*(\d+(?:\.\d{1,2})?)/),
    buyer: pick(source, /购买方[:：\s]*([^\n\r]+)/)
  };
}

export function buildDocumentRenamePlan(documents, template) {
  return documents.map((document, index) => {
    const fields = document.fields || {};
    const hasFields = Object.keys(fields).length > 0;
    const targetName = hasFields
      ? template.replace(/\{(\w+)\}/g, (_, key) => sanitize(fields[key] || '未命名'))
      : `未命名-${index + 1}`;
    return {
      source: document.path,
      targetName: `${targetName}.pdf`
    };
  });
}

export function summarizePdfBatch(files) {
  return {
    documents: files.length,
    pages: files.reduce((sum, file) => sum + (file.pages || 0), 0),
    size: files.reduce((sum, file) => sum + (file.size || 0), 0)
  };
}

function pick(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function sanitize(value) {
  return String(value).trim().replace(/[\\/:*?"<>|]/g, '-');
}

function basename(filePath) {
  const name = String(filePath).split(/[\\/]/).pop() || '';
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}
