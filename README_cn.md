> 🌐 语言： [中文](README_cn.md) · [English](README.md)

# Sanity for Obsidian（中文版）

![Obsidian 与 Sanity 徽标](cover-image.png)

Sanity 是一款 Obsidian 插件，让你可以在 Obsidian 仓库与 Sanity Studio 之间**双向**发布和拉取文档。它支持完整的工作流：在 Obsidian 中写作并发布到 Sanity，或从 Sanity 把文档（包括草稿）拉回 Obsidian 阅读、编辑。

## 安装

**Sanity Publish 尚未上架社区插件市场。** 你可以手动安装，或通过 BRAT 安装。

### 方式 A — BRAT（推荐）

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，然后把它添加的 beta 插件仓库设为：
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. 启用 **Sanity Publish** 并打开其设置。

### 方式 B — 手动克隆

在仓库根目录下执行：

```
cd .obsidian/plugins && git clone https://github.com/violet27chen/sanity-obsidian-plugin.git
```

重启 Obsidian，然后在「设置 → 已安装插件」中启用。

## 设置

### Sanity API Token

具备**读写**权限的 Sanity 项目 API Token。生成方法见 [Sanity 令牌指南](https://www.sanity.io/docs/http-auth)。

> 提供此 Token 即表示你允许 Sanity Publish（以及仓库中其他已安装插件）代表你向 Studio 发布内容。

### Sanity Project ID

你的 Sanity 项目 ID。

### Sanity Dataset Name

要同步的数据集名称。默认为 `production`。

### Sanity Document Type Name

要同步的文档类型（如 `post` 或 `blog`）。默认 `post`。

### Sanity Title Field

代表标题的 schema 字段名。Sanity 会把这个字段同步进每篇笔记的 frontmatter（发布时也会写回）。留空则不同步标题。

### Sanity Body Field

代表正文的 schema 字段名。它应当存储原始 Markdown（如 `bodyMarkdown`）。Sanity 会把 Obsidian 文档内容同步到该字段。

### Filename field（文件名字段）

用于生成每篇 Obsidian 笔记文件名的 Sanity 字段（也就是访问路由 slug）。支持 GROQ 路径，例如 `slug.current`。留空时改用**标题字段**作为文件名。插件永远不会用文档的 `sanity_id` 当文件名。

### Pull folder（高级）

拉取的笔记保存到哪个文件夹。留空则保存到仓库根目录。

### Additional fields to sync（高级）

你还想保持同步的其他 Sanity 字段。每行一条，格式为 `sanityField:frontmatterKey`。支持 GROQ 路径，因此可以拉取嵌套值，例如 `slug.current:slug`。拉取时这些字段会写入每篇笔记的 frontmatter（图片引用会自动转换为 Sanity CDN URL）；发布时同样的 frontmatter 字段会写回 Sanity（CDN URL 会还原为资源引用）。

典型博客的示例：

```
slug.current:slug
description:description
publishedAt:published
tags:tags
category:category
image:image
```

留空则只同步标题与正文。

## 发布到 Sanity

打开一篇文档，在命令面板运行 **`Publish to Sanity`**。这会在你的 Sanity Studio 中创建或更新一篇草稿文档，并把 `sanity_id` 写入笔记的 frontmatter，使后续更新始终关联到同一个 Sanity 文档。

在嵌入图片上右键选择 **`Upload to Sanity`** 可将其上传到 Sanity CDN。发布时也会自动上传所有嵌入图片。

使用 **Content Divider（内容分隔符）** 设置，可以只发布标记线**以上**的内容。

## 从 Sanity 拉取

在命令面板运行 **`Pull from Sanity (sync all posts)`** 即可把 Sanity 文档同步进 Obsidian。该命令不需要打开任何文档。

- 拉取配置类型下的**全部**文档，**包含草稿**。
- 每篇笔记的 frontmatter 包含：
  - `sanity_id` —— 该文档的 Sanity `_id`，是往返同步的钥匙。之后对该笔记点「发布」会更新**同一个** Sanity 文档。
  - `sanity_draft: true | false` —— 标记来源是草稿（`drafts.*`）还是正式文档（`post.*`），一眼即可区分。
  - **标题** —— 配置好的标题字段会写入 frontmatter，因此拉回的笔记显示的是真实标题（发布时也会保留，而不会被文件名覆盖）。
  - **Additional fields** —— 在「Additional fields to sync」中列出的字段也会写入 frontmatter，并在发布时写回。
- 已存在的笔记（按 `sanity_id` 匹配）会原地更新，并保留你自行添加的其他 frontmatter 字段；新文档则新建，文件名依次取 **Filename field**（留空时取标题字段）。插件不会用 Sanity `_id` 当文件名。
- 若设置了 **Pull folder**，笔记保存到此文件夹；否则保存到仓库根目录。

由于插件写入了 `sanity_id`，整个工作流是完全往返的：拉取一篇文档、在 Obsidian 中编辑、再点发布，改动会推送回同一个 Sanity 文档。

## 说明

- 插件直接从 Obsidian 内部调用 Sanity HTTP API，因此无需在你的 Sanity 项目中额外配置 CORS。
- 拉取需要具有**读**权限的 Token；发布需要**写**权限。

## 参与贡献

欢迎提交 issue 与 pull request。
