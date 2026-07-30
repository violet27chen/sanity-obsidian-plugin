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
 * 用 Obsidian 的 requestUrl 直连 Sanity，绕过浏览器的 CORS 限制
 * （Obsidian webview 来源 app://obsidian.md 不被 Sanity CORS 接受）。
 */
async function sanityMutate(
	mutations: unknown[],
	settings: SanityPluginSettings
): Promise<any> {
	const url =
		`https://${settings.projectId}.api.sanity.io/v${API_VERSION}/data/mutate/` +
		`${settings.dataset}?returnIds=true&returnDocuments=true&visibility=sync`;
	const res = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.apiToken}`,
		},
		body: JSON.stringify({ mutations }),
	});
	if (res.status >= 400) {
		console.error("Sanity mutate failed", res.status, res.text);
		throw new Error("Sanity mutate failed: " + res.status);
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
			checkCallback: (checking) => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				const activeFile = this.app.workspace.getActiveFile();

				if (!activeView || !activeFile) {
					if (checking) return false;
					return;
				} else if (checking) {
					return true;
				}

				this.publishToSanity(activeFile);
			},
		});

		this.addCommand({
			id: "sanity-pull-command",
			name: "Pull from Sanity (sync all posts)",
			callback: () => this.pullFromSanity(),
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
		statusButton.addEventListener("click", () =>
			this.publishToSanity(file)
		);
		this.statusBarButton = statusButton;
	}

	removeStatusBarButton() {
		if (this.statusBarButton) this.statusBarButton.remove();
		this.statusBarButton = undefined;
	}

	async uploadAllImages() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		if (!editor) return;

		const content = view.getViewData();
		const lines = content.split("\n");

		new Notice("Uploading files in document...");

		// For every new line, check if it's an embedded image
		// if it is, upload it to Sanity and replace the text in the
		// editor
		await Promise.all(
			lines.map(async (line, lineNumber) => {
				const filePath = this.getFilePathFromLine(line);
				if (!filePath) return;

				const fileMetaData =
					this.app.metadataCache.getFirstLinkpathDest(filePath, "");
				if (!fileMetaData) return;

				const uploadText = `![uploading file...](${filePath})`;
				editor.setLine(lineNumber, uploadText);
				try {
					const value = await this.uploadFileToSanity(fileMetaData);
					const assetText = `![${value.originalFilename}](${value.url})`;
					editor.setLine(lineNumber, assetText);
				} catch (e) {
					console.error("Upload to Sanity failed", e);
					const errorText = `![Couldn't upload file](${filePath})`;
					editor.setLine(lineNumber, errorText);
				}
			})
		);
	}

	publishToSanity(activeFile: TFile) {
		// Upload images and then push content to Sanity
		this.uploadAllImages().then(() =>
			this.getActiveViewData().then(({ content, data }) => {
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

				this.createorUpdateDocument({
					content,
					title,
					sanityId: data?.sanity_id,
					extra: extraAttrs,
				})
					.then((r) => {
						if (r?._id) {
							this.updateFrontmatter({ sanity_id: r._id });
							new Notice(
								"Successfully published content to Sanity!"
							);
						}
					})
					.catch(() => {
						new Notice(
							"Something went wrong when publishing to Sanity"
						);
					});
			})
		);
	}

	async pullFromSanity() {
		const { projectId, dataset, apiToken } = this.settings;
		if (!projectId || !apiToken) {
			new Notice(
				"Please configure Sanity project ID and API token in settings first."
			);
			return;
		}

		new Notice("Pulling all posts from Sanity...");
		const type = this.settings.sanityTypeName || "post";
		const titleField = this.settings.sanityTitleField;
		const bodyField = this.settings.sanityBodyField || "body";
		const filenameField = this.settings.filenameField;

		// 拉取全部文档（含草稿）：用 isDraft 标记区分正式 / 草稿。
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
		const query = `*[_type == "${safeType}"]{ ${parts.join(", ")} }`;

		let docs: any[] = [];
		try {
			const url =
				`https://${projectId}.api.sanity.io/${QUERY_API_VERSION}/data/query/` +
				`${dataset}?query=${encodeURIComponent(query)}`;
			const res = await requestUrl({
				url,
				method: "GET",
				headers: { Authorization: `Bearer ${apiToken}` },
			});
			docs = res.json?.result || [];
		} catch (e: any) {
			const detail = e?.response?.text || e?.text || e?.message || e;
			console.error("Sanity pull failed:", e?.status, detail);
			new Notice(
				"Failed to pull from Sanity (HTTP " +
					(e?.status || "?") +
					"). See developer console for details."
			);
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
			`https://${this.settings.projectId}.api.sanity.io/v${API_VERSION}/assets/` +
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
		});
		if (res.status >= 400) {
			console.error("Sanity asset upload failed", res.status, res.text);
			throw new Error("Sanity asset upload failed: " + res.status);
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

		let mutation;
		if (!sanityId) {
			// 新建：生成合法 draft id（drafts.<随机>，避免 "drafts." 被拒）
			mutation = {
				create: {
					_type,
					_id: "drafts." + Math.random().toString(36).slice(2, 11),
					...attributes,
				},
			};
		} else {
			mutation = { patch: { id: sanityId, set: attributes } };
		}

		const res = await sanityMutate([mutation], this.settings);
		const doc = res?.results?.[0]?.document;
		return doc || {};
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

	async getActiveViewData() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			return matter(activeView.getViewData());
		}
		throw new Error("No active view available.");
	}

	async updateFrontmatter(updatedProperties: {
		[x: string]: string | string[];
	}) {
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile) {
			const { content, data } = await this.getActiveViewData();
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
			this.app.vault.modify(currentFile, updatedContent);
		} else {
			console.error("No active file found.");
		}
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
