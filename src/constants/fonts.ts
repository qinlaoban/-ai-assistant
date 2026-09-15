/**
 * 字体来源。
 *
 * 仓库里没有字体二进制文件，原生端只能运行时从 CDN 拉取。这里选 Google Fonts 官方仓库的
 * jsDelivr 镜像，拿到的是**可变字体**（wght 轴覆盖 ExtraLight~ExtraBold）：一个文件就能承担
 * 400/500/600/700 四个字重，比按字重分别下载省得多。
 *
 * 加载**不阻塞**首屏：字体只影响观感，拿到之前用系统字体显示完全可读；拉取失败也只是静默
 * 回退系统字体，功能不受影响（应用本身就跑在网络上）。
 *
 * 若以后能提供 `assets/fonts/*.ttf`，应改为 `require()` 本地加载，并优先于这里的远程地址。
 */
export const SANS_FONT_FAMILY = 'Plus Jakarta Sans';

export const SANS_FONT_SOURCES = {
  [SANS_FONT_FAMILY]:
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf',
};
