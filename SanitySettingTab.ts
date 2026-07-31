import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
import SanityPublishPlugin from "main";

/** 把 syncFields 字符串解析成最多 10 行的 {sanity, fm} 结构（通用，不预设字段名） */
function splitSyncRows(raw?: string): { sanity: string; fm: string }[] {
	const rows: { sanity: string; fm: string }[] = [];
	for (const line of (raw || "").split(/\r?\n/)) {
		const t = line.trim();
		if (!t) continue;
		const i = t.indexOf(":");
		if (i === -1) rows.push({ sanity: t, fm: "" });
		else
			rows.push({
				sanity: t.slice(0, i).trim(),
				fm: t.slice(i + 1).trim(),
			});
	}
	while (rows.length < 10) rows.push({ sanity: "", fm: "" });
	return rows;
}

/** 把字段行序列化回 syncFields 字符串（fm 留空则省略冒号，复用 sanity 名） */
function joinSyncRows(rows: { sanity: string; fm: string }[]): string {
	return rows
		.filter((r) => r.sanity.trim())
		.map((r) => r.sanity.trim() + (r.fm.trim() ? ":" + r.fm.trim() : ""))
		.join("\n");
}

export interface SanityPluginSettings {
	apiToken: string | undefined;
	projectId: string | undefined;
	sanityApiBaseUrl?: string;
	dataset: string;
	sanityTypeName: string;
	sanityTitleField?: string;
	sanityBodyField: string;
	filenameField?: string;
	contentDivider?: string;
	pullFolder?: string;
	syncFields?: string;
	announcementText?: string;
	announcementLink?: string;
	announcementType?: string;
}

export const DEFAULT_SETTINGS: SanityPluginSettings = {
	apiToken: "",
	projectId: "",
	sanityApiBaseUrl: "",
	dataset: "production",
	sanityTypeName: "post",
	sanityBodyField: "body",
	filenameField: "",
	contentDivider: "",
	pullFolder: "",
	syncFields: "series:series",
	announcementText: "",
	announcementLink: "",
	announcementType: "info",
};

export class SanitySettingTab extends PluginSettingTab {
	plugin: SanityPublishPlugin;

	constructor(app: App, plugin: SanityPublishPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("br");
		containerEl.createEl("h3", { text: "Sanity configuration" });

		new Setting(containerEl)
			.setName("Sanity API token")
			.setDesc(
				"Your token must have write-access for the project you wish to publish to."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Token")
					.setValue(this.plugin.settings.apiToken || "")
					.onChange(async (value) => {
						this.plugin.settings.apiToken = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Project ID")
			.setDesc("Your Sanity project's ID.")
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Id")
					.setValue(this.plugin.settings.projectId || "")
					.onChange(async (value) => {
						this.plugin.settings.projectId = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dataset name")
			.setDesc(
				"The name of the dataset you'd like to publish to (defaults to `production`)."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Dataset's Name")
					.setValue(this.plugin.settings.dataset || "production")
					.onChange(async (value) => {
						this.plugin.settings.dataset = value || "production";
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("br");
		containerEl.createEl("h3", { text: "Schema configuration" });

		new Setting(containerEl)
			.setName("Type name")
			.setDesc(
				"The name of the document type you want to sync with in Sanity (defaults to 'post')."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Type Name")
					.setValue(this.plugin.settings.sanityTypeName || "post")
					.onChange(async (value) => {
						this.plugin.settings.sanityTypeName = value || "post";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Title field")
			.setDesc(
				"The name of the field you'd like to sync your title with (leave blank if you don't want to sync this field)."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Field Name")
					.setValue(this.plugin.settings.sanityTitleField || "")
					.onChange(async (value) => {
						this.plugin.settings.sanityTitleField = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Body field")
			.setDesc(
				"The name of the field you'd like to sync the body of your document with (defaults to 'body')."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter Your Field Name")
					.setValue(this.plugin.settings.sanityBodyField || "body")
					.onChange(async (value) => {
						this.plugin.settings.sanityBodyField = value || "body";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Filename field")
			.setDesc(
				"The Sanity field used to generate the Obsidian filename (and optionally the URL slug). GROQ paths allowed, e.g. 'slug.current'. Leave blank to use the Title field instead."
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. slug.current")
					.setValue(this.plugin.settings.filenameField || "")
					.onChange(async (value) => {
						this.plugin.settings.filenameField = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("br");
		containerEl.createEl("h3", { text: "Advanced" });

		new Setting(containerEl)
			.setName("Content divider")
			.setDesc(
				"An optional dividing string for your content. If this string is in your document, anything below it won't be published."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your divider")
					.setValue(this.plugin.settings.contentDivider || "")
				.onChange(async (value) => {
					this.plugin.settings.contentDivider = value || "";
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Pull folder")
			.setDesc(
				"Folder where posts pulled from Sanity are saved. Leave blank to save at the vault root."
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. Sanity")
					.setValue(this.plugin.settings.pullFolder || "")
					.onChange(async (value) => {
						this.plugin.settings.pullFolder = value || "";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Custom API base URL (optional)")
			.setDesc(
				"Reverse-proxy URL used to reach the Sanity API when `api.sanity.io` is unreachable (e.g. in mainland China). " +
					"Leave blank to use the default host. Enter e.g. `https://sanity-api.your-domain.com` — the path after the host is preserved, so query / mutate / upload all go through the proxy."
			)
			.addText((text) =>
				text
					.setPlaceholder("https://sanity-api.your-domain.com")
					.setValue(this.plugin.settings.sanityApiBaseUrl || "")
					.onChange(async (value) => {
						this.plugin.settings.sanityApiBaseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Additional fields to sync")
			.setDesc(
				"Extra Sanity fields to sync into each note's frontmatter (and back on publish). " +
					"One row per field — left = Sanity field (GROQ path allowed, e.g. `slug.current`), " +
					"right = frontmatter key (leave blank to reuse the Sanity field name). " +
					"Fill as many rows as you need; blank rows are ignored."
			);

		// 通用字段行：每行两个输入框，不预设任何字段名，保持插件通用性
		const rows = splitSyncRows(this.plugin.settings.syncFields);
		const box = containerEl.createDiv({ cls: "sanity-sync-box" });
		const persist = async () => {
			this.plugin.settings.syncFields = joinSyncRows(rows);
			await this.plugin.saveSettings();
		};
		for (let i = 0; i < 10; i++) {
			const rowEl = box.createDiv({ cls: "sanity-sync-row" });
			const left = new TextComponent(rowEl)
				.setPlaceholder("Sanity 字段 (如 slug.current)")
				.setValue(rows[i].sanity)
				.onChange(async (v) => {
					rows[i].sanity = v;
					await persist();
				});
			left.inputEl.addClass("sanity-sync-input");
			const right = new TextComponent(rowEl)
				.setPlaceholder("Frontmatter 键 (可留空)")
				.setValue(rows[i].fm)
				.onChange(async (v) => {
					rows[i].fm = v;
					await persist();
				});
			right.inputEl.addClass("sanity-sync-input");
		}
		containerEl.createEl("style", {
			text:
				".sanity-sync-box{display:flex;flex-direction:column;gap:6px;margin:6px 0 2px;}" +
				".sanity-sync-row{display:flex;gap:8px;}" +
				".sanity-sync-input{flex:1 1 0;min-width:0;background:var(--background-modifier-form-field);" +
				"border:1px solid var(--background-modifier-border);border-radius:4px;" +
				"padding:5px 8px;color:var(--text-normal);height:auto;}",
		});

		containerEl.createEl("br");
		containerEl.createEl("h3", { text: "Site announcement (optional)" });
		containerEl.createEl("p", {
			text: "填写后执行命令「Publish announcement to Sanity」，网站公告栏即显示；三项全空则不显示。",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Announcement text")
			.setDesc("公告正文。留空 = 不显示公告。")
			.addText((text) =>
				text
					.setPlaceholder("如：本站已升级个性化样式")
					.setValue(this.plugin.settings.announcementText || "")
					.onChange(async (value) => {
						this.plugin.settings.announcementText = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Announcement link")
			.setDesc("点击公告跳转的链接（可留空）。")
			.addText((text) =>
				text
					.setPlaceholder("/about/")
					.setValue(this.plugin.settings.announcementLink || "")
					.onChange(async (value) => {
						this.plugin.settings.announcementLink = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Announcement type")
			.setDesc("info / success / warn，对应不同强调色。")
			.addDropdown((dd) =>
				dd
					.addOption("info", "info")
					.addOption("success", "success")
					.addOption("warn", "warn")
					.setValue(this.plugin.settings.announcementType || "info")
					.onChange(async (value) => {
						this.plugin.settings.announcementType = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
