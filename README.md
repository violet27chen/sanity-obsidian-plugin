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

## Understanding your Sanity structure (read this first)

The plugin is **completely schema-agnostic** — it does not hard-code any field names. Every field name you enter in the settings must come from **your own Sanity schema**. Before filling the settings, know these four identifiers:

| Concept | What it is | Where to find it |
|---|---|---|
| **Project ID** | A short ID like `3hwpvo77` that identifies your Sanity project. | [sanity.io/manage](https://www.sanity.io/manage) → your project → the ID is shown in the URL and project header. |
| **Dataset** | A named container inside the project (usually `production` or `development`). | sanity.io/manage → project → **Datasets**. |
| **Document type** | The type name you defined in your Studio schema (e.g. `post`, `author`, `product`, `article`). The plugin syncs **one** type at a time. | Your Sanity Studio → **Schema** / **Structure**, or the `_type` field of a document. |
| **Schema field** | The individual field names inside that type, e.g. `title`, `body`, `slug`, `heroImage`, or any custom field you added. | Your Studio schema definition, or open a document and look at its fields. |

> 💡 **Rule of thumb:** anything you type into the plugin settings (type name, title field, body field, GROQ paths in sync rows) must exactly match a name that exists in **your** Sanity schema. If a field name is wrong, sync silently skips it or the publish fails.

A quick mental model:

- **Type name** = which kind of document you want to sync.
- **Title / Body field** = which two fields of that document hold the title and the Markdown body.
- **Additional fields to sync** = every *other* field you want to round-trip into the note's frontmatter.

## Settings

Open **Settings → Sanity**. Every field is explained below.

| Setting | Default | What to put |
|---|---|---|
| **Sanity API token** | empty | A Sanity API token with **Editor (or Admin) role**. A Viewer/read-only token will fail at publish with `403 insufficientPermissions (update)`. Generate one at sanity.io → project → API → Tokens. |
| **Project ID** | empty | Your Sanity project ID (e.g. `3hwpvo77`). See the table above. |
| **Dataset name** | `production` | The dataset to sync with (e.g. `production`, `development`). |
| **Type name** | `post` | The document type to sync. **This is your own schema type name** — it can be `post`, but also `author`, `product`, `article`, `note`, or anything you defined. The plugin syncs all published documents of this type. |
| **Title field** | empty | The schema field that holds the title, e.g. `title` for a blog, `name` for an author, `label` for a product. Leave blank to skip syncing the title (filename is then used as title). |
| **Body field** | `body` | The schema field that holds the document body as raw Markdown, e.g. `body`, `bio`, `content`, `description`. |
| **Filename field** | empty | Which Sanity field generates the Obsidian filename / slug. GROQ paths allowed, e.g. `slug.current`. Left blank → falls back to **Title field** → `slug.current` → `sanity_id`. |
| **Content divider** | empty | A marker string; anything below it in the note is NOT published. |
| **Pull folder** | empty | Folder where pulled notes are saved. Blank → vault root. |
| **Custom API base URL** | empty | Reverse-proxy URL for when `api.sanity.io` is unreachable (e.g. mainland China). All query/mutate/upload calls go through it. Blank → default host. |
| **Additional fields to sync** | empty | Extra Sanity fields ↔ frontmatter mappings (see below). **Empty by default** — add the fields you actually need. |
| **Announcement text / link / type** | empty / `info` | Site announcement; used by the *Publish announcement to Sanity* command. Leave text empty to show nothing. |

### Additional fields to sync — how to fill

This is the most flexible setting. It maps arbitrary Sanity fields into each note's frontmatter (and back on publish). **It is empty by default** — nothing is synced except the title and body until you add rows.

- **Format:** one row per field — `Sanity field : frontmatter key`.
  - **Left** = the Sanity field name. GROQ paths are allowed, e.g. `slug.current`, `heroImage`, `social.github`.
  - **Right** = the frontmatter key to map it to. **This is the name you want inside the Obsidian note** — it does not have to equal the Sanity field name. Leave it blank to reuse the left-side name as the key.
- Up to **10 rows**; blank rows are ignored.
- **Pull:** these Sanity fields are written into the note's frontmatter (image objects become Sanity CDN URLs automatically).
- **Publish:** the same frontmatter keys are written back to Sanity (CDN URLs are converted back to asset references; local image paths / `[[ ]]` are uploaded).
- **Arrays:** a field that is an array in Sanity (e.g. `categories[]`, `tags[]`) is written back as a YAML list — just write the field name, no special syntax.
- **Nested objects:** dot-notation paths like `slug.current` are expanded into nested objects on write (`slug: { current: "..." }`).
- **Image fields:** any field whose Sanity value is an `image` object (e.g. `heroImage`, `avatar`, `cover`) is auto-converted: on pull → a `cdn.sanity.io` URL in frontmatter; on publish → back to an asset reference (or uploaded if it is a local path).

> 💡 **Cover image vs body images**
> Cover / thumbnail / avatar fields live **here** as image-object fields (e.g. `heroImage:heroImage`, `avatar:avatar`).
> **Body images** inside the note (`![[image]]` or `![alt](image)`) are uploaded automatically on publish and do **not** need a row here.

**Blog example** (left → right):

```
slug.current   →   slug
description     →   description
publishedAt     →   published
categories      →   categories
series          →   series
heroImage       →   heroImage
```

**Non-blog example** — imagine a Sanity `author` type with fields `name`, `bio`, `avatar` (image), `social` (object with `github`), `slug`:

```
avatar         →   avatar
social.github   →   github
slug.current    →   slug
```

With that, the settings would be: Type name = `author`, Title field = `name`, Body field = `bio`, Filename field = `slug.current`, and the three rows above. The note's frontmatter would end up with `avatar`, `github`, and `slug` keys — note that `github` is a custom name you chose for `social.github`.

Delete all rows (or leave them blank) to sync only the title and body.

### Custom API base URL (GFW / proxy)

By default the plugin talks to `https://<projectId>.api.sanity.io`. In some networks (e.g. mainland China) that host is unreachable while the Sanity CDN (`cdn.sanity.io`) stays up. Enter a reverse-proxy URL — e.g. `https://sanity-api.your-domain.com` — and **all** API calls (query, mutate, upload) route through it. The path after the host is preserved, so nothing else changes. Leave blank to use the default host.

### Set up the reverse proxy on EdgeOne (optional)

EdgeOne is a good fit here because its edge nodes are densely distributed across mainland China and the Asia–Pacific — clients in China are served from a nearby node, so latency drops and the Sanity API stays reachable where `api.sanity.io` is slow or blocked. If you run the proxy on Tencent EdgeOne's edge-acceleration platform, configure these three fields:

| Field | Value |
|---|---|
| **Acceleration domain** | Your own subdomain, e.g. `sanity-api.your-domain.com` — this is the URL you paste into *Custom API base URL*. |
| **Origin domain** | `<projectId>.api.sanity.io` (e.g. `3hwpvo77.api.sanity.io`). Forward the path 1:1; do not rewrite it. |
| **Origin request headers** | `Host: <projectId>.api.sanity.io` and `Authorization: Bearer <SANITY_TOKEN>`. Sanity requires the `Host` header or it rejects the request; the `Authorization` header authenticates on the client's behalf. |

> ⚠️ The `Authorization` header carries a real Sanity token. Only enable this on a proxy you control, and prefer a token scoped to your project.

Once the proxy is live, paste its URL into **Settings → Sanity → Custom API base URL** — every query, mutate, and upload call then routes through the edge proxy.

## Note frontmatter — what the plugin reads/writes

| Frontmatter key | Filled by | Meaning / how to use |
|---|---|---|
| `sanity_id` | plugin (auto) | The Sanity `_id` of the document. The round-trip key — publishing the note later updates the **same** Sanity document. **Do not set it by hand.** If it points to `drafts.x`, publish lands on the matching published doc `x` and deletes the draft. |
| `sanity_draft` | plugin (auto) | `true`/`false` — marks whether the source was a draft. Set by Pull; the publish logic does not consume it. |
| Title field (whatever you configured, e.g. `title` / `name`) | you / plugin | The title. On publish the plugin prefers this field; if absent it falls back to the filename. |
| Body field (whatever you configured, e.g. `body` / `bio`) | plugin | The document body (raw Markdown). |
| Your sync-field keys (e.g. `categories`, `slug`, `heroImage`, `github`) | you / plugin | Mapped via *Additional fields to sync*. Written back to Sanity on publish, filled in on pull. The key name is the one you put on the **right** of each sync row. |
| Image fields (e.g. `heroImage`, `avatar`) | you | Local image path (`[[ ]]` allowed) or a `cdn.sanity.io` URL. Uploaded / reference-restored automatically. |

> Body images (`![[img]]` / `![alt](img)`) are uploaded automatically on publish and replaced with CDN URLs — no frontmatter key needed.

## Commands

Open the command palette (Ctrl/Cmd + P) and search **Sanity**:

- **Publish to Sanity** — create or update the Sanity document for the active note. On success, `sanity_id` is written to the note. Publishes as a **published** document and removes any matching draft.
- **Pull from Sanity (sync all posts)** — pull **all published documents** of the configured type into Obsidian (drafts are excluded). No open document needed.
- **Publish announcement to Sanity** — push the *Site announcement* settings to the `siteSettings` singleton.

## Workflow

### Publish a note

1. Fill the note's frontmatter (the title field, and any sync fields you configured — e.g. `heroImage`, `categories`, or your custom keys).
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

## Acknowledgements

This plugin is a fork of `drewlyton/sanity-obsidian-plugin`. Many thanks to [@drewlyton](https://github.com/drewlyton) for the original work this plugin is built upon.
