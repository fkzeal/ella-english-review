# 猫咪插画

为 Ella 英语练习站重新生成的六只水彩幼猫，替换旧 CSS / SVG 几何猫咪。

视觉调研参考：
- Mofusand 官方：https://mofusand-anime.jp/ （幼猫比例、毛绒轮廓与姿势）
- Pusheen 官方角色页：https://pusheen.com/pages/characters （轮廓简洁、角色辨识度）

参考站图片仅供调研，没有打包进应用。最终素材由图像生成工具生成，
源图为 `../kitten-illustration-sheet.jpg`，按三列两行裁切、等比缩放、
加白色留边后输出为六张 600×600 WebP。

花色顺序：ginger、tuxedo、calico、gray、siamese、cream。
首页和答对奖励使用同一套素材；构建将 WebP 复制到 dist，并在单文件版中
内嵌为 data URI，离线预览不依赖外网图片。
