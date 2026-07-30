# Sanity Publish for Obsidian（CORS 绕过补丁 Fork）

> ⚠️ **本仓库是 [drewlyton/sanity-obsidian-plugin](https://github.com/drewlyton/sanity-obsidian-plugin) 的补丁 fork。**
> 仅做一处关键修复：**绕过浏览器 CORS，使 Obsidian 能直接把笔记发布到 Sanity**，无需在 Sanity 配置 CORS 白名单（Sanity 不支持 `app://` 来源）。
> 其余功能与原版完全一致。

## 为什么需要这个补丁

原版插件使用 `@sanity/client`（浏览器 `fetch`）直连 Sanity API，请求来源是
`app://obsidian.md`，被浏览器识别为跨域。而 Sanity 的 CORS 配置界面**不接受
`app://` 协议**，无法加白名单，导致 Publish 必然报错：

```
from origin 'app://obsidian.md' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present
```

## 补丁做了什么

`main.ts` 中两个 HTTP 方法改为使用 Obsidian 自带的 `requestUrl`（Electron 主进程
请求，不受浏览器 CORS 限制）直连 Sanity HTTP API：

- `uploadFileToSanity`：改用 `…/assets/images|files/<dataset>?filename=` 直传二进制
- `createorUpdateDocument`：改用 `…/data/mutate/<dataset>` 发送 create / patch 事务
- 新增 `sanityMutate()` 辅助函数
- 新建文档生成合法 draft id（`drafts.<随机>`，修复原版 `drafts.` 会被 Sanity 拒绝的问题）

## 通过 BRAT 安装（推荐，一劳永逸）

本 fork 已将构建产物 `main.js` 纳入版本库（原版 `.gitignore` 排除了它），因此可直接用
BRAT 从本仓库安装，不再受上游覆盖影响。

1. Obsidian → 社区插件市场 → 安装 **BRAT**
2. 打开 BRAT 设置 → `Add a beta plugin`
3. 仓库地址填：`violet27chen/sanity-obsidian-plugin`
4. 启用 **Sanity Publish** 插件
5. 配置插件（见下）

> 如果你之前装的是原版（`drewlyton/...`），请先在 BRAT 里移除原版仓库，再添加本 fork，
> 避免 BRAT 拉回 CORS 损坏的原版。

## 插件设置（必填）

| 项 | 值 |
|---|---|
| Sanity API token | 具备 `3hwpvo77` 读写权限的 token |
| Project ID | `3hwpvo77` |
| Type name | `post` |
| Title field | `title` |
| Body field | `bodyMarkdown` |
| Content divider | 留空 |

正文以**原始 Markdown** 写入 `bodyMarkdown`，与博客同步脚本读取的字段一致；内嵌图片
在发布时自动上传 Sanity CDN 并改写链接。

## 写作 → 发布流程

1. Obsidian 写笔记（文件名即标题）
2. 命令面板 → **Publish to Sanity** → 笔记以草稿（`drafts.`）写入 Sanity
3. 打开编辑后台 `https://admin.violet27chen.com` → 草稿出现 → 补全 `slug` 等字段 → 点「发布」
4. 网站 2–3 分钟后自动重建更新

## 本地构建

```bash
npm install
npm run build      # 生成 main.js
```
