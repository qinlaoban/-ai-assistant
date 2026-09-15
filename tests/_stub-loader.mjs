/**
 * 测试用 ESM 加载器：把 chat-storage 顶部依赖的三个原生模块替换成桩，
 * 这样在 Node 里 import chat-storage 时不会去加载 react-native /
 * expo-file-system / expo-secure-store（它们在 Node 下无法运行，
 * 且 expo-file-system 的子路径会触发 node_modules 的 TS 类型剥离限制）。
 *
 * 桩把 Platform.OS 设为 'web'，从而让 chat-storage 走 web 分支（localStorage），
 * 配合 tests/chat-storage.test.ts 里注入的内存 localStorage 即可测到真实读写逻辑。
 */
const STUBS = {
  'react-native': `export const Platform = { OS: 'web' };`,
  'expo-file-system/legacy': `export {};`,
  'expo-secure-store': `export {};`,
  // 导出模块（chat-export）在 Node 下也会被 import：只需桩住签名，纯函数部分才可测
  'expo-clipboard': `export async function setStringAsync() {}`,
  'expo-sharing': `export async function isAvailableAsync() { return false; }\nexport async function shareAsync() {}`,
  // 朗读模块（speech）同理：只测 toSpeechText 这个纯函数
  'expo-speech': `export function speak() {}\nexport async function stop() {}`,
  // 附件模块（attachments）同理：只测 isTextLike / guessImageMime 这类纯函数
  'expo-image-picker': `export async function requestMediaLibraryPermissionsAsync() { return { granted: false }; }\nexport async function requestCameraPermissionsAsync() { return { granted: false }; }\nexport async function launchImageLibraryAsync() { return { canceled: true, assets: null }; }\nexport async function launchCameraAsync() { return { canceled: true, assets: null }; }`,
  'expo-document-picker': `export async function getDocumentAsync() { return { canceled: true, assets: null }; }`,
};

export async function resolve(specifier, context, next) {
  if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
    return { url: `stub:${specifier}`, shortCircuit: true };
  }
  // chat-storage 用的是 Metro 风格的省略扩展名相对导入（如 '../constants/chat-params'），
  // Node 的 ESM 解析要求写全扩展名。这里给相对路径补上 .ts，使其能在 Node 下加载。
  if (specifier.startsWith('.') && !/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier)) {
    const parent = context.parentURL ?? import.meta.url;
    const url = new URL(`${specifier}.ts`, parent).href;
    return { url, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) {
    const spec = url.slice('stub:'.length);
    return {
      format: 'module',
      source: STUBS[spec],
      shortCircuit: true,
    };
  }
  return next(url, context);
}
