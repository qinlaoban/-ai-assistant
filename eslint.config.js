const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  // .expo 是 expo 生成的路由类型等缓存，dist 是构建产物，两者都不该被 lint
  globalIgnores(['dist/*', '.expo/*']),
  expoConfig,
]);
