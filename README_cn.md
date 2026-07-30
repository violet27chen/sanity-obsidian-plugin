> 🌐 语言： [中文](README_cn.md) · [English](README.md)

# Sanity Publish for Obsidian（中文版）

![Obsidian 与 Sanity 徽标](cover-image.png)

Sanity Publish 是一款 Obsidian 插件，允许你把 Obsidian 仓库中的文档发布并同步到你的 Sanity Studio。

## ⬇️ 安装插件

**Sanity Publish 目前处于 alpha 阶段，尚未上架社区插件市场。** 因此，要把它装进你的 Obsidian 仓库，需要手动克隆仓库。在仓库根目录下执行以下命令即可：

> **说明：** 这是**已修复 CORS、支持双向同步的 fork 版本**。如需自动更新，推荐用 **BRAT** 安装（见底部 📦 章节）。

```
cd .obsidian/plugins && git clone https://github.com/violet27chen/sanity-obsidian-plugin.git
```

克隆到 `plugins` 文件夹后，重启 Obsidian 并进入「设置」。你应该在「已安装插件」列表中看到「Sanity Publish」。启用插件，然后进入插件设置继续配置。

## ⚙️ 插件设置

### Sanity API Token

要让 Obsidian 与你的 Sanity Studio 同步数据，必须提供一个具备**读写权限**的 Sanity 项目 API Token。生成令牌的[官方指南在此](https://www.sanity.io/docs/http-auth)。

**注意：** 提供此 Token 即表示你授权「Sanity Publish」以及仓库中**任何其他**已安装的 Obsidian 插件，代表你向 Studio 发布内容。请谨慎操作，确保你信任仓库中所有插件的作者。

### Sanity Project ID

把你的 Sanity 项目 ID 粘贴到此处。

### Sanity Dataset Name

指定要发布文档的数据集名称。默认为 `production`。

### Sanity Document Type Name

指定你 Sanity 项目 schema 中要发布到的文档类型名称（如 `post` 或 `blog`）。

### Sanity Title Field

指定 schema 中表示 `title` 的字段名。Sanity Publish 会把 Obsidian 中的文件名与该字段同步。如果不想同步文件名，可留空。

### Sanity Body Field

指定与文档正文对应的字段名。Sanity Publish 会把 Obsidian 文档内容同步到 Studio 中的该字段。

## 🙌 点击发布

配置好插件设置后，打开你想发布的文档，调出命令面板，搜索 `Sanity Publish`。

回车会在你的 Sanity Studio 中**创建或更新一篇草稿**文档，同时把 `sanity_id` 写入 Obsidian 文件的 frontmatter，方便后续更新。

**注意：** 修改或删除这个 `sanity_id` 可能带来意外后果。不过，在 Studio 中正式发布该文档后，把这个 ID 字段改成正式文档的 ID 会非常有用——这样你就能直接从 Obsidian 更新已发布文档的标题和正文了！

## 🌄 上传图片

Sanity Publish 还有一个方便的特性：可以从 Obsidian 向 Sanity 上传图片。在 Obsidian 文档中右键点击嵌入的图片，选择 `Upload to Sanity` 菜单项，图片会自动上传，文档内容也会改成链接到 Sanity CDN。

发布文档时，我们会自动对所有嵌入图片执行此操作。

## 🤓 高级设置

如果你像我一样，写文章时常把旧草稿、暂存内容放在文档下方的注释后面，大概是这样：

```md
要发布的内容

<!-- DRAFTS -->

不想发布的内容
```

为此，Sanity Publish 支持设置一个「内容分隔符（Content Divider）」字符串。粘贴你常用的分隔注释文本，发布时只有分隔线**以上**的内容会被发布到 Sanity。

## 🙏 参与贡献

Sanity Publish 目前基本是我个人发布流程的玩具项目。不过，如果你用着觉得有用、遇到 bug 或有新点子，欢迎在 GitHub 上提 issue。

---

# 🔄 双向同步：从 Sanity 拉取（本 fork 新增）

本 fork 新增了 **Pull（拉取）** 命令，让 Obsidian 也能与你的 Sanity Studio 保持同步，而不只是单向「发布到」Sanity。

打开命令面板，运行 **`Pull from Sanity (sync all posts)`**。该命令**不需要**打开任何文档，会扫描你的整个仓库。

它做了什么：

- 查询 Sanity 中配置类型（默认 `post`）的**全部**文档，**包含草稿**。
- 把每篇文档写成一条 Markdown 笔记存入仓库：
  - **文件名**：优先用 `slug.current`，否则用 title 字段，再否则用 Sanity 的 `_id`。非法文件名字符会被清理。
  - **Frontmatter** 始终包含：
    - `sanity_id: <_id>` —— 往返同步的钥匙。之后对该笔记点「发布」会 patch 同一个 Sanity 文档。
    - `sanity_draft: true | false` —— **用来区分草稿与正式文档**。草稿（`drafts.*`）标记为 `sanity_draft: true`；正式文档（`post.*`）标记为 `sanity_draft: false`。
- **去重**：若仓库中已存在相同 `sanity_id` 的笔记，则原地更新（正文 + `sanity_draft` 标记），并保留你自行添加的其他 frontmatter 字段。新文档则新建；文件名冲突时追加数字后缀。

### 拉取文件夹（高级设置）

新增的 **`Pull folder`** 设置用于控制拉取的笔记保存到哪个文件夹。留空则保存到**仓库根目录**（默认）。设为例如 `Sanity` 可把拉取的文章归入专属文件夹。

### 行为说明

- 拉取得到的**草稿**（`sanity_draft: true`，`sanity_id: drafts.xxx`）→ 编辑后点「发布」会更新 Sanity 草稿（**不会**触发你的部署 Webhook；需在管理后台点「发布」才能真正上线）。
- 拉取得到的**正式文档**（`sanity_draft: false`，`sanity_id: post.xxx`）→ 编辑后点「发布」会更新线上文档，并**会**触发你的部署 Webhook。

这与单向发布的设计一致：Obsidian 插件负责创建/更新草稿，真正上线由你的 Sanity 管理后台处理。

---

# 🛡️ CORS 修复（本 fork）

原版插件用 `@sanity/client`（浏览器 `fetch`）直连 Sanity API。在 Obsidian 内部，请求来源是 `app://obsidian.md`，被浏览器视为跨域。而 Sanity 的 CORS 设置**不接受 `app://` 协议**，无法加白名单，导致每次发布都报：

```
from origin 'app://obsidian.md' has been blocked by CORS policy
```

本 fork 把两个 HTTP 方法改写为使用 Obsidian 自带的 **`requestUrl`**，由桌面应用直接调用 Sanity HTTP API，彻底绕开浏览器 CORS，无需在 Sanity 配置任何 CORS 白名单。

- `uploadFileToSanity` → `POST …/assets/images|files/<dataset>?filename=`（二进制直传）
- `createorUpdateDocument` → `POST …/data/mutate/<dataset>`（create / patch 事务）
- 新增 `sanityMutate()` 辅助函数
- 新建文档生成合法 draft id（`drafts.<随机>`），避免上游 `drafts.` 被拒

---

# 📦 通过 BRAT 安装本 fork

长期使用建议通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装这个已修复 CORS、支持双向同步的 fork：

1. 从社区插件安装 BRAT，然后添加 beta 插件仓库：
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. BRAT 会自动识别最新 Release（如 `v1.1.0`）。启用 **Sanity Publish** 并配置你的 Token / Project ID / Dataset / 字段。
3. 拉取或发布时，打开命令面板运行 `Pull from Sanity (sync all posts)` 或 `Publish to Sanity`。

Release 会打 Tag（如 `v1.1.0`）并附带 `main.js`、`manifest.json`、`manifest-beta.json`、`styles.css`，因此 BRAT 永远不会回退到未打补丁的上游构建。
