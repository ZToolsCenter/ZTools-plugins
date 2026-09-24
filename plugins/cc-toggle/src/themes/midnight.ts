/**
 * 午夜深空主题 — 深蓝/午夜色调
 * 色系基于深蓝黑，类似 VS Code Dark+ 风格
 */
export const midnightTheme = {
  name: 'midnight',
  label: '午夜深空',

  colors: {
    light: {
      // 表面
      bg: '#f0f4f8',
      bgCard: '#ffffff',
      bgHover: '#e2e8f0',
      border: '#cbd5e1',
      // 文字
      text: '#0f172a',
      textSecondary: '#475569',
      textMuted: '#94a3b8',
      // 品牌色
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
      primaryPressed: '#1e40af',
      primarySuppl: 'rgba(37,99,235,0.1)',
      primaryLight: '#dbeafe',
      // 语义色
      danger: '#dc2626',
      dangerLight: '#fef2f2',
      success: '#16a34a'
    },
    dark: {
      bg: '#0d1117',
      bgCard: '#161b22',
      bgHover: '#1c2333',
      border: '#30363d',
      text: '#e6edf3',
      textSecondary: '#8b949e',
      textMuted: '#6e7681',
      primary: '#58a6ff',
      primaryHover: '#79c0ff',
      primaryPressed: '#388bfd',
      primarySuppl: 'rgba(88,166,255,0.15)',
      primaryLight: '#1a2332',
      danger: '#f85149',
      dangerLight: '#2d1214',
      success: '#3fb950'
    }
  },

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
