# Sanity Publish for Obsidian

![Obsidian logo and Sanity logo together](cover-image.png)

Sanity Publish is a plugin for Obsidian that allows you to publish and sync documents from your Obsidian vault to your Sanity Studio.

## ⬇️ Installing the plugin

**Sanity Publish is in alpha and not currently available through the Community Plugins marketplace.** So, in order to install it into your Obsidian vault, you'll have to clone the repository manually. You can do that by running the following command from your vault's root directory:

```
cd .obsidian/plugins && git clone https://github.com/drewlyton/sanity-obsidian-plugin.git
```

Once the repo is cloned into your `plugins` folder, restart Obsidian and navigate to 'Settings'. You should see 'Sanity Publish' in your list of Installed Plugins. Enable the plugin and then navigate to the plugin settings to continue configuration.

## ⚙️ Plugin Settings

### Sanity API Token

In order for Obsidian to sync data with your Sanity studio, you must provide an API token for your Sanity project with _read/write access_. You can find a [guide for how to generate Sanity access tokens here](https://www.sanity.io/docs/http-auth).

**Note:** by providing this API token, you are granting 'Sanity Publish' and _any other_ installed Obsidian plugin the ability to publish to your Studio on your behalf. Tread lightly here and ensure that you trust the authors of all plugins in your vault before doing this.

### Sanity Project ID

Paste your Sanity project id into this field.

### Sanity Dataset Name

Provide the name of the dataset you'd like to publish documents to. This defaults to 'production'.

### Sanity Document Type Name

Provide the name of document type in your Sanity project's schema that you'd like to publish documents to (i.e. 'post' or 'blog')

### Sanity Title Field

Provide the field name that represents a `title` in your project's schema. Sanity Publish will sync the file name in Obsidian with this field. If you don't want to sync the file name, you can leave this blank.

### Sanity Body Field

Provide the field name that matches the body of your file's content. Sanity Publish will sync the Obsidian document's contents with this field in your studio.

## 🙌 Hitting Publish

Once you've configured the plugin settings, you can navigate to a document you'd like to publish, open the command pallete, and search for `Sanity Publish`.

Hitting enter will create or update a _draft_ document in your Sanity Studio. It will also update the frontmatter of your file in Obsidian to store the `sanity_id`. This allows you to update the document after it's initially published.

**Note** that changing or removing this `sanity_id` may have unintended consequences. However, it can also be very useful to update this ID field once you've published your document in the Studio. This allows you to update the title and body of your published document right from Obsidian!

## 🌄 Uploading Images

One convenient additional feature of Sanity Publish is the ability to upload images to Sanity from Obsidian. By right clicking on an embedded image in your Obsidian document, you can click the `Upload to Sanity` menu action and automatically have your image uploaded and the content of your document changed to link to the Sanity CDN.

When you publish a document, we automatically run this process on all embedded images.

## 🤓 Advanced Settings

If you're like me, while working on an article I often keep previous drafts and cut content below a comment in the document. Something along the lines of:

```md
Content I want to publish

<!-- DRAFTS -->

Content I don't want to publish
```

Sanity Publish allows you to set a "Content Divider" string for this reason. Just paste your usual divider comment text and when you go to publish, the only content that will be published to Sanity will be that which is above that dividing line.

## 🙏 Contributing

Sanity Publish is currently mostly a personal pet project for my own publishing workflow. However, if you find it useful and come across any bugs or feature ideas while using it, please make a new issue here on GitHub.

---

# 🔄 Bidirectional: Pull from Sanity (added in this fork)

This fork adds a **Pull** command so Obsidian can stay in sync with your Sanity Studio — not just publish _to_ it.

Open the command palette and run **`Pull from Sanity (sync all posts)`**. It does **not** require an open document; it scans your whole vault.

What it does:

- Queries Sanity for **all** documents of the configured type (default `post`), **including drafts**.
- Writes each document into your vault as a Markdown note:
  - **Filename**: uses `slug.current` if present, otherwise the title field, otherwise the Sanity `_id`. Invalid filename characters are sanitized.
  - **Frontmatter** always includes:
    - `sanity_id: <_id>` — the round-trip key. Publishing the note later patches the same Sanity document.
    - `sanity_draft: true | false` — **distinguishes drafts from published documents**. Drafts (`drafts.*`) get `sanity_draft: true`; published (`post.*`) get `sanity_draft: false`.
- **Dedupes**: if a note with the same `sanity_id` already exists in your vault, it is updated in place (content + `sanity_draft` flag) while preserving any other frontmatter you added. New documents are created; name collisions get a numeric suffix.

### Pull folder (Advanced setting)

A new **`Pull folder`** setting controls where pulled notes are saved. Leave it blank to save at the **vault root** (default). Set it to e.g. `Sanity` to keep pulled posts in a dedicated folder.

### Behavior notes

- A pulled **draft** (`sanity_draft: true`, `sanity_id: drafts.xxx`) → editing it and hitting **Publish** updates the Sanity draft (does **not** trigger your deploy webhook; publish it from your admin UI to go live).
- A pulled **published** document (`sanity_draft: false`, `sanity_id: post.xxx`) → editing it and hitting **Publish** updates the live document and **will** trigger your deploy webhook.

This matches the one-way publish design: the Obsidian plugin creates/updates drafts, while going live is handled by your Sanity admin UI.

---

# 🛡️ CORS fix (this fork)

The original plugin uses `@sanity/client` (browser `fetch`) to talk to the Sanity API. Inside Obsidian the request origin is `app://obsidian.md`, which Sanity treats as cross-origin. Sanity's CORS settings **reject the `app://` protocol**, so you can't whitelist it — every Publish fails with:

```
from origin 'app://obsidian.md' has been blocked by CORS policy
```

This fork rewrites the two HTTP methods to use Obsidian's built-in **`requestUrl`**, which calls Sanity's HTTP API directly from the desktop app and bypasses the browser CORS entirely. No Sanity CORS whitelist is needed.

- `uploadFileToSanity` → `POST …/assets/images|files/<dataset>?filename=` (binary upload)
- `createorUpdateDocument` → `POST …/data/mutate/<dataset>` (create / patch transaction)
- New `sanityMutate()` helper
- New documents get a valid draft id (`drafts.<random>`), avoiding the upstream `drafts.` rejection

---

# 📦 Install this fork via BRAT

For long-term use, install the CORS-fixed, bidirectional fork through [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from Community Plugins, then add a beta plugin with the repository:
   ```
   violet27chen/sanity-obsidian-plugin
   ```
2. The latest release (e.g. `v1.1.0`) is detected automatically. Enable **Sanity Publish** and configure your token / project id / dataset / fields.
3. To pull or publish, open the command palette and run `Pull from Sanity (sync all posts)` or `Publish to Sanity`.

Releases are tagged (e.g. `v1.1.0`) with `main.js`, `manifest.json`, `manifest-beta.json`, and `styles.css` attached, so BRAT never falls back to the unpatched upstream build.
