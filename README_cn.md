> 🌐 语言： [中文](README_cn.md) · [English](README.md)

# Sanity for Obsidian（中文版）

![Obsidian 与 Sanity 徽标](cover-image.png)

Sanity 是一款 Obsidian 插件，让你可以在 Obsidian 仓库与 Sanity Studio 之间**双向**发布和拉取文档——**通用同步，不绑定任何特定博客或网站**。

- 在 Obsidian 中写作并发布到 Sanity，生成的是**正式文档**。
- 从 Sanity 把文档拉回 Obsidian 阅读、编辑。
- 一切由插件设置驱动，适配你自定义的任意 schema。

## 安装

本插件**尚未上架社区插件市场**，可手动安装或通过 BRAT 安装。

### 方式 A — BRAT（推荐）

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，然后把它添加的 beta 插件仓库设为：
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. 启用 **Sanity** 并打开其设置。

### 方式 B — 手动克隆

在仓库根目录下执行：

```
cd .obsidian/plugins && git clone https://github.com/violet27chen/sanity-obsidian-plugin.git
```

重启 Obsidian，然后在「设置 → 已安装插件」中启用。

## 设置

打开 **设置 → Sanity**。各项填法如下。

| 设置项 | 默认 | 填什么 |
|---|---|---|
| **Sanity API token** | 空 | 具备 **Editor（或 Admin）角色** 的 Sanity token。**只读（Viewer）token 会在发布时报 `403 insufficientPermissions (update)`**。在 sanity.io → 项目 → API → Tokens 生成。 |
| **Project ID** | 空 | 你的 Sanity 项目 ID（如 `3hwpvo77`）。 |
| **Dataset name** | `production` | 要同步的数据集。 |
| **Type name** | `post` | 要同步的文档类型（如 `post`、`blog`）。 |
| **Title field** | 空 | 标题对应的 schema 字段名。留空则不单独同步标题。 |
| **Body field** | `body` | 正文对应的 schema 字段名（存原始 Markdown）。 |
| **Filename field** | 空 | 生成 Obsidian 文件名 / slug 用的 Sanity 字段。支持 GROQ 路径如 `slug.current`。留空 → 回退 **标题字段** → `slug.current` → `sanity_id`。 |
| **Content divider** | 空 | 分隔符，正文里它**以下**的内容不会被发布。 |
| **Pull folder** | 空 | 拉取笔记存放的文件夹。留空 → 库根。 |
| **Custom API base URL** | 空 | 当 `api.sanity.io` 不可达时（如中国大陆）填反代地址，所有 query/mutate/upload 都走它。留空用默认域名。 |
| **Additional fields to sync** | 空 | 额外 Sanity 字段 ↔ frontmatter 映射（见下）。 |
| **公告 text / link / type** | 空 / `info` | 网站公告，由「Publish announcement to Sanity」命令使用。text 留空则不显示。 |

### Additional fields to sync（额外字段同步）—— 怎么填

这是最灵活的设置，把任意 Sanity 字段映射到每篇笔记的 frontmatter（发布时写回）。

- **格式：** 每行一个字段 —— `Sanity字段 : frontmatter键`。
  - **左列** = Sanity 字段名，支持 GROQ 路径，如 `slug.current`、`heroImage`。
  - **右列** = 对应的 frontmatter 键。留空则直接复用左列字段名作为键。
- 最多 **10 行**，空行忽略。
- **拉取：** 这些 Sanity 字段写入笔记 frontmatter（image object 自动转为 Sanity CDN URL）。
- **发布：** 同样的 frontmatter 键写回 Sanity（CDN URL 还原为资源引用；本地图片路径 / `[[ ]]` 自动上传）。
- 点号路径（如 `slug.current`）在写回时展开为嵌套对象（`slug: { current: "..." }`）。

> 💡 **封面图 ≠ 正文图**
> 封面请用 `heroImage:heroImage`（字段里的 Sanity `image` object 在此处理）。
> 正文里的图片（`![[图]]` 或 `![alt](图)`）会在发布时**自动上传**，无需在此配置一行。

典型博客示例（左 → 右）：

```
slug.current   →   slug
description     →   description
publishedAt     →   published
categories      →   categories
series          →   series
heroImage       →   heroImage
```

删掉所有行（或全部留空）则只同步标题与正文。

### Custom API base URL（反代 / 翻墙）

插件默认访问 `https://<projectId>.api.sanity.io`。在部分网络（如中国大陆）下该域名无法连通，而 Sanity CDN（`cdn.sanity.io`）仍可访问。在此填入反代地址（例如 `https://sanity-api.your-domain.com`），**所有** API 调用（query / mutate / upload）都会走该代理，代理之后的路径保持不变，其余逻辑无需改动。留空则用默认域名。

## 笔记 frontmatter —— 插件读写哪些属性

| frontmatter 键 | 由谁写 | 含义 / 怎么用 |
|---|---|---|
| `sanity_id` | 插件（自动） | 文档的 Sanity `_id`，往返同步的钥匙。之后对该笔记点发布会更新**同一个** Sanity 文档。**勿手填**。若指向 `drafts.x`，发布会落到对应正式文档 `x` 并删除草稿。 |
| `sanity_draft` | 插件（自动） | `true`/`false`，标记来源是否为草稿。由 Pull 写入；发布逻辑不消费。 |
| 标题字段（如 `title`） | 你 / 插件 | 标题。发布优先取它，缺失回退文件名。 |
| 正文字段（如 `body`） | 插件 | 文档正文（原始 Markdown）。 |
| sync 字段键（如 `series`、`categories`、`slug`、`heroImage`） | 你 / 插件 | 由「Additional fields to sync」映射。发布写回 Sanity，拉取填回。 |
| `heroImage`（封面） | 你 | 本地图片路径（`[[ ]]` 可包裹）或 `cdn.sanity.io` URL。自动上传 / 还原引用。 |

> 正文图片（`![[图]]` / `![alt](图)`）在发布时自动上传并替换为 CDN URL，无需 frontmatter 键。

## 命令

打开命令面板（Ctrl/Cmd + P），搜索 **Sanity**：

- **Publish to Sanity** —— 为当前笔记创建或更新 Sanity 文档。成功后把 `sanity_id` 写入笔记。发布生成的是**正式文档**，并删除同名的草稿。
- **Pull from Sanity (sync all posts)** —— 把配置类型下的**全部正式文档**拉进 Obsidian（**不含草稿**）。无需打开文档。
- **Publish announcement to Sanity** —— 把「网站公告」设置推送到 `siteSettings` 单例。

## 工作流

### 发布一篇笔记

1. 填好 frontmatter（标题，以及任意 sync 字段如 `heroImage`、`categories`）。
2. 正文里用 `![[图]]` 或 `![alt](路径)` 放图。
3. 运行 **Publish to Sanity**。
4. 插件上传图片、把文档作为**正式文档**发出，并把 `sanity_id` 写回 frontmatter。

### 从 Sanity 拉取全部

1. 运行 **Pull from Sanity (sync all posts)**。
2. 笔记在 **Pull folder**（或库根）创建/更新，每篇带 `sanity_id`、`sanity_draft`、标题及所有配置的 sync 字段。
3. 编辑拉回的笔记再点 **Publish to Sanity**，改动会推回同一个 Sanity 文档。

## 说明与注意

- 插件直接从 Obsidian 内部调用 Sanity HTTP API，因此**无需在 Sanity 项目里配置 CORS**。
- API token 需要 **Editor（或 Admin）角色**——只读 token 会在发布时导致 `403 insufficientPermissions (update)`。
- 发布生成**正式文档**并**删除草稿**（若存在），避免草稿/正式重复。
- **Pull 不含草稿**（`drafts.*` 已排除），只把正式文档拉进 Obsidian。
- 移动端（iOS/Android）完整支持：插件只用 Obsidian 自带 YAML API，无任何依赖 Node 全局的 npm 包。
- 用 **Content divider** 可只发布标记线以上的内容。

## 参与贡献

欢迎提交 issue 与 pull request。
