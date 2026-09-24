// 厂商余额查询模板（仅作为表单默认值，不做自动识别）
export interface BalanceTemplate {
  name: string;
  path: string;
  balancePath: string;
  usedPath?: string;
  balanceTransform?: string;
  currency: 'AUTO' | 'USD' | 'CNY';
}

export const BALANCE_TEMPLATES: BalanceTemplate[] = [
  {
    name: 'DeepSeek',
    path: '/user/balance',
    balancePath: 'balance_infos[0].total_balance',
    currency: 'AUTO'
  },
  {
    name: 'OpenAI 兼容中转（credit_grants）',
    path: '/v1/dashboard/billing/credit_grants',
    balancePath: 'total_available',
    usedPath: 'total_used',
    currency: 'USD'
  },
  {
    name: 'OpenAI 兼容中转（/v1/balance）',
    path: '/v1/balance',
    balancePath: 'balance',
    currency: 'AUTO'
  },
  {
    name: 'OneAPI / NewAPI',
    path: '/api/user/self',
    balancePath: 'quota',
    balanceTransform: 'divide:500000',
    currency: 'USD'
  },
  {
    name: '硅基流动 SiliconFlow',
    path: '/user/info',
    balancePath: 'data.userInfo.balanceUsd',
    currency: 'USD'
  },
  {
    name: 'OpenRouter',
    path: '/api/v1/auth/key',
    balancePath: 'data.limit',
    balanceTransform: 'subtract:data.usage',
    currency: 'USD'
  }
];
