# Changelog / 更新紀錄

## 1.3.0 — Flexible layouts and smarter recent notes / 多種版面與近期筆記改進

- Release the four list layouts with separate desktop/mobile preferences: Classic cards, Compact list, Slim cards and Two-column wall. Desktop keeps Classic cards; mobile defaults to Slim cards. Choose Mobile layout → Classic cards to restore the previous appearance.
- Count Markdown body changes as effective edits by default, so automatic frontmatter rewrites do not move notes forward. An advanced setting includes frontmatter changes when needed.
- Add optional PDF, image, Bases, audio, video and custom-extension entries. Additional file types use metadata only and are not decoded as text.
- Add optional cross-device sorting history through per-device Markdown records in `ReNotes Sync/devices`, using the user's existing Vault sync service. It is off by default; recent-open history requires its own opt-in. Records contain paths, times and fingerprints, not note contents.
- Simplify settings into sections, add multiple file-type filters, and remember selected filters when enabled. Preserve existing settings and pins during layout migration.
- Keep the known limits: compact layouts omit linked-note chips and detailed Canvas statistics; Wall disables its drag handle. Earlier effective times already overwritten by older versions cannot be restored automatically, and files above the hash-size limit use mtime.
- **繁體中文：**正式推出四種清單版面，桌機與手機可分別設定；手機預設瘦身卡片，可選回經典卡片。有效編輯排序預設只計內文，避免其他外掛重寫屬性時讓筆記往前跳。可選擇額外檔案類型、多選並記住篩選；額外類型只讀基本資訊。跨裝置排序紀錄預設關閉，啟用後透過既有 Vault 同步服務交換路徑、時間與指紋，不含筆記全文；開啟紀錄需另行啟用。升級保留既有設定與釘選。

## 1.3.0-beta.1 — Four list layouts / 四種清單版面

- Add independent desktop/mobile radio-card selectors for Classic cards, Compact list, Slim cards, and Two-column wall; mobile also offers Follow desktop. Open views redraw immediately using their current items, without file reads.
- Desktop retains Classic cards by default; mobile defaults to Slim cards. Select Mobile layout → Classic cards to restore the previous appearance.
- Compact layouts share existing thumbnails, opening, selection, pins, menus, deletion and progressive rendering. Compact list has an expandable single-row search; Slim/Wall use inline search. Wall uses row-major equal-height grid rows, falls back to Slim below 300px and gains desktop auto-fill columns above 520px; its drag handle is disabled.
- v5→v6 adds only layout preference keys and the version marker, retaining existing settings and pins. Layouts use theme colors and relative UI font sizes. Density adjusts List/Slim vertical padding; the older mobile layout style remains Classic-only.
- **繁體中文：**新增經典卡片、緊湊清單、瘦身卡片、雙欄牆，桌機與手機分別設定並即時套用。手機預設瘦身卡片，桌機不變；在「手機版面」選回「經典卡片」即可恢復。牆模式依序由左至右排列，低於 300px 退回瘦身卡片，桌機超過 520px 增欄，停用拖曳把手。新版面省略連結晶片與詳細統計以維持精簡；相關開關及經典卡片功能保留。v5→v6 保留原設定與釘選。

## 1.2.4-beta.5 — Effective edits ignore frontmatter by default

- Effective edit sorting counts Markdown body changes by default. Automatic property rewrites by other plugins, including Canvas backup links, keep notes in place.
- Add **Count frontmatter changes as edits**, off by default, beside **Reset effective edit-time baseline** in advanced settings. Switching the setting preserves the current order.
- Migrate old full-file fingerprints on observation: retain the saved effective time when the legacy fingerprint matches; otherwise use current mtime. Invalidate older preview caches and retain both hashes for cache-hit consistency. Canvas fingerprints, other sorting modes, local editing, and sync schema 1 stay compatible.
- **Known limitation:** timestamps already advanced by an older version cannot be recovered automatically. Resetting the baseline uses current mtime, without restoring earlier times. Files above the configured hash-size limit still use mtime.
- **繁體中文：**預設只有內文改變才算有效編輯；其他外掛自動改屬性不會讓筆記跳到最前面。可在設定開啟「屬性（Frontmatter）變更也算編輯」，切換本身不重排。既有時間與快取相容遷移；已因舊版被抬到前面的筆記，其時間已記錄為新的 mtime，無法自動回溯。

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
