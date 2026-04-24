window.services = {
  formatMybatisLog: function (input) {
    return formatMybatisLog(input);
  },
};

function formatMybatisLog(input) {
  var lines = input.split("\n");
  var preparingLine = null;
  var parametersLine = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("Preparing:") !== -1) {
      var idx = line.indexOf("Preparing:");
      preparingLine = line.substring(idx + "Preparing:".length).trim();
    }
    if (line.indexOf("Parameters:") !== -1) {
      var idx2 = line.indexOf("Parameters:");
      var paramStr = line.substring(idx2 + "Parameters:".length).trim();
      if (paramStr === "" || paramStr === "null") {
        parametersLine = [];
      } else {
        parametersLine = parseParameters(paramStr);
      }
    }
  }

  if (!preparingLine) {
    return { error: "未找到包含 Preparing: 的日志行，请检查输入是否为 MyBatis SQL 日志" };
  }

  var sql = preparingLine;

  if (parametersLine && parametersLine.length > 0) {
    var paramIndex = 0;
    sql = sql.replace(/\?/g, function () {
      if (paramIndex < parametersLine.length) {
        return parametersLine[paramIndex++];
      }
      return "?";
    });
  }

  var formattedSql = formatSql(sql);

  return {
    original: preparingLine,
    replaced: sql,
    formatted: formattedSql,
    paramCount: parametersLine ? parametersLine.length : 0,
  };
}

function parseParameters(paramStr) {
  var params = [];
  var current = "";
  var depth = 0;

  for (var i = 0; i < paramStr.length; i++) {
    var ch = paramStr[i];
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    params.push(current.trim());
  }

  return params.map(function (p) {
    return resolveParamValue(p);
  });
}

function resolveParamValue(param) {
  var match = param.match(/^(.*?)\((\w+)\)$/);
  if (!match) {
    return param === "null" ? "NULL" : "'" + escapeSql(param) + "'";
  }

  var value = match[1];
  var type = match[2].toLowerCase();

  if (value === "null") {
    return "NULL";
  }

  var stringTypes = [
    "string", "char", "varchar", "nvarchar", "longvarchar",
    "longnvarchar", "clob", "nclob", "text", "nchar",
    "date", "time", "timestamp", "localdate", "localtime",
    "localdatetime", "zoneddatetime", "offsetdatetime",
    "uuid", "bigdecimal", "boolean",
  ];

  var numericTypes = [
    "integer", "int", "long", "bigint", "short", "smallint",
    "tinyint", "float", "double", "decimal", "number", "numeric",
    "byte",
  ];

  var isNumeric = numericTypes.indexOf(type) !== -1;

  if (isNumeric) {
    return value;
  }

  return "'" + escapeSql(value) + "'";
}

function escapeSql(str) {
  return str.replace(/'/g, "''");
}

function formatSql(sql) {
  var keywords = [
    "SELECT", "FROM", "WHERE", "AND", "OR", "JOIN", "LEFT JOIN",
    "RIGHT JOIN", "INNER JOIN", "CROSS JOIN", "FULL JOIN", "ON",
    "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
    "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
    "CREATE TABLE", "ALTER TABLE", "DROP TABLE",
    "CASE", "WHEN", "THEN", "ELSE", "END",
    "IN", "NOT IN", "EXISTS", "NOT EXISTS",
    "IS NULL", "IS NOT NULL", "LIKE", "NOT LIKE",
    "BETWEEN", "NOT BETWEEN", "ASC", "DESC",
    "DISTINCT", "AS", "WITH",
  ];

  var result = sql;
  result = result.replace(/\s+/g, " ");

  var upperSql = result.toUpperCase();

  var indentKeywords = [
    "SELECT", "FROM", "WHERE", "AND", "OR",
    "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "CROSS JOIN", "FULL JOIN", "JOIN",
    "ON", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "UNION", "UNION ALL", "SET", "VALUES",
  ];

  var sortedKeywords = indentKeywords.slice().sort(function (a, b) {
    return b.length - a.length;
  });

  var parts = [result];
  var newParts = [];

  for (var ki = 0; ki < sortedKeywords.length; ki++) {
    var kw = sortedKeywords[ki];
    newParts = [];
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      var lowerPart = part.toLowerCase();
      var searchStr = " " + kw.toLowerCase() + " ";
      var searchIdx = lowerPart.indexOf(searchStr);

      if (searchIdx === -1) {
        newParts.push(part);
        continue;
      }

      var before = part.substring(0, searchIdx);
      var after = part.substring(searchIdx + kw.length + 2);
      if (before.trim()) {
        newParts.push(before.trim());
      }
      newParts.push("\n" + kw + " ");
      if (after.trim()) {
        newParts.push(after.trim());
      }
    }
    parts = newParts;
  }

  var formatted = parts.join("");

  formatted = formatted.replace(/,\s*/g, ",\n       ");

  formatted = formatted.replace(/^\s+|\s+$/g, "");

  return formatted;
}
