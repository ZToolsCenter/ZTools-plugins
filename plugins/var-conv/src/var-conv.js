function tokenize(var_name) {
    const text = String(var_name || '');
    if (!text) return [''];

    const chunks = text.split(/[-_\s]+/);
    const tokens = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;
        const words = chunk
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
            .replace(/([a-z\d])([A-Z])/g, '$1\0$2')
            .replace(/([0-9])([A-Za-z])/g, '$1\0$2')
            .split('\0')
            .filter(Boolean);
        if (words.length) {
            for (let j = 0; j < words.length; j++) tokens.push(words[j]);
        } else {
            tokens.push(chunk);
        }
    }

    const split = tokens.join('-').toLocaleLowerCase().split('-').filter(Boolean);
    if (split.length) return split;
    return [text];
}

// 解析对象
let VarConv = function (var_name) {
    this.origin_var_name = var_name || '';
    this.var_split = tokenize(this.origin_var_name);
}

VarConv.prototype.maps = {
    UpperCamelCase: { title: '大驼峰写法 (帕斯卡命名法)', search: 'dtf,datuofeng,psk,pasika,ucc,uppercamelcase' },
    CamelCase: { title: '小驼峰写法 (驼峰命名法)', search: 'xtf,xiaotuofeng,cc,camelcase' },
    Snake: { title: '蛇形写法 (下划线命名法)', search: 'sx,shexing,xhx,xiahuaxian,snake,_' },
    Hyphen: { title: '连字符写法 (中划线命名法)', search: 'l,h,lzf,lianzifu,zhx,zhonghuaxian,hyphen,-' },
    Const: { title: '常量名', search: 'clm,changliangming,const' },
    LocaleLowerCase: { title: '全小写', search: 'qxx,quanxiaoxie,llc,localelowercase' },
    LocaleUpperCase: { title: '全大写', search: 'qdx,quandaxie,luc,localeuppercase' },
    SpaceUpperCase: { title: '空格 全大写', search: ' dx, qdx,kdx,kqd,kgqdx,kongquandaxie,konggequandaxie' },
    SpaceLowerCase: { title: '空格 全小写', search: ' xx, qxx,kxx,kqx,kgqxx,kongquanxiao,konggequanxiaoxie' },
    SpaceUpperCamelCase: { title: '空格 大驼峰', search: ' dtf,kdtf,kgdtf,kongdatuofeng,konggedatuofeng' },
    SpaceCamelCase: { title: '空格 小驼峰', search: ' xtf,kxtf,kongxiaotuofeng,konggexiaotuofeng' },
}

// 大驼峰写法 (帕斯卡命名法) UserName
VarConv.prototype.toUpperCamelCase = function (separator) {
    let vars = [];
    this.var_split.forEach(item => {
        item = item.replace(/(^[a-z])/, (match) => {
            return match.toLocaleUpperCase()
        });
        vars.push(item)
    });
    return vars.join(separator || '');
}

// 小驼峰写法 (驼峰命名法) userName
VarConv.prototype.toCamelCase = function (separator) {
    let vars = [];
    this.var_split.forEach((item, index) => {
        if (index != 0) {
            item = item.replace(/(^[a-z])/, (match) => {
                return match.toLocaleUpperCase()
            });
        }
        vars.push(item)
    });
    return vars.join(separator || '');
}

// 蛇形写法 (下划线) user_name
VarConv.prototype.toSnake = function () {
    return this.var_split.join('_');
}

// 连字符 user-name
VarConv.prototype.toHyphen = function () {
    return this.var_split.join('-');
}

// 常量写法 (全大写下划线) USER_NAME
VarConv.prototype.toConst = function () {
    return this.var_split.join('_').toLocaleUpperCase();
}

// 全小写
VarConv.prototype.toLocaleLowerCase = function () {
    return this.origin_var_name.toLocaleLowerCase();
}

// 全大写
VarConv.prototype.toLocaleUpperCase = function () {
    return this.origin_var_name.toLocaleUpperCase();
}

// 空格 全小写
VarConv.prototype.toSpaceLowerCase = function () {
    return this.var_split.join(' ').toLocaleLowerCase();
}
// 空格 全大写
VarConv.prototype.toSpaceUpperCase = function () {
    return this.var_split.join(' ').toLocaleUpperCase();
}
// 空格 大驼峰
VarConv.prototype.toSpaceUpperCamelCase = function () {
    return this.toUpperCamelCase(' ');
}

// 空格 小驼峰写法
VarConv.prototype.toSpaceCamelCase = function () {
    return this.toCamelCase(' ');
}

module.exports = VarConv;
