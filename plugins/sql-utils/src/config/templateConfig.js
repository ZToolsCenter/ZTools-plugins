/**
 * 模板配置文件
 * 定义所有可用的模板及其配置选项
 */

export const templateConfigs = [
  {
    key: 'javaBean',
    name: 'Entity',
    templateFile: 'javaEntity.hbs',
    subPackage: 'entity',
    options: [
      { key: 'genComment', label: '文档注释', type: 'checkbox', default: true },
      { key: 'genLombok', label: 'Lombok注解', type: 'checkbox', default: true },
      { key: 'genSwagger', label: 'Swagger注解', type: 'checkbox', default: false }
    ]
  },
  {
    key: 'mapper',
    name: 'Mapper',
    templateFile: 'mapper.hbs',
    subPackage: 'mapper',
    options: [
      { key: 'genComment', label: '文档注释', type: 'checkbox', default: true }
    ]
  },
  {
    key: 'mapperXML',
    name: 'XML',
    templateFile: 'mapperXml.hbs',
    options: []
  },
  {
    key: 'service',
    name: 'Service',
    templateFile: 'javaService.hbs',
    subPackage: 'service',
    options: [
      { key: 'genComment', label: '文档注释', type: 'checkbox', default: true }
    ]
  },
  {
    key: 'controller',
    name: 'Controller',
    templateFile: 'javaController.hbs',
    subPackage: 'controller',
    options: [
      { key: 'genComment', label: '文档注释', type: 'checkbox', default: true },
      { key: 'genSwagger', label: 'Swagger注解', type: 'checkbox', default: true }
    ]
  },
];

/**
 * 模板助手函数配置
 */
export const templateHelpers = {
  upperCamelTableName: function(tableName) {
    return this.$strUtil.snakeToUpperCamel(tableName);
  },
  lowerCamelTableName: function(tableName) {
    return this.$strUtil.snakeToCamel(tableName);
  },
  camelFieldName: function(string) {
    return this.$strUtil.snakeToCamel(string);
  },
  // 获取当前时间戳
  timestamp: function() {
    return new Date().toISOString();
  },
  // 判断是否为字符串类型
  isString: function(javaType) {
    return javaType === 'String';
  },
  // 获取JDBC类型
  jdbcType: function(mysqlType) {
    const typeMap = {
      'varchar': 'VARCHAR',
      'char': 'CHAR',
      'text': 'LONGVARCHAR',
      'longtext': 'LONGVARCHAR',
      'mediumtext': 'LONGVARCHAR',
      'int': 'INTEGER',
      'tinyint': 'TINYINT',
      'smallint': 'SMALLINT',
      'mediumint': 'INTEGER',
      'bigint': 'BIGINT',
      'float': 'FLOAT',
      'double': 'DOUBLE',
      'decimal': 'DECIMAL',
      'date': 'DATE',
      'datetime': 'TIMESTAMP',
      'timestamp': 'TIMESTAMP',
      'time': 'TIME',
      'year': 'INTEGER',
      'bit': 'BIT',
      'boolean': 'BOOLEAN',
      'blob': 'BLOB',
      'longblob': 'BLOB',
      'mediumblob': 'BLOB',
      'binary': 'BINARY',
      'varbinary': 'VARBINARY'
    };
    return typeMap[mysqlType] || 'VARCHAR';
  },
  // 查找主键字段
  findPrimaryKey: function(fields) {
    if (!fields || !Array.isArray(fields)) {
      return null;
    }
    return fields.find(field => field.isPrimaryKey) || fields[0];
  },
  // 生成完整包名
  fullPackage: function(basePackage, subPackage) {
    if (!basePackage) return '';

    // 如果subPackage是一个函数，调用它获取二级包名
    if (typeof subPackage === 'function') {
      subPackage = subPackage();
    }

    if (!subPackage) return basePackage;
    return `${basePackage}.${subPackage}`;
  },
  // 获取子包名
  getSubPackage: function(subPackage) {
    return subPackage || '';
  }
};

export default {
  templateConfigs,
  templateHelpers
};
