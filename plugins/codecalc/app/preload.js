const CalcCode = require("./src/calculator.min.js");

// 从存储更新自定义函数与常数到 FUNCTIONS / CONSTANTS
CalcCode.updateCustomFromStorage(CalcCode.Calculator, CalcCode.FUNCTIONS, CalcCode.CONSTANTS);

window.CodeCalcCore = {
  Calculator: CalcCode.Calculator,
  OPERATORS: CalcCode.OPERATORS,
  FUNCTIONS: CalcCode.FUNCTIONS,
  CONSTANTS: CalcCode.CONSTANTS,
  updateCustomFromStorage: CalcCode.updateCustomFromStorage,
  isFunctionDefinition: CalcCode.isFunctionDefinition,
  isConstantDefinition: CalcCode.isConstantDefinition,
};