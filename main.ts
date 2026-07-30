import {
	SanityClient,
	createClient as createSanityClient,
} from "@sanity/client";
import {
	DEFAULT_SETTINGS,
	SanityPluginSettings,
	SanitySettingTab,
} from "SanitySettingTab";
import { readFile } from "fs/promises";
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

				const absolutePath = this.getAbsolutePath(fileMetaData);
				if (!absolutePath) return;

				// Add menu item to right click editor menu
				// that allows user to click to upload single image
				menu.addItem((item) => {
					item.setTitle("Upload to Sanity")
						.setIcon("file-up")
						.onClick(() => {
							const uploadText = `![uploading file...](${filePath})`;
							editor.setLine(lineNumber, uploadText);
							this.uploadFileToSanity(absolutePath)
								.then((value) => {
									const assetText = `![${value.originalFilename}](${value.url})`;
									editor.setLine(lineNumber, assetText);
								})
								.catch((r) => {
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

				const absolutePath = this.getAbsolutePath(fileMetaData);
				if (!absolutePath) return;

				const uploadText = `![uploading file...](${filePath})`;
				editor.setLine(lineNumber, uploadText);
				try {
					const value = await this.uploadFileToSanity(absolutePath);
					const assetText = `![${value.originalFilename}](${value.url})`;
					editor.setLine(lineNumber, assetText);
				} catch {
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
				this.createorUpdateDocument({
					content,
					title: activeFile.basename,
					sanityId: data?.sanity_id,
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
		const titleField = this.settings.sanityTitleField || "title";
		const bodyField = this.settings.sanityBodyField || "body";

		// 拉取全部 post（含草稿）：用 isDraft 标记区分正式 / 草稿。
		// 类型/字段名内联进 GROQ（并做标识符清洗），不使用 $param，避免请求 400。
		const safeType = String(type).replace(/[^a-zA-Z0-9_]/g, "");
		const safeTitle = String(titleField).replace(/[^a-zA-Z0-9_]/g, "");
		const safeBody = String(bodyField).replace(/[^a-zA-Z0-9_]/g, "");
		const query =
			`*[_type == "${safeType}"]{` +
			`  _id,` +
			`  "title": ${safeTitle},` +
			`  "body": ${safeBody},` +
			`  "slug": slug.current,` +
			`  "isDraft": _id in path("drafts.**")` +
			`}`;

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
			const baseName = this.sanitizeFilename(
				doc.slug || doc.title || doc._id
			);
			const frontmatter = {
				sanity_id: doc._id,
				sanity_draft: isDraft,
			};
			const body: string = doc.body || "";

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

	async uploadFileToSanity(path: string) {
		const file = await readFile(path);
		const fileType = mime.getType(path);
		const isImage = fileType?.includes("image");
		const fileName = path.split(/[\\/]/).pop() || "file";
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
			body: new Uint8Array(file),
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
	}: {
		title: string;
		content: string;
		sanityId: string;
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
