import {
	SanityClient,
	createClient as createSanityClient,
} from "@sanity/client";
import {
	DEFAULT_SETTINGS,
	SanityPluginSettings,
	SanitySettingTab,
} from "SanitySettingTab";
import matter from "gray-matter";
import mime from "mime";
import {
	FileSystemAdapter,
	MarkdownView,
	Notice,
	Plugin,
	requestUrl,
	TFile,
	setIcon,
} from "obsidian";

const httpRegex =
	/^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)$/;

// Sanity API 版本，与原有 client 保持一致
const API_VERSION = "2023-05-03";
// 查询接口使用与 admin-worker 一致的版本（v2021-06-07），类型内联进 GROQ，
// 不使用 $param —— 否则在部分环境下会触发 Sanity 返回 HTTP 400。
const QUERY_API_VERSION = "v2021-06-07";

/**
 * 返回 Sanity API 的基础 URL。
 * 若设置了自定义 API 域名（如反向代理），优先使用它；
 * 否则回退到默认的 `https://<projectId>.api.sanity.io`。
 * 该设置用于绕过部分网络环境下 api.sanity.io 不可达的问题（如中国大陆）。
 */
function apiBaseFor(settings: SanityPluginSettings): string {
	const custom = settings.sanityApiBaseUrl?.trim().replace(/\/+$/, "");
	return custom || `https://${settings.projectId}.api.sanity.io`;
}

/**
 * 从 Sanity 的错误响应里提取人类可读的原因。
 * Sanity 出错时返回 `{ error: { description, items:[{error:{type,...}}], type } }`，
 * 直接把 HTTP 状态码抛给用户毫无信息量（例如 patch 一个已删除的文档会得到裸 404）。
 */
function sanityErrorText(res: { status: number; text?: string; json?: any }): string {
	const err = res.json?.error;
	const desc =
		(typeof err === "string" ? err : err?.description) ||
		res.json?.message ||
		res.text;
	const itemType = err?.items?.[0]?.error?.type;
	const detail = desc ? String(desc).slice(0, 400) : "(无响应体)";
	return itemType ? `${detail} [${itemType}]` : detail;
}

/**
 * 用 Obsidian 的 requestUrl 直连 Sanity，绕过浏览器的 CORS 限制
 * （Obsidian webview 来源 app://obsidian.md 不被 Sanity CORS 接受）。
 *
 * 注意必须带 `throw: false`：否则 requestUrl 在 status>=400 时自己先抛
 * `Request failed, status 404`，下面读取错误体的分支永远执行不到，
 * 用户只能看到一个裸状态码。
 */
async function sanityMutate(
	mutations: unknown[],
	settings: SanityPluginSettings
): Promise<any> {
	const url =
		`${apiBaseFor(settings)}/v${API_VERSION}/data/mutate/` +
		`${settings.dataset}?returnIds=true&returnDocuments=true&visibility=sync`;
	const res = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.apiToken}`,
		},
		body: JSON.stringify({ mutations }),
		throw: false,
	});
	if (res.status >= 400) {
		const reason = sanityErrorText(res);
		console.error("Sanity mutate failed", res.status, res.text);
		throw new Error(`Sanity mutate ${res.status}: ${reason}`);
	}
	return res.json;
}

/**
 * 解析「额外同步字段」配置（设置里的多行文本，通用、不绑定博客字段）。
 * 每行格式：`sanityField:frontmatterKey`，例如 `slug.current:slug`。
 * 只写字段名则前后都同名。用于把任意 Sanity 字段双向同步进 frontmatter。
 */
function parseSyncFields(raw?: string): { expr: string; key: string }[] {
	const out: { expr: string; key: string }[] = [];
	if (!raw) return out;
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const idx = trimmed.indexOf(":");
		let expr: string;
		let key: string;
		if (idx === -1) {
			expr = trimmed;
			key = trimmed.replace(/[^A-Za-z0-9_]/g, "_");
		} else {
			expr = trimmed.slice(0, idx).trim();
			key = trimmed.slice(idx + 1).trim().replace(/[^A-Za-z0-9_]/g, "_");
		}
		// 清洗 GROQ 表达式，避免注入 / 语法错误
		expr = cleanGroqExpr(expr);
		if (!expr || !key) continue;
		out.push({ expr, key });
	}
	return out;
}

/** 清洗 GROQ 表达式，保留字段名、点号路径与方括号取值 */
function cleanGroqExpr(expr: string): string {
	return expr.replace(/[^A-Za-z0-9_.[\]]/g, "");
}

/** 把点号路径写入嵌套对象，例如 setDeepPath(obj, "slug.current", "x") => obj.slug.current = "x" */
function setDeepPath(obj: any, path: string, value: any) {
	const keys = path.split(".");
	let cur = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
		cur = cur[k];
	}
	cur[keys[keys.length - 1]] = value;
}

/** Sanity 图片 asset ref（image-xxx-WxH.ext）→ CDN URL */
function sanityAssetUrlFromRef(
	ref: string,
	projectId: string,
	dataset: string
): string | null {
	const m = ref.match(/^image-(.*)-(\d+x\d+)\.(\w+)$/);
	if (!m) return null;
	const [, assetId, dims, ext] = m;
	return `https://cdn.sanity.io/images/${projectId}/${dataset}/${assetId}-${dims}.${ext}`;
}

/** CDN URL → Sanity 图片 asset ref（仅同项目同 dataset 时有效） */
function sanityRefFromAssetUrl(
	url: string,
	projectId: string,
	dataset: string
): string | null {
	const m = url.match(
		/^https:\/\/cdn\.sanity\.io\/images\/(.+?)\/(.+?)\/(.+)-(\d+x\d+)\.(\w+)$/
	);
	if (!m) return null;
	const [, p, d, assetId, dims, ext] = m;
	if (p !== projectId || d !== dataset) return null;
	return `image-${assetId}-${dims}.${ext}`;
}

export default class SanityPublishPlugin extends Plugin {
	settings: SanityPluginSettings;
	client: SanityClient;
	statusBarButton: HTMLElement | undefined;

	async onload() {
		await this.loadSettings();

		// Add status button to run publish function
		// when markdown file changes
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file || !(file.extension === "md")) {
					this.removeStatusBarButton();
					return;
				}
				this.addStatusBarButton(file);
			})
		);

		this.addCommand({
			id: "sanity-publish-command",
			name: "Publish to Sanity",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice("请先打开一个 Markdown 文件，再执行发布。");
					return;
				}
				this.publishToSanity(activeFile).catch((e: any) => {
					console.error("Publish crashed:", e);
					new Notice("Publish 出错：" + (e?.message || String(e)), 10000);
				});
			},
		});

		this.addCommand({
			id: "sanity-pull-command",
			name: "Pull from Sanity (sync all posts)",
			callback: () => {
				this.pullFromSanity().catch((e: any) => {
					console.error("Pull crashed:", e);
					new Notice("Pull 出错：" + (e?.message || String(e)), 10000);
				});
			},
		});

		this.addCommand({
			id: "sanity-publish-announcement-command",
			name: "Publish announcement to Sanity",
			callback: () => {
				this.publishAnnouncementToSanity().catch((e: any) => {
					console.error("Publish announcement crashed:", e);
					new Notice("发布公告出错：" + (e?.message || String(e)), 10000);
				});
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const lineNumber = editor.getCursor().line;
				// Get the current line from line number
				const line = editor.getLine(lineNumber);
				// See if line is an embedded image
				const filePath = this.getFilePathFromLine(line);
				if (!filePath) return;

				// If line is embedded image, get the path to that file
				const fileMetaData =
					this.app.metadataCache.getFirstLinkpathDest(filePath, "");
				if (!fileMetaData) return;

				// Add menu item to right click editor menu
				// that allows user to click to upload single image
				menu.addItem((item) => {
					item.setTitle("Upload to Sanity")
						.setIcon("file-up")
						.onClick(() => {
							const uploadText = `![uploading file...](${filePath})`;
							editor.setLine(lineNumber, uploadText);
							this.uploadFileToSanity(fileMetaData)
								.then((value) => {
									const assetText = `![${value.originalFilename}](${value.url})`;
									editor.setLine(lineNumber, assetText);
								})
								.catch((r) => {
									console.error("Upload to Sanity failed", r);
									const errorText = `![Couldn't upload file](${filePath})`;
									editor.setLine(lineNumber, errorText);
								});
						});
				});
			})
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SanitySettingTab(this.app, this));
	}

	onunload() {}

	addStatusBarButton(file: TFile) {
		// If statusBarButton is already present
		// don't add a new one
		if (this.statusBarButton) return;

		// Add status bar button that runs publish
		// function when clicked
		const statusButton = this.addStatusBarItem();
		const iconSpan = statusButton.createEl("span");
		setIcon(iconSpan, "file-up");
		statusButton.createEl("span", {
			text: "Publish",
		});

		statusButton.addClass("mod-clickable");
		statusButton.setAttr("aria-label", "Publish to Sanity");
		statusButton.setAttr("data-tooltip-position", "top");
		statusButton.addEventListener("click", () => {
			this.publishToSanity(file).catch((e: any) => {
				console.error("Publish crashed:", e);
				new Notice("Publish 出错：" + (e?.message || String(e)), 10000);
			});
		});
		this.statusBarButton = statusButton;
	}

	removeStatusBarButton() {
		if (this.statusBarButton) this.statusBarButton.remove();
		this.statusBarButton = undefined;
	}

	/**
	 * 取正对着目标文件的编辑器实例。
	 *
	 * 注意：`getActiveFile()` 与 `getActiveViewOfType(MarkdownView)` 并不等价——
	 * 从命令面板触发时焦点已转移到 suggestion 弹窗，文件在阅读视图/其它 leaf 打开时
	 * 也拿不到 MarkdownView。所以这里允许返回 null，由调用方退回 vault 读写。
	 */
	getEditorForFile(file: TFile) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		if (view.file?.path !== file.path) return null;
		return view.editor ?? null;
	}

	/**
	 * 读取目标文件的 frontmatter + 正文。
	 * 优先取编辑器内容（含尚未保存的改动），取不到就读盘，
	 * 因此不再依赖「必须有活动 MarkdownView」。
	 */
	async getFileData(file: TFile) {
		const editor = this.getEditorForFile(file);
		const raw = editor ? editor.getValue() : await this.app.vault.read(file);
		return matter(raw);
	}

	async uploadAllImages(file: TFile) {
		const editor = this.getEditorForFile(file);
		const content = editor
			? editor.getValue()
			: await this.app.vault.read(file);
		const lines = content.split("\n");

		// 先扫出需要上传的行；没有本地引用就直接返回，
		// 避免无谓的 Notice 与写盘。
		const targets = lines
			.map((line, lineNumber) => ({
				lineNumber,
				filePath: this.getFilePathFromLine(line),
			}))
			.filter((t): t is { lineNumber: number; filePath: string } =>
				Boolean(t.filePath)
			);
		if (targets.length === 0) return;

		new Notice("Uploading files in document...");

		await Promise.all(
			targets.map(async ({ lineNumber, filePath }) => {
				// 以当前笔记为解析基准，相对路径的 wikilink 才能正确定位
				const fileMetaData =
					this.app.metadataCache.getFirstLinkpathDest(
						filePath,
						file.path
					);
				if (!fileMetaData) return;

				// 有编辑器时给出「上传中」的即时反馈
				if (editor) {
					editor.setLine(
						lineNumber,
						`![uploading file...](${filePath})`
					);
				}
				try {
					const value = await this.uploadFileToSanity(fileMetaData);
					lines[
						lineNumber
					] = `![${value.originalFilename}](${value.url})`;
				} catch (e) {
					console.error("Upload to Sanity failed", e);
					lines[lineNumber] = `![Couldn't upload file](${filePath})`;
				}
				if (editor) editor.setLine(lineNumber, lines[lineNumber]);
			})
		);

		// 无编辑器（命令面板触发 / 手机端焦点丢失）时直接写回文件
		if (!editor) await this.app.vault.modify(file, lines.join("\n"));
	}

	async publishToSanity(activeFile: TFile) {
		// 先把正文里的本地图片/附件上传并替换为 CDN 链接，再推送内容
		await this.uploadAllImages(activeFile);
		const { content, data } = await this.getFileData(activeFile);

		new Notice("Publishing content to Sanity...");
		// 标题优先取 frontmatter 里配置好的标题字段，缺失才回退文件名
		const titleField = this.settings.sanityTitleField;
		const bodyField = this.settings.sanityBodyField;
		const fmTitle = titleField ? data?.[titleField] : undefined;
		const title =
			typeof fmTitle === "string" && fmTitle
				? fmTitle
				: activeFile.basename;

		// 收集「额外字段」回写 Sanity（图片 URL 还原为 asset ref）。
		// 使用 setDeepPath 把点号路径展开为嵌套对象，例如 slug.current -> { slug: { current: "x" } }。
		const extraAttrs: Record<string, any> = {};
		const extraFields = parseSyncFields(this.settings.syncFields);
		for (const f of extraFields) {
			const raw = (data as any)?.[f.key];
			if (raw === undefined || raw === null) continue;
			// 标题、正文字段单独处理，避免重复/冲突
			if (f.key === titleField || f.key === bodyField) continue;
			let value: any = raw;
			if (
				typeof raw === "string" &&
				raw.startsWith("https://cdn.sanity.io/images/")
			) {
				const ref = sanityRefFromAssetUrl(
					raw,
					this.settings.projectId || "",
					this.settings.dataset
				);
				if (ref) {
					value = {
						_type: "image",
						asset: { _type: "reference", _ref: ref },
					};
				}
			}
			setDeepPath(extraAttrs, f.expr, value);
		}

		const r = await this.createorUpdateDocument({
			content,
			title,
			sanityId: data?.sanity_id,
			extra: extraAttrs,
		});
		if (r?._id) {
			await this.updateFrontmatter(
				{ sanity_id: r._id, sanity_draft: false },
				activeFile
			);
			new Notice("Successfully published content to Sanity!");
		}
	}

	async publishAnnouncementToSanity() {
		const { announcementText, announcementLink, announcementType } =
			this.settings;
		if (!announcementText || !announcementText.trim()) {
			new Notice("公告文本为空，未发布（留空则不显示）。");
			return;
		}
		const doc = {
			_id: "siteSettings",
			_type: "siteSettings",
			announcementText: announcementText.trim(),
			announcementLink: (announcementLink || "").trim(),
			announcementType: (announcementType || "info").trim(),
		};
		try {
			await sanityMutate([{ createOrReplace: doc }], this.settings);
			new Notice("公告已发布到 Sanity，网站稍后自动更新。");
		} catch (e: any) {
			console.error("Publish announcement failed:", e);
			new Notice("发布公告失败：" + (e?.message || String(e)), 10000);
		}
	}

	async pullFromSanity() {
		const { projectId, dataset, apiToken } = this.settings;
		if (!projectId || !apiToken) {
			new Notice(
				"请先在插件设置中填写 Sanity Project ID 和 API Token，再执行拉取。"
			);
			return;
		}

		new Notice("Pulling all posts from Sanity...");
		const type = this.settings.sanityTypeName || "post";
		const titleField = this.settings.sanityTitleField;
		const bodyField = this.settings.sanityBodyField || "body";
		const filenameField = this.settings.filenameField;

		// 只拉取正式文档（排除 drafts.*）：避免 Obsidian 里草稿与正式并存导致重复。
		// 类型/字段名内联进 GROQ（并做标识符清洗），不使用 $param，避免请求 400。
		// 标题、正文、文件名、额外字段全部由用户在设置里指定，插件不再硬编码任何 schema 字段。
		const safeType = String(type).replace(/[^a-zA-Z0-9_]/g, "");
		const safeTitle = titleField ? cleanGroqExpr(titleField) : "";
		const safeBody = bodyField ? cleanGroqExpr(bodyField) : "";
		const safeFilename = filenameField ? cleanGroqExpr(filenameField) : "";
		const extraFields = parseSyncFields(this.settings.syncFields);

		const parts: string[] = [`_id`, `"isDraft": _id in path("drafts.**")`];
		if (safeTitle) parts.push(`"_syncTitle": ${safeTitle}`);
		if (safeBody) parts.push(`"_syncBody": ${safeBody}`);
		if (safeFilename) {
			parts.push(`"_syncFilename": ${safeFilename}`);
		} else {
			// 未指定文件名来源时，自动回退 slug.current（再回退标题、sanity_id）
			parts.push(`"_syncFilename": slug.current`);
		}
		for (const f of extraFields) {
			parts.push(`"${f.key}": ${f.expr}`);
		}
		const query = `*[_type == "${safeType}" && !(_id in path("drafts.**"))]{ ${parts.join(", ")} }`;

		let docs: any[] = [];
		try {
			const url =
				`${apiBaseFor(this.settings)}/${QUERY_API_VERSION}/data/query/` +
				`${dataset}?query=${encodeURIComponent(query)}`;
			const res = await requestUrl({
				url,
				method: "GET",
				headers: { Authorization: `Bearer ${apiToken}` },
			});
			docs = res.json?.result || [];
		} catch (e: any) {
			const status = e?.status;
			const detail = e?.message || e?.response?.text || e?.text || String(e);
			console.error("Sanity pull failed:", status, detail, "project=", projectId);
			let msg: string;
			if (!status) {
				// 请求未返回 HTTP 状态码 = 网络层异常（DNS / 超时 / 被墙 / 无网络）
				msg =
					"拉取失败：无法连接到 Sanity（网络错误）。\n" +
					`请检查：①手机网络能否访问 ${apiBaseFor(this.settings)}；②是否需要 VPN/代理；③插件设置里的 Project ID / Token / 自定义 API 域名 是否已填写。`;
			} else {
				msg = `拉取失败（HTTP ${status}）：${detail}`;
			}
			new Notice(msg, 12000);
			return;
		}

		if (!docs.length) {
			new Notice("No documents found in Sanity.");
			return;
		}

		// 用 sanity_id 索引现有 vault 文件，便于去重 / 更新
		const existingById = new Map<string, TFile>();
		for (const f of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm && fm.sanity_id) existingById.set(fm.sanity_id, f);
		}

		const folderPrefix = this.settings.pullFolder
			? this.settings.pullFolder.replace(/\/+$/, "") + "/"
			: "";

		let created = 0;
		let updated = 0;
		for (const doc of docs) {
			const isDraft = !!doc.isDraft;
			// 文件名来源回退：Filename field > Title field > slug.current > sanity_id
			// 填了 Filename field 时它优先；未填时才回退 Title → slug.current(_syncFilename) → sanity_id
			const baseName = this.sanitizeFilename(
				filenameField
					? doc._syncFilename || "untitled"
					: doc._syncTitle || doc._syncFilename || doc._id || "untitled"
			);
			const frontmatter: any = {
				sanity_id: doc._id,
				sanity_draft: isDraft,
			};
			// 标题写入 frontmatter（双向同步）
			if (safeTitle && doc._syncTitle !== undefined && doc._syncTitle !== null) {
				frontmatter[safeTitle] = doc._syncTitle;
			}
			// 额外字段写入 frontmatter（图片引用自动转为 CDN URL）
			for (const f of extraFields) {
				let v = (doc as any)[f.key];
				if (v === undefined || v === null) continue;
				if (
					v &&
					v._type === "image" &&
					v.asset &&
					typeof v.asset._ref === "string"
				) {
					const url = sanityAssetUrlFromRef(
						v.asset._ref,
						projectId,
						dataset
					);
					if (url) v = url;
				}
				frontmatter[f.key] = v;
			}
			const body: string = doc._syncBody || "";

			const existing = existingById.get(doc._id);
			if (existing) {
				// 已存在：原地更新正文与 frontmatter（保留用户新增的其他字段）
				const raw = await this.app.vault.read(existing);
				const { data } = matter(raw);
				const mergedFm = { ...data, ...frontmatter };
				await this.app.vault.modify(
					existing,
					matter.stringify(body, mergedFm)
				);
				updated++;
				continue;
			}

			// 新建：保证路径不冲突
			let finalPath = folderPrefix + baseName + ".md";
			let n = 1;
			while (await this.app.vault.adapter.exists(finalPath)) {
				finalPath = folderPrefix + baseName + "-" + n + ".md";
				n++;
			}
			await this.app.vault.create(
				finalPath,
				matter.stringify(body, frontmatter)
			);
			created++;
		}

		new Notice(
			`Pulled from Sanity: ${created} created, ${updated} updated ` +
				`(${docs.length} total; drafts flagged with sanity_draft: true).`
		);
	}

	sanitizeFilename(name: string): string {
		const cleaned = name
			.replace(/[\\/:*?"<>|#]/g, "-")
			.replace(/^\.+/, "")
			.trim();
		return cleaned.slice(0, 80) || "untitled";
	}

	createClient() {
		if (this.settings.projectId)
			this.client = createSanityClient({
				projectId: this.settings.projectId,
				dataset: this.settings.dataset,
				token: this.settings.apiToken,
				apiVersion: "2023-05-03",
				useCdn: true,
			});
	}

	async uploadFileToSanity(file: TFile) {
		const arrayBuffer = await this.app.vault.readBinary(file);
		const fileType = mime.getType(file.path);
		const isImage = fileType?.includes("image");
		const fileName = file.path.split("/").pop() || "file";
		const url =
			`${apiBaseFor(this.settings)}/v${API_VERSION}/assets/` +
			`${isImage ? "images" : "files"}/${this.settings.dataset}` +
			`?filename=${encodeURIComponent(fileName)}`;
		const res = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": fileType || "application/octet-stream",
				Authorization: `Bearer ${this.settings.apiToken}`,
			},
			body: arrayBuffer,
			throw: false,
		});
		if (res.status >= 400) {
			const reason = sanityErrorText(res);
			console.error("Sanity asset upload failed", res.status, res.text);
			throw new Error(`上传「${fileName}」失败（HTTP ${res.status}）：${reason}`);
		}
		const doc = res.json?.document || res.json;
		return { originalFilename: doc.originalFilename, url: doc.url };
	}

	async createorUpdateDocument({
		title,
		content,
		sanityId,
		extra,
	}: {
		title: string;
		content: string;
		sanityId: string;
		extra?: Record<string, any>;
	}) {
		const _type = this.settings.sanityTypeName;
		const titleField = this.settings.sanityTitleField;
		const bodyField = this.settings.sanityBodyField;
		// If we have a content divider,
		// split the content by that string
		// return the top/first item
		if (this.settings.contentDivider) {
			content = content.split(this.settings.contentDivider)[0];
		}
		// Use the users field settings for the attribute names
		let attributes = { [bodyField]: content };
		if (titleField) attributes[titleField] = title;
		// 额外字段（通用双向同步）
		if (extra) Object.assign(attributes, extra);

		// 规范化目标 id：若 sanity_id 指向草稿（drafts.x），发布应落到对应
		// 正式文档 x，并准备删除原草稿，避免 Sanity 里草稿/正式并存造成重复。
		let targetId = sanityId || "";
		let draftToDelete: string | null = null;
		if (targetId.startsWith("drafts.")) {
			draftToDelete = targetId;
			targetId = targetId.slice("drafts.".length);
		}

		let mutations: unknown[];
		if (!targetId) {
			// 新建：直接生成正式文档 id（发布即正式，不生成草稿，避免重复）
			targetId = "post-" + Math.random().toString(36).slice(2, 11);
			mutations = [{ create: { _type, _id: targetId, ...attributes } }];
		} else {
			// 已有 sanity_id：不能只发 patch。
			// Sanity 对「不存在的文档」执行 patch 会返回 HTTP 404
			// （documentNotFoundError）—— 当 frontmatter 里的 sanity_id 指向
			// 一个已被删除 / 从未创建成功的文档时就会崩。
			// 先 createIfNotExists 兜底再 patch，同一事务内原子执行：
			// 文档存在 → create 被忽略，正常 patch；文档不存在 → 先建再写，自愈。
			mutations = [
				{ createIfNotExists: { _id: targetId, _type } },
				{ patch: { id: targetId, set: attributes } },
			];
		}

		const res = await sanityMutate(mutations, this.settings);
		// 事务里可能有多条 mutation（createIfNotExists + patch），
		// results[0] 是建档结果、最后一条才是写入后的最终文档，取最后一条。
		const results = res?.results;
		const last = Array.isArray(results)
			? results[results.length - 1]
			: undefined;
		const doc = last?.document || (last?.id ? { _id: last.id } : undefined);
		// 发布成功后删除原草稿（独立请求，失败不阻断正式发布）
		if (draftToDelete) {
			await sanityMutate([{ delete: { id: draftToDelete } }], this.settings);
		}
		return doc?._id ? doc : { _id: targetId };
	}

	getAbsolutePath(file: TFile) {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			const basePath = adapter.getBasePath();
			return basePath + "/" + file.path;
		}
	}

	getFilePathFromLine(line: string) {
		// See if it matches either an Obsidian embed or normal md embed
		// Alt text can be any length, so use non-greedy match for brackets.
		const matches = line.match(/!\[\[(.*?)\]\]|!\[.*?\]\((.*?)\)/);
		if (!matches) return;
		// Don't upload if already a URL
		if (matches?.[2]?.match(httpRegex)) return;
		// TODO: figure out full absolute path to asset
		const filePath = matches?.[1] || matches?.[2];
		return filePath;
	}

	async updateFrontmatter(
		updatedProperties: {
			[x: string]: any;
		},
		file?: TFile
	) {
		// 优先用显式传入的文件；没有才回退到当前活动文件
		const currentFile = file ?? this.app.workspace.getActiveFile();
		if (!currentFile) {
			console.error("No active file found.");
			return;
		}

		const { content, data } = await this.getFileData(currentFile);
		const updatedFrontmatter =
			matter
				.stringify("", {
					...data,
					...updatedProperties,
				})
				.trimEnd() + "\n";

		// Update the content with the modified frontmatter
		const updatedContent = updatedFrontmatter + content;

		// Save the updated content back to the file
		await this.app.vault.modify(currentFile, updatedContent);
	}

	async sleep(delay: number) {
		return new Promise((resolve) => setTimeout(resolve, delay));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.createClient();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.createClient();
	}
}
