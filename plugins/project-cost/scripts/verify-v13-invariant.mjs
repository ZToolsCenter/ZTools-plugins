import { SEED } from '../src/lib/seed.js';
import { calc, sumBudget, buildAlerts, catRows, checkup } from '../src/lib/core.js';
const c = calc(SEED);
const budget = sumBudget(SEED);
const alerts = buildAlerts(SEED);
const rows = catRows(SEED);
const chk = checkup(SEED);
const out = {
  payable: c.payable, paid: c.paid, remain_due: c.remain,
  estTotal: c.estTotal, confirmedPayable: c.confirmedPayable,
  budgetTotal: budget, balance: c.balance,
  overCount: c.overCount,
  alerts_over: alerts.over?.map(x=>x.cat) || alerts.over,
  alerts_near: alerts.near?.map(x=>x.cat) || alerts.near,
  chk_issues: chk.issues?.length ?? chk.length,
  check_confirmed: Math.abs((c.payable - c.estTotal) - c.confirmedPayable) < 0.005,
  check_due_full: Math.abs((c.payable - c.paid) - c.remain) < 0.005,
  check_budget: Math.abs(budget - 234688) < 0.005,
};
console.log(JSON.stringify(out, null, 2));
