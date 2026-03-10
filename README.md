/**
 * @copyright Tomda (https://www.tomda.top)
 * @copyright UIED技术团队 (https://fsuied.com)
 * @author UIED技术团队
 * @createDate 2026-03-10
 */

# Web2HTML Studio Chrome插件

将网页内容捕获并转换为可编辑设计数据（面向 Figma/设计系统流程）。

## 功能特性

- 🎨 捕获网页 DOM 结构、布局和核心样式
- 🧩 支持树结构 + 扁平结构双输出
- 🖼️ 支持跨域图片代理抓取与资源嵌入
- 📥 一键下载 JSON 文件（可用于二次转换）
- 🧰 支持注入网页悬浮采集工具条

## 安装方法

1. 打开Chrome浏览器，进入 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目文件夹

## 使用方法

1. 点击浏览器工具栏中的插件图标
2. 在弹窗中点击“开始采集并下载 JSON”
3. 如需网页内操作，点击“注入网页悬浮工具条”
4. 采集完成后会下载 `web2html-studio-*.json`
5. 将 JSON 用于 Figma 插件或内部设计转换流程

## 技术栈

- Manifest V3
- Vanilla JavaScript
- Chrome Extension APIs（scripting/downloads/storage）
- 资源代理队列 + 会话缓存

## 项目结构

```
figma/
├── manifest.json       # 插件配置文件
├── popup.html         # 弹窗页面
├── popup.css          # 弹窗样式
├── popup.js           # 弹窗逻辑
├── content.js         # 采集引擎
├── runner.js          # 采集执行器
├── inpage-toolbar.js  # 网页悬浮工具条
├── background.js      # 后台服务
├── icons/             # 图标文件夹
└── README.md          # 说明文档
```

## 版权信息

© Tomda (https://www.tomda.top)  
© UIED技术团队 (https://fsuied.com)  
作者: UIED技术团队  
创建日期: 2026-03-10

## 许可证

MIT License
