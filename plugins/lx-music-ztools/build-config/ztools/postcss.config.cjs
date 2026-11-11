// Restore the upstream LX sizing contract (323e4bac / postcss.config.js).
// Font-size settings change the root rem size; typography and spacing must use rem.
const pxtorem = require('postcss-pxtorem')
module.exports = {
  plugins: [pxtorem({
    rootValue: 16,
    unitPrecision: 5,
    propList: [
      'font', 'font-size', 'letter-spacing',
      'padding', 'margin', 'padding-*', 'margin-*',
      'height', 'width', '*-height', '*-width',
      'flex', '::-webkit-scrollbar', 'top', 'left', 'bottom', 'right',
      'border-radius', 'gap',
    ],
    selectorBlackList: ['html', 'ignore-to-rem'],
    replace: true,
    mediaQuery: false,
    minPixelValue: 0,
    // pxtorem 6 accepts a RegExp, not an array; keep dependency styles untouched.
    exclude: /node_modules/i,
  })],
}
