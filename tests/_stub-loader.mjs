/**
 * 测试用 ESM 加载器：把仍在 services 里直接依赖原生模块的文件替换成桩，
 * 这样在 Node 里 import 它们时不会去加载 react-native / expo-*（它们在 Node 下
 * 无法运行，且 expo-file-system 的子路径会触发 node_modules 的 TS 类型剥离限制）。
 *
 * 注意：**存储（chat-storage）已经不走这里了** —— 它只依赖
 * src/services/key-value-store.ts 里的契约，测试通过 setStorageBackend() 注入
 * tests/_memory-stores.ts 的内存实现，所以那部分逻辑不再需要任何桩，
 * 平台分支也真正被「选择」而不是被钉死。
 *
 * 仍留在下面的，是附件 / 导出 / 转写 / 朗读这几个必须直接调原生能力的模块。
 * 它们的桩把 Platform.OS 设为 'web'，因此这些模块的原生分支依然不被覆盖。
 */
const STUBS = {
  'react-native': `export const Platform = { OS: 'web' };`,
  'expo-file-system/legacy': `export {};`,
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
  // 这里刻意不再「给无扩展名相对导入补 .ts」：services / constants 已统一写全扩展名，
  // 与其在加载器里悄悄兜底，不如让遗漏在测试里直接报错（见 AGENTS.md「可测试层的写法」）。
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
