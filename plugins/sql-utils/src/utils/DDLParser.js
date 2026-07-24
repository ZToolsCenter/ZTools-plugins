import {Parser} from 'sql-ddl-to-json-schema';

// 默认类型映射
const DEFAULT_TYPE_MAPPING = {
  // 数值类型
  int: 'Integer',
  smallint: 'Integer',
  mediumint: 'Integer',
  bigint: 'Long',
  float: 'Float',
  double: 'Double',
  decimal: 'BigDecimal',
  numeric: 'BigDecimal',
  tinyint: 'Integer',

  // 字符串类型
  varchar: 'String',
  char: 'String',
  text: 'String',
  mediumtext: 'String',
  longtext: 'String',
  json: 'String',
  enum: 'String',
  set: 'String',

  // 日期时间
  date: 'LocalDate',
  datetime: 'LocalDateTime',
  timestamp: 'LocalDateTime',
  time: 'LocalTime',
  year: 'Integer',

  // 二进制类型
  blob: 'byte[]',
  mediumblob: 'byte[]',
  longblob: 'byte[]',
  binary: 'byte[]',
  varbinary: 'byte[]',

  // 其他类型
  bit: 'Boolean',
  geometry: 'Object'
};

/**
 * 解析DDL
 * @param ddl
 */
export function parseDDL(ddl, options = {}) {
  const {silent = false} = options;
  ddl = ddl.trim();
  if (ddl.length > 0) {
    const lastChar = ddl[ddl.length - 1];
    if (lastChar !== ';') {
      ddl += ';';
    }
  }

  let result = null;
  try {
    const parser = new Parser('mysql');
    parser.feed(ddl);
    const parsedJsonFormat = parser.results;
    result = parser.toCompactJson(parsedJsonFormat);
  } catch (error) {
    if (!silent) {
      console.error('[DDLParser] parse error:', error);
    }
    return null;
  }
  const finalResult = convertJson(result);
  return finalResult;
}

// 转换函数
function convertJson(data) {
  data = data || [];
  // 如果 data 不是数组或者数组为空，则直接返回空对象
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  // 从原始数据中取出第一个对象，这里假设原始数据数组中只有一个对象
  const item = data[0];

  // 获取表名
  const tableName = item.name;

  // 获取表注释，如果没有则默认为空字符串
  const tableComment = item.options ? item.options.comment || '' : '';

  // 映射 columns 数组为新的 fields 数组
  const columns = Array.isArray(item.columns) ? item.columns : [];
  const primaryKeyColumns = getPrimaryKeyColumns(item);
  const typeMapping = getTypeMapping();
  const fields = columns.map(column => ({
    fieldName: column.name,
    fieldType: column.type?.datatype || '',
    javaType: getJavaType(column, typeMapping),
    comment: String(column.options?.comment || ''),
    isPrimaryKey: primaryKeyColumns.has(column.name)
  }));

  // 返回转换后的对象
  return {
    tableName,
    tableComment: tableComment,
    fields,
    imports: generateImports(fields)
  };
}

/**
 * 获取Java类型
 * @param column
 * @param typeMapping
 * @returns {string|*|string}
 */
const getJavaType = (column, typeMapping) => {
  const type = (column.type?.datatype || '').toLowerCase();
  const length = column.options?.length;

  if (type === 'bit') {
    return length === 1 ? 'Boolean' : 'byte[]';
  }

  // 处理unsigned类型
  if (column.unsigned) {
    if (type === 'bigint') return 'BigInteger';
    if (type === 'int') return 'Long';
  }

  return typeMapping[type] || 'Object'; // 默认返回Object类型
};

function getTypeMapping() {
  // 尝试从localStorage获取自定义类型映射
  let typeMapping = DEFAULT_TYPE_MAPPING;
  try {
    const savedMappings = typeof localStorage !== 'undefined' ? localStorage.getItem('typeMappings') : null;
    if (savedMappings) {
      const customMappings = JSON.parse(savedMappings);
      // 将自定义映射转换为对象形式
      typeMapping = {};
      customMappings.forEach(mapping => {
        if (mapping.mysqlType && mapping.javaType) {
          typeMapping[mapping.mysqlType] = mapping.javaType;
        }
      });
      // 合并默认映射，确保未自定义的类型有默认值
      Object.keys(DEFAULT_TYPE_MAPPING).forEach(key => {
        if (!typeMapping[key]) {
          typeMapping[key] = DEFAULT_TYPE_MAPPING[key];
        }
      });
    }
  } catch (e) {
    console.error('加载类型映射失败，使用默认映射:', e);
    typeMapping = DEFAULT_TYPE_MAPPING;
  }

  return typeMapping;
}

function getPrimaryKeyColumns(item) {
  const primaryKeyColumns = new Set();

  if (Array.isArray(item.primaryKey)) {
    item.primaryKey.forEach(column => primaryKeyColumns.add(getColumnName(column)));
  } else if (Array.isArray(item.primaryKey?.columns)) {
    item.primaryKey.columns.forEach(column => primaryKeyColumns.add(getColumnName(column)));
  }

  if (Array.isArray(item.constraints)) {
    item.constraints
      .filter(constraint => String(constraint.type || '').toLowerCase() === 'primary key')
      .forEach(constraint => {
        const columns = constraint.columns || constraint.keys || constraint.value || [];
        if (Array.isArray(columns)) {
          columns.forEach(column => primaryKeyColumns.add(getColumnName(column)));
        }
      });
  }

  return primaryKeyColumns;
}

function getColumnName(column) {
  if (typeof column === 'string') return column;
  return column?.name || column?.column || column?.value || '';
}

/**
 * 生成导包语句
 * @param fields
 * @returns {string}
 */
function generateImports(fields) {
  // 类型与包路径映射表
  const IMPORT_MAP = {
    'BigDecimal': 'java.math.BigDecimal',
    'LocalDateTime': 'java.time.LocalDateTime',
    'LocalDate': 'java.time.LocalDate',
    'LocalTime': 'java.time.LocalTime',
    'BigInteger': 'java.math.BigInteger',
    'Date': 'java.util.Date',
    'Timestamp': 'java.sql.Timestamp',
    'Blob': 'java.sql.Blob'
  };

  // 智能导包判断逻辑
  const requiredTypes = new Set();
  fields.forEach(field => {
    const type = field.javaType;
    if (IMPORT_MAP[type]) {
      requiredTypes.add(IMPORT_MAP[type]);
    }

    // 处理数组类型
    if (type.endsWith('[]') && !type.startsWith('byte')) {
      requiredTypes.add('java.util.Arrays');
    }
  });

  // 生成规范的import语句
  return Array.from(requiredTypes)
    .sort()
    .map(pkg => `import ${pkg};`)
    .join('\n');
}
