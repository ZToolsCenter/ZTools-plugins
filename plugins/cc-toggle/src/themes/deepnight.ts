/**
 * 深夜模式主题 — VS Code Dark+ 风格
 * 始终深色，不跟随系统偏好
 */
export const deepnightTheme = {
  name: 'deepnight',
  label: '深夜模式',

  colors: {
    // light 和 dark 使用相同的深色配色，确保始终为深色
    light: {
      bg: '#1e1e1e',
      bgCard: '#252526',
      bgHover: '#2a2d2e',
      border: '#3c3c3c',
      text: '#cccccc',
      textSecondary: '#969696',
      textMuted: '#6a6a6a',
      primary: '#007acc',
      primaryHover: '#1a8ad4',
      primaryPressed: '#005f9e',
      primarySuppl: 'rgba(0,122,204,0.15)',
      primaryLight: '#1e2d3d',
      danger: '#f14c4c',
      dangerLight: '#2d1a1a',
      success: '#73c991'
    },
    dark: {
      bg: '#1e1e1e',
      bgCard: '#252526',
      bgHover: '#2a2d2e',
      border: '#3c3c3c',
      text: '#cccccc',
      textSecondary: '#969696',
      textMuted: '#6a6a6a',
      primary: '#007acc',
      primaryHover: '#1a8ad4',
      primaryPressed: '#005f9e',
      primarySuppl: 'rgba(0,122,204,0.15)',
      primaryLight: '#1e2d3d',
      danger: '#f14c4c',
      dangerLight: '#2d1a1a',
      success: '#73c991'
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
      boxShadow: '0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)'
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
