// 将下划线字符串转换为小驼峰字符串
export function snakeToCamel(snakeStr) {
    if (!snakeStr || typeof snakeStr !== 'string') {
        return '';
    }
    return snakeStr.split('_').map((word, index) => {
        // 第一个单词保持原样，后续单词首字母大写
        return index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
    }).join('');
}

// 将下划线字符串转换为大驼峰字符串
export function snakeToUpperCamel(snakeStr) {
    if (!snakeStr || typeof snakeStr !== 'string') {
        return '';
    }
    return snakeStr.split('_').map(word => {
        // 每个单词首字母都大写
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join('');
}