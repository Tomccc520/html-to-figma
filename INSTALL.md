/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 * 
 * 安装说明
 */

# 安装步骤

## 1. 准备图标文件

本版本未强制配置 icons 字段，可先直接安装使用。  
如果你希望浏览器工具栏显示自定义图标，建议准备以下 PNG 文件：
- icon16.png (16x16像素)
- icon48.png (48x48像素)  
- icon128.png (128x128像素)

可放在 `icons/` 目录，并在 `manifest.json` 的 `icons` 字段中启用。

## 2. 加载插件到Chrome

1. 打开Chrome浏览器
2. 在地址栏输入：`chrome://extensions/`
3. 打开右上角的"开发者模式"开关
4. 点击"加载已解压的扩展程序"按钮
5. 选择本项目文件夹（figma文件夹）
6. 插件安装完成（显示名称：Web2HTML Studio）！

## 3. 使用插件

1. 访问任意网页
2. 点击浏览器工具栏中的插件图标
3. 在弹窗中点击“开始采集并下载 JSON”
4. 采集完成后会自动下载 `web2html-studio-*.json`
5. 如果想在网页中持续操作，点击“注入网页悬浮工具条”
6. 将 JSON 用于 Figma 插件或你的设计转换链路

## 常见问题

### Q: 插件无法加载？
A: 检查manifest.json文件格式是否正确，确保所有文件都在正确位置。

### Q: 点击捕获没反应？
A: 打开Chrome开发者工具（F12），查看Console中的错误信息。

### Q: 无法在Figma中粘贴？
A: 当前版本输出为 JSON 下载文件，不是直接粘贴格式。请在你自己的 Figma 导入插件或转换脚本中使用该文件。

## 下一步优化

- [ ] 添加PNG图标
- [ ] 优化Figma数据格式
- [ ] 添加更多样式捕获
- [ ] 支持更多资源类型（SVG/字体）嵌入
- [ ] 添加配置选项
