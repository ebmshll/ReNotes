# Changelog / 更新紀錄

## 1.2.3 — Obsidian review compatibility

- Remove unsupported CSS `display: contents` while preserving responsive cards and the date navigator.
- Hide the date popover without CSS `!important`.
- Update `manifest.json` description and release assets for community review.
- Add a GitHub Actions workflow to cryptographically attest release artifacts (`main.js`, `styles.css`, `manifest.json`).
- **繁體中文：**改善 Obsidian CSS 相容性、版本描述與發布檔案驗證；原有操作功能保留。

## v1.2.2 — English and Traditional Chinese / 雙語介面

- Automatically follows the Obsidian language or allows manual Traditional Chinese and English selection.
- Localizes sidebar controls, card metadata, date navigation, filtering, settings, most context-menu actions, dialogs, notices, and accessibility labels. A few secondary file-menu labels remain in Chinese.
- Formats English weekdays, month headings, note counts, and singular/plural labels.
- Adds four feature illustrations: Traditional Chinese and English sidebars, date navigation, and Canvas linked-document chips.
- **繁體中文：**新增介面語言設定與英文翻譯，補齊日期、選單、通知和設定介面；加入功能示範縮圖。

## v1.2.1 — Linked notes and Canvas only
- Show `.md` and `.canvas` links under Canvas cards; skip image and media attachments.
- Calculate `+N` only from eligible linked documents.
- Apply filtering to cached links consistently.

## v1.2.0 — A1 links and date navigation
- Add fine-outline linked-note chips below Canvas cards.
- Center the type icon and time beneath thumbnails.
- Add the date-jump menu with per-day counts and older dates by month.
- Highlight Yesterday in the date-group header.

## v1.1.4
- Preserve the original Canvas tab when opening a linked note.

## v1.1.3
- Fix four-square Canvas icon compatibility.
