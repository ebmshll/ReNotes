# ReNotes

**ReNotes** is a recent-notes sidebar for Obsidian, with support for Markdown notes and Canvas boards.

**ReNotes** 是 Obsidian 的近期筆記側欄外掛，可瀏覽 Markdown 筆記與 Canvas 白板。

## Features / 主要功能

- Recent Markdown and Canvas cards with search, sorting, grouping, pinning, and adaptive display densities.
- Optional note-image and Canvas-node thumbnails; compact and multi-column layouts.
- A1 fine-outline chips below Canvas cards link only to Markdown (`.md`) and Canvas (`.canvas`) files; images and other attachments are excluded.
- Linked-chip labels show up to five characters; the full title is available on hover. Overflow counters count only eligible notes and boards.
- The file-type icon and time are centered below the thumbnail when thumbnails are visible.
- Date navigator (`⋯`) shows up to seven recent dates with counts, and older dates organized by month. Selecting a date scrolls to that day without filtering notes.
- Pinned cards and local effective-edit-time sorting.
- Desktop drag handles for Markdown-to-Canvas using internal Obsidian drag behavior (version compatibility may vary).

## Install / 安裝

1. Download `ReNotes-v1.2.1.zip` from the latest GitHub Release.
2. Extract `main.js`, `styles.css`, and `manifest.json` into `.obsidian/plugins/recent-notes-feed/` inside your Vault.
3. Restart Obsidian or reload community plugins, then enable **ReNotes** in **Settings → Community plugins**.

安裝方式：從 Releases 下載 ZIP，解壓縮至 Vault 的 `.obsidian/plugins/recent-notes-feed/` 資料夾，再到「設定 → 社群外掛」啟用 **ReNotes**。

This is a third-party plugin project and not an official Obsidian release. The manifest specifies a minimum version of Obsidian 1.4.0; compatibility with every subsequent release or device is not guaranteed.

## Data and privacy / 資料與隱私

- The repository and downloadable release contain only the plugin implementation and public documentation.
- Personal settings (`data.json`), sync-conflict copies, vault files, caches, and internal test fixtures are not included.
- Local sorting activity and settings stay inside the Obsidian Vault. Publishing this repository does not publish note or Canvas content.

本次發佈不包含個人設定、同步副本、筆記、Canvas 實際內容或本機測試資料。

## Versions

- **v1.2.1:** Canvas linked-note chips display only `.md` and `.canvas`; legacy cached media links are also filtered.
- **v1.2.0:** A1 fine-outline links; centered icon and time; seven-date navigator, monthly older-date jump, and Yesterday highlight.
- **v1.1.4:** Preserve the open Canvas editor when following a linked note.

Read the full [changelog](CHANGELOG.md).

## Source and permissions

The repository is public for viewing and downloading. No additional reuse license is granted unless an explicit license is added.
