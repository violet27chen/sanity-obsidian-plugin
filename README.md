> 🌐 Language: [English](README.md) · [中文](README_cn.md)

# Sanity for Obsidian

![Obsidian logo and Sanity logo together](cover-image.png)

Sanity is a plugin for Obsidian that lets you publish **and** pull documents between your Obsidian vault and your Sanity Studio — a **bidirectional** sync, not tied to any specific blog or website.

- Write in Obsidian and publish to Sanity as a **published** document.
- Pull your Sanity documents back into Obsidian to read or edit them.
- Everything is driven by your plugin settings, so it works with whatever schema you have defined.

## Installation

This plugin is **not on the Community Plugins marketplace.** Install it manually or via BRAT.

### Option A — BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then add this repository as a beta plugin:
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. Enable **Sanity** and open its settings.

### Option B — Manual clone

From your vault's root directory:

```
cd .obsidian/plugins && git clone https://github.com/violet27chen/sanity-obsidian-plugin.git
```

Restart Obsidian, then enable the plugin in **Settings → Installed Plugins**.

## Settings

Open **Settings → Sanity**. Every field is explained below.

| Setting | Default | What to put |
|---|---|---|
| **Sanity API token** | empty | A Sanity API token with **Editor (or Admin) role**. A Viewer/read-only token will fail at publish with `403 insufficientPermissions (update)`. Generate one at sanity.io → project → API → Tokens. |
| **Project ID** | empty | Your Sanity project ID (e.g. `3hwpvo77`). |
| **Dataset name** | `production` | The dataset to sync with. |
| **Type name** | `post` | The document type to sync (e.g. `post`, `blog`). |
| **Title field** | empty | The Sanity schema field that holds the title. Leave blank to skip syncing the title. |
| **Body field** | `body` | The Sanity schema field that holds the document body (raw Markdown). |
| **Filename field** | empty | Sanity field used to generate the Obsidian filename / slug. GROQ paths allowed, e.g. `slug.current`. Left blank → falls back to **Title field** → `slug.current` → `sanity_id`. |
| **Content divider** | empty | A marker string; anything below it in the note is NOT published. |
| **Pull folder** | empty | Folder where pulled notes are saved. Blank → vault root. |
| **Custom API base URL** | empty | Reverse-proxy URL for when `api.sanity.io` is unreachable (e.g. mainland China). All query/mutate/upload calls go through it. Blank → default host. |
| **Additional fields to sync** | `series:series` | Extra Sanity fields ↔ frontmatter mappings (see below). The default is just an example — delete or replace it with the fields you actually use. |
| **Announcement text / link / type** | empty / `info` | Site announcement; used by the *Publish announcement to Sanity* command. Leave text empty to show nothing. |

### Additional fields to sync — how to fill

This is the most flexible setting. It maps arbitrary Sanity fields into each note's frontmatter (and back on publish).

- **Format:** one row per field — `Sanity field : frontmatter key`.
  - **Left** = the Sanity field name. GROQ paths are allowed, e.g. `slug.current`, `heroImage`.
  - **Right** = the frontmatter key to map it to. Leave it blank to reuse the left-side name as the key.
- Up to **10 rows**; blank rows are ignored.
- **Pull:** these Sanity fields are written into the note's frontmatter (image objects become Sanity CDN URLs automatically).
- **Publish:** the same frontmatter keys are written back to Sanity (CDN URLs are converted back to asset references; local image paths / `[[ ]]` are uploaded).
- Dot-notation paths like `slug.current` are expanded into nested objects on write (`slug: { current: "..." }`).

> 💡 **Cover image vs body images**
> Use `heroImage:heroImage` for the **cover**. A Sanity `image` object in a field is handled here.
> **Body images** inside the note (`![[image]]` or `![alt](image)`) are uploaded automatically on publish and do **not** need a row here.

Typical blog example (left → right). This example intentionally does **not** include `series`, since the default row already covers it:

```
slug.current   →   slug
description     →   description
publishedAt     →   published
categories      →   categories
heroImage       →   heroImage
```

Delete all rows (or leave them blank) to sync only the title and body.

### Custom API base URL (GFW / proxy)

By default the plugin talks to `https://<projectId>.api.sanity.io`. In some networks (e.g. mainland China) that host is unreachable while the Sanity CDN (`cdn.sanity.io`) stays up. Enter a reverse-proxy URL — e.g. `https://sanity-api.your-domain.com` — and **all** API calls (query, mutate, upload) route through it. The path after the host is preserved, so nothing else changes. Leave blank to use the default host.

## Note frontmatter — what the plugin reads/writes

| Frontmatter key | Filled by | Meaning / how to use |
|---|---|---|
| `sanity_id` | plugin (auto) | The Sanity `_id` of the document. The round-trip key — publishing the note later updates the **same** Sanity document. **Do not set it by hand.** If it points to `drafts.x`, publish lands on the matching published doc `x` and deletes the draft. |
| `sanity_draft` | plugin (auto) | `true`/`false` — marks whether the source was a draft. Set by Pull; the publish logic does not consume it. |
| Title field (e.g. `title`) | you / plugin | The title. On publish the plugin prefers this field; if absent it falls back to the filename. |
| Body field (e.g. `body`) | plugin | The document body (raw Markdown). |
| Sync-field keys (e.g. `series`, `categories`, `slug`, `heroImage`) | you / plugin | Mapped via *Additional fields to sync*. Written back to Sanity on publish, filled in on pull. |
| `heroImage` (cover) | you | Local image path (`[[ ]]` allowed) or a `cdn.sanity.io` URL. Uploaded / reference-restored automatically. |

> Body images (`![[img]]` / `![alt](img)`) are uploaded automatically on publish and replaced with CDN URLs — no frontmatter key needed.

## Commands

Open the command palette (Ctrl/Cmd + P) and search **Sanity**:

- **Publish to Sanity** — create or update the Sanity document for the active note. On success, `sanity_id` is written to the note. Publishes as a **published** document and removes any matching draft.
- **Pull from Sanity (sync all posts)** — pull **all published documents** of the configured type into Obsidian (drafts are excluded). No open document needed.
- **Publish announcement to Sanity** — push the *Site announcement* settings to the `siteSettings` singleton.

## Workflow

### Publish a note

1. Fill the note's frontmatter (title, and any sync fields like `heroImage`, `categories`).
2. Put images inline with `![[image]]` or `![alt](path)`.
3. Run **Publish to Sanity**.
4. The plugin uploads images, sends the document as **published**, and writes `sanity_id` into the frontmatter.

### Pull everything

1. Run **Pull from Sanity (sync all posts)**.
2. Notes are created/updated in the **Pull folder** (or vault root), each with `sanity_id`, `sanity_draft`, the title, and all configured sync fields.
3. Edit a pulled note and run **Publish to Sanity** — changes go back to the same Sanity document.

## Notes & caveats

- The plugin calls the Sanity HTTP API directly from inside Obsidian, so **no CORS configuration** is needed in your Sanity project.
- The API token needs **Editor (or Admin)** role — a read-only token causes `403 insufficientPermissions (update)` at publish.
- Publishing creates a **published** document and **deletes the draft** if one exists, avoiding duplicate draft/published pairs.
- **Pull excludes drafts** (`drafts.*`); it only brings published documents into Obsidian.
- Mobile (Obsidian for iOS/Android) is fully supported; the plugin uses only Obsidian's built-in YAML API, no Node-only packages.
- Use **Content divider** to publish only the portion of a note above a marker line.

## Contributing

Issues and pull requests are welcome.
