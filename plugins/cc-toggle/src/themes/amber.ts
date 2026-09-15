/**
 * 琥珀暖光主题 — 当前默认主题
 * 色系基于 Tailwind Amber/Brown，营造温暖柔和的视觉感受
 */
export const amberTheme = {
  name: 'amber',
  label: '琥珀暖光',

  colors: {
    light: {
      // 表面
      bg: '#fffbf5',
      bgCard: '#fff8f0',
      bgHover: '#fef3e2',
      border: '#f0dcc8',
      // 文字
      text: '#1c1410',
      textSecondary: '#6b5a4e',
      textMuted: '#9a8a7e',
      // 品牌色
      primary: '#d97706',
      primaryHover: '#b45309',
      primaryPressed: '#92400e',
      primarySuppl: 'rgba(217,119,6,0.1)',
      primaryLight: '#fef3c7',
      // 语义色
      danger: '#dc2626',
      dangerLight: '#fef2f2',
      success: '#16a34a'
    },
    dark: {
      bg: '#1a1410',
      bgCard: '#231e18',
      bgHover: '#2e2720',
      border: '#3d342a',
      text: '#f5efe8',
      textSecondary: '#c4b5a5',
      textMuted: '#8a7a6a',
      primary: '#f59e0b',
      primaryHover: '#fbbf24',
      primaryPressed: '#d97706',
      primarySuppl: 'rgba(245,158,11,0.15)',
      primaryLight: '#3d2e10',
      danger: '#f87171',
      dangerLight: '#3b1a1a',
      success: '#34d399'
    }
  },

  /** 组件级样式配置（与颜色无关的排版、圆角等） */
  components: {
    common: {
      borderRadius: '8px',
      borderRadiusSmall: '6px',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: '13px',
      fontSizeMini: '11px',
      fontSizeTiny: '11px',
      fontSizeSmall: '12px',
      fontSizeMedium: '13px',
      fontSizeLarge: '14px',
      heightMini: '24px',
      heightTiny: '28px',
      heightSmall: '32px',
      heightMedium: '34px',
      heightLarge: '40px'
    },
    Card: {
      borderRadius: '8px',
      titleFontWeight: '600',
      titleFontSize: '13px',
      paddingSmall: '12px 14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'
    },
    Button: {
      borderRadiusMedium: '6px',
      borderRadiusSmall: '6px',
      fontWeight: '500',
      paddingSmall: '0 14px',
      paddingMedium: '0 18px'
    },
    Input: { borderRadius: '6px' },
    InputNumber: { borderRadius: '6px' },
    Tag: { borderRadius: '12px', fontWeight: '500' },
    Alert: { borderRadius: '8px' },
    Statistic: {
      labelFontWeight: '500',
      labelFontSize: '11px',
      valueFontWeight: '700',
      valueFontSize: '18px'
    },
    Descriptions: { labelFontWeight: '500' },
    Code: { borderRadius: '6px' }
  }
};
