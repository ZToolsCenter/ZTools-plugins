import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import commonjs from '@rollup/plugin-commonjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(coreDir, '..');
const appDir = path.join(rootDir, 'app');
const testDir = path.join(rootDir, 'test');

const sharedPlugins = [
  resolve({
    preferBuiltins: false
  }),
  commonjs(),
  terser()
];

export default [
  {
    input: path.join(coreDir, 'calculator.js'),
    output: [
      {
        file: path.join(appDir, 'src', 'calculator.min.js'),
        format: 'iife',
        name: 'CodeCalcCore',
        sourcemap: false
      },
      {
        file: path.join(testDir, 'calculator.min.mjs'),
        format: 'es',
        sourcemap: false
      },
      {
        file: path.join(testDir, 'calculator.min.js'),
        format: 'iife',
        name: 'CodeCalcCore',
        sourcemap: false
      }
    ],
    plugins: sharedPlugins
  },
  {
    input: path.join(appDir, 'src', 'index.js'),
    output: {
      file: path.join(appDir, 'src', 'app.bundle.js'),
      format: 'iife',
      name: 'CodeCalcApp',
      sourcemap: false
    },
    plugins: sharedPlugins
  }
];
