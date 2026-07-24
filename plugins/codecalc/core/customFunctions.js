/**
 * 核心思路：将表达式转换为lambda函数
 */

// TODO:
// 支持传入参数类型，string, number, boolean, array, object

// 自定义函数存储，key: 函数名，value: 函数对象
const customFunctions = new Map();
// 自定义常数存储，key: 常数名，用于清除时从 CONSTANTS 中移除
const customConstants = new Map();

// 先去除前面的行号变量定义（如 $1 = func() = ...）
function removeLineNumber(expr) {
    if (/^\s*\$\d+\s*=/.test(expr)) {
        expr = expr.replace(/^\s*\$\d+\s*=\s*/, '');
    }
    return expr;
}


function createCustomFunction(definition, calculator) {
    // 1. 解析函数定义（= 必须是单个等号，不能是 == 或 = =）
    // 支持可选注释尾巴：; // 注释内容（注释可为空）
    const functionDefRegex = /^([a-zA-Z_$][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*=(?!\s*=)\s*(.+?)(?:\s*;\s*\/\/(.*))?$/;
    const match = definition.match(functionDefRegex);
    
    if (!match) {
        throw new Error('函数定义格式错误，正确格式: funcname(param1,param2,...) = expression');
    }
    
    const [, funcName, paramStr, rawExpression, rawComment] = match;
    const expression = rawExpression.trim();
    const comment = rawComment === undefined ? null : rawComment.trim();
    
    // 2. 解析参数列表
    const params = paramStr.trim() ? 
        paramStr.split(',').map(p => p.trim()) : [];
    
    // 3. 验证函数名和参数名
    validateName(funcName);
    params.forEach(param => validateName(param));
    
    // 4. 生成lambda函数
    const lambdaFunc = createLambdaFunction(params, expression, calculator);
    
    return {
        name: funcName,
        params: params,
        expression: expression,
        comment: comment,
        func: lambdaFunc,
        args: params.length
    };
}

function createLambdaFunction(params, expression, calculator) {
    // 临时变量绑定，避免参数做字符串替换而需要搞序列化
    function withTemporaryBindings(paramNames, values, run) {
        const snapshots = paramNames.map((name, index) => {
            const existed = calculator.hasVariable(name);
            const snapshot = {
                name,
                existed,
                value: existed ? calculator.getVariable(name) : undefined
            };
            calculator.setVariable(name, values[index]);
            return snapshot;
        });

        try {
            return run();
        } finally {
            snapshots.reverse().forEach(item => {
                if (item.existed) {
                    calculator.setVariable(item.name, item.value);
                } else {
                    calculator.deleteVariable(item.name);
                }
            });
        }
    }

    return function(...args) {
        // 检查参数数量
        if (args.length !== params.length) {
            throw new Error(`函数需要 ${params.length} 个参数，但得到了 ${args.length} 个`);
        }

        return withTemporaryBindings(params, args, () => {
            const result = calculator.calculate(expression, { raw: true });
            return result.value;
        });
    };
}


function validateName(name) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`名称 "${name}" 格式不正确，只能包含字母、数字和下划线，且不以数字开头`);
    }
}


// TODO: 自定义函数应该单独保存，而不是添加到FUNCTIONS中
function addCustomFunction(calculator, FUNCTIONS, definition) {

    definition = removeLineNumber(definition);

    const customFunc = createCustomFunction(definition, calculator);
    
    // 如果函数名不在自定义函数中，但在FUNCTIONS中，视为与内置函数冲突
    if (!customFunctions.has(customFunc.name) && FUNCTIONS[customFunc.name]) {
        throw new Error(`函数名 "${customFunc.name}" 与内置函数冲突`);
    }
    
    // 存储到本地
    customFunctions.set(customFunc.name, customFunc);
    
    // 添加到FUNCTIONS对象
    const baseDescription = `𝒇:${customFunc.name}(${customFunc.params.join(', ')}) = ${customFunc.expression}`;
    const description = customFunc.comment !== null
        ? `𝒇:${customFunc.comment}`
        : baseDescription;

    FUNCTIONS[customFunc.name] = {
        func: customFunc.func,
        args: customFunc.args,
        // argTypes: customFunc.argTypes,
        argTypes: 'any',
        description,
        isCustom: true
    };
    
    return customFunc.name;
}


function removeCustomFunction(funcName, FUNCTIONS) {
    if (customFunctions.has(funcName)) {
        customFunctions.delete(funcName);
        delete FUNCTIONS[funcName];
        return true;
    }
    return false;
}


function getCustomFunctions() {
    const result = {};
    for (const [name, funcInfo] of customFunctions) {
        result[name] = {
            name: funcInfo.name,
            params: funcInfo.params,
            expression: funcInfo.expression,
            args: funcInfo.args
        };
    }
    return result;
}


function clearCustomFunctions(FUNCTIONS) {
    for (const funcName of customFunctions.keys()) {
        delete FUNCTIONS[funcName];
    }
    customFunctions.clear();
}

function clearCustomConstants(CONSTANTS) {
    for (const name of customConstants.keys()) {
        delete CONSTANTS[name];
    }
    customConstants.clear();
}

/** 解析常数定义 "name := number" 并加入 CONSTANTS */
function addCustomConstant(CONSTANTS, definition) {
    definition = removeLineNumber(definition);
    const constantName = getCustomConstantName(definition);
    if (!constantName) throw new Error('常数定义格式错误, 正确格式: name := number');
    customConstants.set(constantName, true);
    CONSTANTS[constantName] = Number(definition.split(/\s*:\s*=\s*/)[1].trim());
    return constantName;
}

// 函数定义，返回函数名（= 必须是单个等号，不能是 == 或 = =）
function getCustomFunctionName(expr) {
    expr = removeLineNumber(expr);
    const functionDefRegex = /^([a-zA-Z][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*=(?!\s*=)\s*(.+?)(?:\s*;\s*\/\/(.*))?$/;
    const match = expr.trim().match(functionDefRegex);
    return match ? match[1] : null;
}

function isFunctionDefinition(expr) {
    return getCustomFunctionName(expr) !== null;
}

// 常数定义 "name := number"，返回常数名
function getCustomConstantName(expr) {
    expr = removeLineNumber(expr);
    const constantDefRegex = /^\s*([a-zA-Z_$][a-zA-Z0-9_]*)\s*:\s*=\s*-?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?\s*$/;
    const match = expr.trim().match(constantDefRegex);
    return match ? match[1] : null;
}

function isConstantDefinition(expr) {
    return getCustomConstantName(expr) !== null;
}


/** 从 Storage 加载自定义项，按 expType 更新函数字典或常数字典 */
function updateCustomFromStorage(calculator, FUNCTIONS, CONSTANTS) {
    clearCustomFunctions(FUNCTIONS);
    if (CONSTANTS) clearCustomConstants(CONSTANTS);

    try {
        const storage = typeof window !== 'undefined' && window.ztools?.dbStorage
            ? window.ztools.dbStorage
            : localStorage;
        const saved = JSON.parse(storage.getItem('customFunctions') || '{}');
        for (const name of Object.keys(saved)) {
            const data = saved[name];
            if (!data || !data.definition) continue;
            const expType = data.expType != null ? data.expType : (isFunctionDefinition(data.definition) ? 'function' : isConstantDefinition(data.definition) ? 'constant' : 'function');
            try {
                if (expType === 'constant') {
                    if (CONSTANTS) addCustomConstant(CONSTANTS, data.definition);
                } else {
                    addCustomFunction(calculator, FUNCTIONS, data.definition);
                }
            } catch (error) {
                console.error(`加载${expType === 'constant' ? '常数' : '函数'} "${name}" 失败:`, error.message);
            }
        }
    } catch (error) {
        console.error('从存储加载自定义项失败:', error.message);
    }
}

/**
 * 测试辅助：不依赖 Storage，直接将自定义定义注入系统。
 * expType: 'function' | 'constant' | 'auto'
 */
function addCustomFromDefinitionForTest(calculator, FUNCTIONS, CONSTANTS, definition, expType = 'auto') {
    if (!definition || typeof definition !== 'string') {
        throw new Error('definition 必须是非空字符串');
    }

    if (expType === 'constant') {
        if (!CONSTANTS) throw new Error('添加自定义常数需要传入 CONSTANTS');
        return addCustomConstant(CONSTANTS, definition);
    }

    if (expType === 'function') {
        return addCustomFunction(calculator, FUNCTIONS, definition);
    }

    // auto 模式：优先按定义语法自动判定
    if (isConstantDefinition(definition)) {
        if (!CONSTANTS) throw new Error('添加自定义常数需要传入 CONSTANTS');
        return addCustomConstant(CONSTANTS, definition);
    }
    if (isFunctionDefinition(definition)) {
        return addCustomFunction(calculator, FUNCTIONS, definition);
    }

    throw new Error('无法识别定义类型，请使用函数定义 "f(x)=..." 或常数定义 "a:=..."');
}

/** 测试辅助：清理测试中注入的自定义函数与常数 */
function clearCustomForTest(FUNCTIONS, CONSTANTS) {
    clearCustomFunctions(FUNCTIONS);
    if (CONSTANTS) clearCustomConstants(CONSTANTS);
}

export {
    isFunctionDefinition,
    isConstantDefinition,
    getCustomFunctionName,
    getCustomConstantName,
    updateCustomFromStorage,
    addCustomFromDefinitionForTest,
    clearCustomForTest,
};
