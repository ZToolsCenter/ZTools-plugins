// 备注转义规则
// - \n 表示换行
// - \\ 表示字面量反斜杠

function escapeRemark(remark) {
    if (!remark || typeof remark !== 'string') return remark;
    // 先转义反斜杠，再转义换行，避免把字面量 \n 误当成换行
    return remark.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function unescapeRemark(remark) {
    if (!remark || typeof remark !== 'string') return remark;

    let result = '';
    for (let i = 0; i < remark.length; i++) {
        const char = remark[i];
        if (char !== '\\') {
            result += char;
            continue;
        }

        const next = remark[i + 1];
        if (next === undefined) {
            result += '\\';
            continue;
        }

        if (next === 'n') {
            result += '\n';
            i++;
            continue;
        }

        if (next === '\\') {
            result += '\\';
            i++;
            continue;
        }

        // 未知转义保持原样
        result += '\\' + next;
        i++;
    }

    return result;
}

module.exports = { escapeRemark, unescapeRemark };
