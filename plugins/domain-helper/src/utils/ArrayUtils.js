export class ArrayUtils {
    static betterMatchFilter(array, keyword) {
        return array
            .filter(str => str.includes(keyword))
            .sort((a, b) => {
                if (a === keyword) return -1;
                if (b === keyword) return 1;

                const indexA = a.indexOf(keyword);
                const indexB = b.indexOf(keyword);
                if (indexA !== indexB) {
                    return indexA - indexB;
                }

                return a.length - b.length;
            });
    }

    static sortByRelevance(records, key, columns) {
        return records.sort((a, b) => {
            for (const column of columns) {
                const valueA = a[column]?.toLowerCase() || ''; // 获取 A 的列值
                const valueB = b[column]?.toLowerCase() || ''; // 获取 B 的列值

                // 完全匹配优先
                if (valueA === key) return -1;
                if (valueB === key) return 1;

                // 部分匹配：根据关键字首次出现的位置排序（位置越靠前，关联性越高）
                const indexA = valueA.indexOf(key);
                const indexB = valueB.indexOf(key);
                if (indexA !== -1 && indexB !== -1 && indexA !== indexB) {
                    return indexA - indexB; // 位置越靠前，优先级越高
                }

                // 如果一个匹配了，另一个没匹配，优先匹配的
                if (indexA !== -1 && indexB === -1) return -1;
                if (indexB !== -1 && indexA === -1) return 1;
            }

            // 如果所有列都匹配不到或相等，按字符串长度排序（长度越短，关联性越强）
            for (const column of columns) {
                const lengthA = a[column]?.length || Infinity;
                const lengthB = b[column]?.length || Infinity;
                if (lengthA !== lengthB) {
                    return lengthA - lengthB;
                }
            }

            return 0; // 如果所有条件都相等
        });
    }

}
