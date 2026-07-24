import Handlebars from 'handlebars';

/**
 * 注册单个助手函数
 * 例：
 * registerHelper("memberStatus", (isMember) => {
 *       return isMember ? 'Yes' : 'No';
 *     })
 * @param helperName
 * @param helper
 */
export function registerHelper(helperName, helper) {
    Handlebars.registerHelper(helperName, helper);
}

/**
 * 注册多个助手函数
 * 例：
 * registerHelpers(
 *         {
 *           memberStatus: function (isMember) {
 *             return isMember ? 'Yes' : 'No';
 *           }
 *         }
 *     )
 * @param helperName
 * @param helper
 */
export function registerHelpers(helpers) {
    Object.keys(helpers).forEach((helperName) => {
        Handlebars.registerHelper(helperName, helpers[helperName]);
    });
}

/**
 * 渲染 Handlebars 模板
 * @param templateFunction - 可以是模板函数或模板字符串
 * @param data - 模板数据
 * @returns {*} 渲染结果
 */
export function renderTemplate(templateFunction, data) {
    // 如果是字符串，需要先编译为模板函数
    if (typeof templateFunction === 'string') {
        templateFunction = Handlebars.compile(templateFunction);
    }

    // 确保数据对象包含所有必要的属性
    // 关键：对 comment 字段进行预处理，将其包装成 SafeString
    const enhancedData = processDataForSafeRendering(data);

    // 直接使用数据渲染模板
    return templateFunction(enhancedData);
}

/**
 * 处理数据，将 comment 字段标记为安全的（不会被转义）
 * @param data 原始数据
 * @returns {Object} 处理后的数据
 */
function processDataForSafeRendering(data) {
    const enhancedData = {
        ...data,
        // 确保这些变量可以直接在模板中使用
        upperCamelTableName: data.upperCamelTableName || '',
        lowerCamelTableName: data.lowerCamelTableName || '',
        fullPackage: data.fullPackage || '',
        // 确保布尔值不被转换为字符串，正确处理条件块
        genComment: data.genComment !== undefined ? Boolean(data.genComment) : true
    };
    
    // 关键：对 tableInfo 中的所有 comment 字段进行处理
    if (enhancedData.tableInfo) {
        enhancedData.tableInfo = {
            ...enhancedData.tableInfo,
            // 将 tableComment 标记为安全字符串
            tableComment: new Handlebars.SafeString(enhancedData.tableInfo.tableComment || ''),
            // 处理字段数组
            fields: (enhancedData.tableInfo.fields || []).map(field => ({
                ...field,
                // 将每个字段的 comment 标记为安全字符串
                comment: new Handlebars.SafeString(field.comment || '')
            }))
        };
    }
    
    return enhancedData;
}
