> 🌐 Language: [English](README.md) · [中文](README_cn.md)

# Sanity Publish for Obsidian

![Obsidian logo and Sanity logo together](cover-image.png)

Sanity Publish is a plugin for Obsidian that lets you publish **and** pull documents between your Obsidian vault and your Sanity Studio. It supports a two-way workflow: write in Obsidian and publish to Sanity, or pull your Sanity documents (including drafts) back into Obsidian to read or edit them.

## Installation

**Sanity Publish is not yet on the Community Plugins marketplace.** You can install it manually or via BRAT.

### Option A — BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then add this repository as a beta plugin:
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. Enable **Sanity Publish** and open its settings.

### Option B — Manual clone

From your vault's root directory:

```
cd .obsidian/plugins && git clone https://github.com/violet27chen/sanity-obsidian-plugin.git
```

Restart Obsidian, then enable the plugin in Settings → Installed Plugins.

## Settings

### Sanity API Token

An API token with **read/write** access for your Sanity project. See the [Sanity token guide](https://www.sanity.io/docs/http-auth).

> By providing this token you allow Sanity Publish (and any other installed plugin) to publish to your Studio on your behalf.

### Sanity Project ID

Your Sanity project ID.

### Sanity Dataset Name

The dataset to sync with. Defaults to `production`.

### Sanity Document Type Name

The document type to sync (e.g. `post` or `blog`). Default `post`.

### Sanity Title Field

The schema field that holds the title. Sanity Publish syncs the Obsidian filename with this field. Leave blank to skip syncing the filename.

### Sanity Body Field

The schema field that holds the document body. It should store the raw Markdown (e.g. `bodyMarkdown`). Sanity Publish syncs the Obsidian document content with this field.

### Pull folder (Advanced)

Where notes pulled from Sanity are saved. Leave blank to save at the vault root.

## Publishing to Sanity

Open a document, then run the command **`Publish to Sanity`** (command palette). This creates or updates a draft document in your Sanity Studio and writes a `sanity_id` into the note's frontmatter, so future updates stay linked to the same Sanity document.

Right-click an embedded image and choose **`Upload to Sanity`** to upload it to Sanity's CDN. Publishing also uploads all embedded images automatically.

Use the **Content Divider** setting to publish only the portion of a document above a marker line.

## Pulling from Sanity

Run the command **`Pull from Sanity (sync all posts)`** to sync your Sanity documents into Obsidian. It does not require an open document.

- Pulls **all** documents of the configured type, **including drafts**.
- Each note gets frontmatter:
  - `sanity_id` — the document's Sanity `_id`. This is the round-trip key: publishing the note later updates the **same** Sanity document.
  - `sanity_draft: true | false` — marks whether the source is a draft (`drafts.*`) or a published document (`post.*`), so you can tell them apart at a glance.
- Existing notes (matched by `sanity_id`) are updated in place, preserving any other frontmatter you have added. New documents are created; filenames use `slug.current`, then the title, then the `_id`.
- Notes are saved to the **Pull folder** if set, otherwise the vault root.

Because the plugin writes `sanity_id`, the workflow is fully round-trip: pull a document, edit it in Obsidian, and publish to push the changes back to the same Sanity document.

## Notes

- The plugin calls the Sanity HTTP API directly from inside Obsidian, so no extra CORS configuration is needed in your Sanity project.
- Pulling requires a token with **read** access; publishing requires **write** access.

## Contributing

Issues and pull requests are welcome.
