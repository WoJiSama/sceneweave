import parser from '@typescript-eslint/parser'

export default [{
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: { parser },
  rules: {
    'no-debugger': 'error',
    'no-duplicate-case': 'error',
    'no-sparse-arrays': 'error',
    'no-unsafe-finally': 'error',
  },
}]
