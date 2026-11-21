const js = require('@eslint/js');
const globals = require('globals');

// Services Apps Script provides at runtime.
const appsScriptGlobals = Object.fromEntries(
  [
    'CacheService',
    'ContentService',
    'HtmlService',
    'LockService',
    'Logger',
    'PropertiesService',
    'Session',
    'SpreadsheetApp',
    'Utilities'
  ].map(name => [name, 'readonly'])
);

module.exports = [
  { ignores: ['node_modules/', 'docs/', 'test/preview.html'] },
  js.configs.recommended,
  {
    files: ['src/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...appsScriptGlobals, module: 'writable' }
    },
    rules: {
      // Every top-level function in a .gs file is a global the other files, menus,
      // triggers and google.script.run can call, so "unused" here is expected.
      'no-unused-vars': ['error', { vars: 'local', args: 'after-used', caughtErrors: 'none' }]
    }
  },
  {
    // Defined in Logic.gs.
    files: ['src/Code.gs'],
    languageOptions: { globals: { Logic: 'readonly' } }
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    // page.evaluate() callbacks run in the browser.
    files: ['test/e2e.test.js'],
    languageOptions: { globals: { ...globals.browser } }
  }
];
