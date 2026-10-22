import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['dist/**', 'runtime/**', 'node_modules/**', '.local/**'] }, js.configs.recommended, ...ts.configs.recommended, {files:['server.cjs','scripts/*.mjs'],languageOptions:{globals:{process:'readonly',console:'readonly',Buffer:'readonly',URL:'readonly',fetch:'readonly',AbortSignal:'readonly',__dirname:'readonly'}}}, { rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } });
