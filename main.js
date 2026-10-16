const {
  ItemView,
  Notice,
  Menu,
  Plugin,
  PluginSettingTab,
  Modal,
  Setting,
  TFile,
  Platform,
  setIcon,
  addIcon
} = require("obsidian");

const VIEW_TYPE_RECENT_NOTES_FEED = "recent-notes-feed-view";
const CACHE_FORMAT_VERSION = "0.9.0";
const ACTIVITY_STORAGE_KEY = "recent-notes-feed:activity";
const EFFECTIVE_STORAGE_KEY = "renotes:effective";
const RENOTES_ICON = '<g transform="scale(4.1666667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M9.5 16.5V7.5h3.4a2.6 2.6 0 0 1 0 5.2H9.5M12.6 12.7l2.6 3.8"/></g>';

const DEFAULT_SETTINGS = {
  layoutVersion: 5,
  pinnedPaths: [],
  maxNotes: 50,
  snippetLines: null, // null follows layout density
  openInNewTab: false,
  includeCanvas: true,
  canvasPreviewMode: "smart", // smart | text | files | stats
  canvasPreviewItemLimit: 5,
  showCanvasStats: false,
  showCanvasLinkedFiles: false,
  showSnippet: true,
  showSearch: true,
  groupByDate: true,
  showFolder: false,
  showImageThumbnail: true,
  showCanvasThumbnail: true,
  titleSource: "auto", // auto | filename | h1
  dateFormat: "short", // short | full
  excludedFolders: "Templates\nArchive",
  includedFolders: "",
  excludedTags: "#archive\n#封存",
  debounceMs: 600,
  emptySnippetText: "沒有其他文字",
  viewLocation: "left", // left | right
  debugMode: false,
  listDensity: "standard", // compact | standard | card
  mobileOptimized: true,
  mobileLayout: "comfortable", // compact | comfortable | reading
  mobileSnippetLines: null, // null or legacy 0 follows desktop setting
  mobileShowMenuButton: true,
  mobileLongPressMenu: true,
  mobileCompactHeader: true,
  mobileHideCanvasDetails: false,
  enableCache: true,
  cacheMaxEntries: 1200,
  cacheMaxFileSizeBytes: 2097152,
  progressiveRender: true,
  enableCanvasDrag: true,
  renderBatchSize: 30,
  showPerformanceStats: true,
  showTypeFilter: true,
  defaultTypeFilter: "all", // all | markdown | canvas
  showResultCount: true,
  showTags: false,
  stickyHeader: true,
  sortMode: "effective", // effective | mtime | opened | localEdit | smart
  trackRecentOpened: true,
  trackLocalEdits: true,
  showSortReason: false,
  confirmContentChange: true,
  mobileFalseEditGuard: true,
  hashDebounceMs: 900,
  mobileHashDebounceMs: 1800,
  maxHashFileSizeBytes: 1048576,
  baselineContentHashOnOpen: true
};

function debounce(fn, wait) {
  let timeout = null;
  const debounced = (...args) => {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => {
    if (timeout) window.clearTimeout(timeout);
    timeout = null;
  };
  return debounced;
}

function normalizeList(value) {
  return String(value || "")
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFolder(folder) {
  return folder.replace(/^\/+|\/+$/g, "");
}

function fileIsInFolder(file, folder) {
  const normalized = normalizeFolder(folder);
  if (!normalized) return false;
  return file.path === normalized || file.path.startsWith(normalized + "/");
}

function isSupportedRecentFile(file, settings) {
  if (!(file instanceof TFile)) return false;
  if (file.extension === "md") return true;
  if (settings && settings.includeCanvas !== false && file.extension === "canvas") return true;
  return false;
}

function basenameFromPath(path) {
  return String(path || "")
    .split("/")
    .pop()
    .replace(/\.(md|canvas)$/i, "");
}

function removeYamlFrontmatter(content) {
  return content.replace(/^---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/, "");
}

function getFirstH1(content) {
  const withoutFrontmatter = removeYamlFrontmatter(content);
  const match = withoutFrontmatter.match(/^#\s+(.+)$/m);
  return match ? cleanInlineMarkdown(match[1]).trim() : "";
}

function cleanInlineMarkdown(text) {
  return String(text || "")
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]|]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/[*~]/g, "")
    .replace(/^[>#]+\s*/, "")
    .replace(/\^\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownForSnippet(content, basename) {
  let text = removeYamlFrontmatter(content);

  // Remove fenced code blocks and HTML comments.
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/~~~[\s\S]*?~~~/g, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  const lines = text.split(/\r?\n/g);
  const cleanedLines = [];
  let skippedFirstH1 = false;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Skip headings equal to filename, but keep meaningful headings as preview text.
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const headingText = cleanInlineMarkdown(heading[1]);
      if (headingText === basename) continue;
      // 卡片標題通常就是第一個 H1，預覽重複顯示沒有意義。
      if (!skippedFirstH1 && /^#\s/.test(line)) { skippedFirstH1 = true; continue; }
      line = headingText;
    }

    // Skip common non-content lines.
    if (/^[-*+]\s*\[[ xX]\]\s*$/.test(line)) continue;
    if (/^\|?\s*[-:]+\s*\|/.test(line)) continue;
    if (/^%%/.test(line)) continue;
    if (/^>\s*\[!/.test(line)) continue;
    if (/^(#[^\s#]+\s*)+$/.test(line)) continue;

    // Remove list/task markers while keeping actual text.
    line = line.replace(/^[-*+]\s+/, "");
    line = line.replace(/^\d+\.\s+/, "");
    line = line.replace(/^[-*+]\s*\[[ xX]\]\s+/, "");

    line = cleanInlineMarkdown(line);
    if (line) cleanedLines.push(line);
  }

  return cleanedLines;
}

function shortenUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "";
    return truncate(`${parsed.hostname}${path}`, 48);
  } catch (error) {
    return truncate(raw.replace(/^https?:\/\//i, ""), 48);
  }
}

function pushUniqueByKey(list, item, keyFn) {
  const key = keyFn(item);
  if (!key) return;
  if (list.some((existing) => keyFn(existing) === key)) return;
  list.push(item);
}

function isCanvasDocumentFilePath(filePath) {
  return typeof filePath === "string" && /\.(?:md|canvas)$/i.test(filePath.trim());
}

function filterCanvasDocumentLinks(links) {
  return Array.isArray(links) ? links.filter((link) => link && isCanvasDocumentFilePath(link.path)) : [];
}

function parseCanvasContent(content, includeThumbnail = true) {
  const info = {
    invalid: false,
    nodeCount: 0,
    edgeCount: 0,
    textNodes: 0,
    fileNodes: 0,
    linkNodes: 0,
    groupNodes: 0,
    textLines: [],
    linkedFiles: [],
    groupLabels: [],
    urls: [],
    colors: [],
    thumbnailNodes: includeThumbnail ? [] : null
  };

  try {
    const data = JSON.parse(content || "{}");
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    if (includeThumbnail) info.thumbnailNodes = scaleCanvasNodes(nodes);
    info.nodeCount = nodes.length;
    info.edgeCount = edges.length;

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      if (node.color) {
        const color = String(node.color).trim();
        if (color && !info.colors.includes(color)) info.colors.push(color);
      }

      if (node.type === "text") {
        info.textNodes += 1;
        const lines = stripMarkdownForSnippet(String(node.text || ""), "");
        for (const line of lines) {
          if (line && !info.textLines.includes(line)) info.textLines.push(line);
        }
        continue;
      }

      if (node.type === "file") {
        info.fileNodes += 1;
        const filePath = String(node.file || "").trim();
        if (isCanvasDocumentFilePath(filePath)) {
          pushUniqueByKey(info.linkedFiles, {
            path: filePath,
            title: basenameFromPath(filePath)
          }, (item) => item.path);
        }
        continue;
      }

      if (node.type === "group") {
        info.groupNodes += 1;
        const label = cleanInlineMarkdown(String(node.label || ""));
        if (label && !info.groupLabels.includes(label)) info.groupLabels.push(label);
        continue;
      }

      if (node.type === "link") {
        info.linkNodes += 1;
        const url = String(node.url || node.link || "").trim();
        if (url) {
          pushUniqueByKey(info.urls, {
            url,
            title: shortenUrl(url)
          }, (item) => item.url);
        }
      }
    }

    return info;
  } catch (error) {
    info.invalid = true;
    return info;
  }
}

function formatCanvasStatsText(info) {
  if (!info || info.invalid) return "Canvas 白板";
  const parts = [];
  if (info.nodeCount) parts.push(`${info.nodeCount} 個元素`);
  if (info.fileNodes) parts.push(`${info.fileNodes} 筆記`);
  if (info.textNodes) parts.push(`${info.textNodes} 文字`);
  if (info.groupNodes) parts.push(`${info.groupNodes} 分組`);
  if (info.linkNodes) parts.push(`${info.linkNodes} 網頁`);
  if (info.edgeCount) parts.push(`${info.edgeCount} 連線`);
  return parts.length > 0 ? parts.join(" · ") : "空白 Canvas";
}

function getCanvasPreviewLimit(settings) {
  const configured = Number(settings && settings.canvasPreviewItemLimit);
  if (!Number.isFinite(configured)) return 5;
  return Math.max(1, Math.min(configured, 20));
}

function getCanvasPreviewLinesFromInfo(info, settings) {
  if (!info || info.invalid) return ["Canvas 白板"];

  const limit = getCanvasPreviewLimit(settings);
  const mode = settings && settings.canvasPreviewMode ? settings.canvasPreviewMode : "smart";
  const fileNames = filterCanvasDocumentLinks(info.linkedFiles).map((file) => file.title).filter(Boolean);
  const urlNames = info.urls.map((item) => item.title).filter(Boolean);

  if (mode === "text") {
    return info.textLines.length > 0 ? info.textLines.slice(0, limit) : [formatCanvasStatsText(info)];
  }

  if (mode === "files") {
    if (fileNames.length > 0) return ["連結筆記：" + fileNames.slice(0, limit).join("、")];
    if (info.groupLabels.length > 0) return ["分組：" + info.groupLabels.slice(0, limit).join("、")];
    return [formatCanvasStatsText(info)];
  }

  if (mode === "stats") {
    return [formatCanvasStatsText(info)];
  }

  if (info.textLines.length > 0) return info.textLines.slice(0, limit);
  if (info.groupLabels.length > 0) return ["分組：" + info.groupLabels.slice(0, limit).join("、")];
  if (fileNames.length > 0) return ["連結筆記：" + fileNames.slice(0, limit).join("、")];
  if (urlNames.length > 0) return ["網頁：" + urlNames.slice(0, limit).join("、")];
  if (info.nodeCount > 0 || info.edgeCount > 0) return [formatCanvasStatsText(info)];
  return [];
}

function stripCanvasForSnippet(content, settings) {
  return getCanvasPreviewLinesFromInfo(parseCanvasContent(content), settings || DEFAULT_SETTINGS);
}

function getCanvasSearchText(info) {
  if (!info || info.invalid) return "Canvas 白板";
  const fileText = filterCanvasDocumentLinks(info.linkedFiles).map((file) => `${file.title} ${file.path}`).join(" ");
  const urlText = info.urls.map((item) => `${item.title} ${item.url}`).join(" ");
  return [
    info.textLines.join(" "),
    info.groupLabels.join(" "),
    fileText,
    urlText,
    formatCanvasStatsText(info)
  ].filter(Boolean).join(" ");
}

function collectTags(content) {
  const tags = new Set();
  const frontmatter = content.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
  if (frontmatter) {
    const fm = frontmatter[1];
    const tagLines = fm.match(/^tags:\s*([\s\S]*?)(?=\n\w|$)/m);
    if (tagLines) {
      String(tagLines[1])
        .split(/[\s,\[\]\r\n-]+/g)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tags.add(tag.startsWith("#") ? tag : "#" + tag));
    }
  }
  const inlineMatches = content.match(/(^|\s)#([\p{L}\p{N}_/-]+)/gu) || [];
  for (const match of inlineMatches) {
    const tag = match.trim();
    if (tag.length > 1) tags.add(tag);
  }
  return Array.from(tags);
}

function truncate(text, maxLength) {
  if (!text) return text;
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + "…" : text;
}

function getFileStatNumber(file, key) {
  return Number(file && file.stat && file.stat[key]) || 0;
}

function getFileReadStamp(file) {
  return `${getFileStatNumber(file, "mtime")}:${getFileStatNumber(file, "size")}`;
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function scheduleUiTask(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getDateGroup(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - 7);
  if (sameLocalDay(date, today) || sameLocalDay(date, yesterday)) {
    const isToday = sameLocalDay(date, today);
    const label = isToday ? "今天" : "昨天";
    return { key: isToday ? "today" : "yesterday", label, number: String(date.getDate()), today: isToday, showDay: true };
  }
  if (date >= start && date < yesterday) {
    return { key: "week", label: "過去 7 天" };
  }
  const month = date.getMonth() + 1;
  const crossYear = date.getFullYear() !== today.getFullYear();
  return { key: date.getFullYear() + "-" + month, label: (crossYear ? date.getFullYear() + "年 " : "") + month + "月" };
}

function formatDateGroup(timestamp, now = Date.now()) {
  return getDateGroup(timestamp, now).label;
}

function getRecentLocalDayKey(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
    + "-" + String(date.getDate()).padStart(2, "0");
}
function formatRecentDateLabel(timestamp, now = Date.now()) {
  const group = getDateGroup(timestamp, now);
  if (group.key === "today" || group.key === "yesterday") return group.label;
  const date = new Date(timestamp);
  const prefix = date.getFullYear() === new Date(now).getFullYear() ? "" : date.getFullYear() + "/";
  const weekday = "日一二三四五六"[date.getDay()];
  return prefix + (date.getMonth() + 1) + "/" + date.getDate() + " 週" + weekday;
}
function getRecentDateIndex(items) {
  const days = new Map();
  for (const item of items) {
    const key = getRecentLocalDayKey(item.mtime);
    if (!key) continue;
    if (!days.has(key)) days.set(key, { key, timestamp: item.mtime, count: 0 });
    days.get(key).count += 1;
  }
  return Array.from(days.values()).sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => ({ ...entry, label: formatRecentDateLabel(entry.timestamp), month: entry.key.slice(0, 7) }));
}
function truncateRecentCanvasLink(title) {
  const chars = Array.from(String(title || ""));
  return chars.length > 5 ? chars.slice(0, 4).join("") + "…" : chars.join("");
}

function formatNoteTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const group = getDateGroup(timestamp, now);
  if (group.key === "today" || group.key === "yesterday") {
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }
  if (group.key === "week") return "週" + "日一二三四五六"[date.getDay()];
  return (date.getFullYear() === new Date(now).getFullYear() ? "" : date.getFullYear() + "/") + (date.getMonth() + 1) + "/" + date.getDate();
}

function getWidthClass(width, previous) {
  if (!Number.isFinite(width) || width <= 0) return previous || "wide";
  if (previous === "wall" && width >= 512) return "wall";
  if (previous === "wide" && width >= 232 && width < 528) return "wide";
  if (previous === "compact" && width >= 142 && width < 248) return "compact";
  if (previous === "tiny" && width < 158) return "tiny";
  return width >= 520 ? "wall" : width >= 240 ? "wide" : width >= 150 ? "compact" : "tiny";
}

function scaleCanvasNodes(nodes) {
  const valid = (Array.isArray(nodes) ? nodes.slice(0, 40) : []).filter((node) => node
    && [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0);
  if (!valid.length) return [];
  const left = Math.min(...valid.map((node) => node.x));
  const top = Math.min(...valid.map((node) => node.y));
  const width = Math.max(...valid.map((node) => node.x + node.width)) - left;
  const height = Math.max(...valid.map((node) => node.y + node.height)) - top;
  if (![left, top, width, height].every(Number.isFinite)) return [];
  const scale = 56 / Math.max(width, height);
  return valid.map((node) => ({
    x: 6 + (56 - width * scale) / 2 + (node.x - left) * scale,
    y: 6 + (56 - height * scale) / 2 + (node.y - top) * scale,
    width: Math.max(0.5, node.width * scale), height: Math.max(0.5, node.height * scale),
    type: node.type === "file" || node.type === "text" ? node.type : "other"
  }));
}

function normalizePinnedPaths(paths) {
  return Array.isArray(paths) ? [...new Set(paths.filter((path) => typeof path === "string" && path.trim()))] : [];
}

function formatTime(timestamp, mode) {
  const date = new Date(timestamp);
  const now = new Date();

  if (mode === "full") {
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  if (sameLocalDay(date, now)) {
    return new Intl.DateTimeFormat("zh-TW", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getActivityMap(owner) {
  if (!owner.fileActivity || typeof owner.fileActivity !== "object" || Array.isArray(owner.fileActivity)) {
    owner.fileActivity = Object.create(null);
  }
  return owner.fileActivity;
}

function mergeActivity(local, legacy) {
  const result = Object.create(null);
  for (const map of [local, legacy]) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [path, entry] of Object.entries(map)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const previous = result[path] || {};
      const newer = (Number(entry.contentHashUpdatedAt) || 0) > (Number(previous.contentHashUpdatedAt) || 0);
      result[path] = Object.assign({}, newer ? previous : entry, newer ? entry : previous);
      for (const key of ["lastOpened", "lastLocalEdit"]) {
        const timestamps = [previous[key], entry[key]].map(Number).filter((value) => Number.isFinite(value) && value > 0);
        const value = Math.max(0, ...timestamps);
        if (Number.isFinite(value) && value > 0) result[path][key] = value;
        else delete result[path][key];
      }
    }
  }
  return result;
}

function formatRelativeTime(timestamp, mode, now = Date.now()) {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60000) return { text: "剛剛", recent: true };
  if (elapsed < 3600000) return { text: `${Math.floor(elapsed / 60000)} 分鐘`, recent: true };
  const date = new Date(timestamp);
  const today = new Date(now);
  if (sameLocalDay(date, today)) return { text: `${Math.floor(elapsed / 3600000)} 小時`, recent: false };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return { text: "昨天", recent: false };
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  if (days < 7) return { text: `${days} 天前`, recent: false };
  return { text: new Intl.DateTimeFormat("zh-TW", mode === "full"
    ? { year: "numeric", month: "numeric", day: "numeric" }
    : { month: "numeric", day: "numeric" }).format(date), recent: false };
}

function getSecondLine(item) {
  if (item.type === "canvas") return `Canvas · ${Number(item.canvas && item.canvas.fileNodes) || 0} 筆記`;
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 2) : [];
  return ["筆記", ...tags].join(" · ");
}

function getFileActivity(settings, path) {
  const map = getActivityMap(settings);
  const entry = map[path];
  return entry && typeof entry === "object" ? entry : {};
}

function simpleContentHash(content) {
  const text = String(content || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${hash >>> 0}`;
}

function stableSerialize(value, inDfgMeta = false) {
  if (Array.isArray(value)) return "[" + value.map((item) => stableSerialize(item, inDfgMeta)).join(",") + "]";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort().filter((key) => !inDfgMeta
    || !["measuredHeight", "contentHeight", "measuredFor", "measuredAt"].includes(key));
  return "{" + keys.map((key) => {
    const item = ["x", "y", "width", "height"].includes(key) && Number.isFinite(value[key])
      ? Math.round(value[key]) : value[key];
    return JSON.stringify(key) + ":" + stableSerialize(item, inDfgMeta || key === "dfgMeta");
  }).join(",") + "}";
}

function contentFingerprint(content, extension) {
  const text = String(content || "").replace(/\r\n/g, "\n");
  if (extension !== "canvas") return simpleContentHash(text.trimEnd());
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const key of ["nodes", "edges"]) {
        if (!Array.isArray(data[key])) continue;
        const orderKey = (item) => item && item.id != null ? String(item.id)
          : key === "edges" ? String(item && item.fromNode || "") + String(item && item.toNode || "") + String(item && item.label || "") : "";
        data[key].sort((a, b) => {
          const av = orderKey(a), bv = orderKey(b);
          if (av !== bv) return av < bv ? -1 : 1;
          // 缺少／重複 id 時仍使陣列重排穩定，其他陣列保留原順序。
          const as = stableSerialize(a), bs = stableSerialize(b);
          return as < bs ? -1 : as > bs ? 1 : 0;
        });
      }
    }
    return simpleContentHash(stableSerialize(data));
  } catch (error) {
    return simpleContentHash(text);
  }
}

function normalizeEffectiveRecords(value) {
  const result = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [path, entry] of Object.entries(value)) {
    if (!path || !entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.fp !== "string" || !entry.fp
      || ![entry.t, entry.m, entry.s].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0)) {
      return Object.create(null);
    }
    result[path] = { fp: entry.fp, t: entry.t, m: entry.m, s: entry.s };
  }
  pruneEffectiveRecords(result);
  return result;
}

function pruneEffectiveRecords(map, maxEntries = 5000) {
  const entries = Object.entries(map);
  if (entries.length <= maxEntries) return false;
  entries.sort((a, b) => b[1].t - a[1].t);
  for (const [path] of entries.slice(maxEntries)) delete map[path];
  return true;
}

function getEffectiveTime(file, owner) {
  const entry = owner.effectiveRecords && owner.effectiveRecords[file.path];
  const maxSize = typeof owner.getMaxHashFileSizeBytes === "function" ? owner.getMaxHashFileSizeBytes() : DEFAULT_SETTINGS.maxHashFileSizeBytes;
  return entry && getFileStatNumber(file, "size") <= maxSize ? entry.t : getFileStatNumber(file, "mtime");
}

function isMobilePlatform() {
  try {
    return !!(Platform && Platform.isMobile);
  } catch (error) {
    return false;
  }
}

function isMobileOptimized(settings) {
  return isMobilePlatform() && (!settings || settings.mobileOptimized !== false);
}

function getMobileLayout(settings) {
  const value = settings && settings.mobileLayout;
  return ["compact", "comfortable", "reading"].includes(value) ? value : "comfortable";
}

function getLayoutDensity(settings) {
  const density = settings && settings.listDensity;
  if (density === "compact" || density === "card") return density;
  if (isMobileOptimized(settings)) {
    const mobile = getMobileLayout(settings);
    if (mobile === "compact") return "compact";
    if (mobile === "reading") return "card";
  }
  return "standard";
}

function getEffectiveSnippetLines(settings) {
  const density = getLayoutDensity(settings);
  const densityLines = density === "compact" ? 1 : density === "card" ? 3 : 2;
  const override = Number(settings && settings.snippetLines);
  const desktopLines = Number.isFinite(override) && override > 0 ? Math.max(1, Math.min(Math.floor(override), 3)) : densityLines;
  if (!isMobileOptimized(settings)) return desktopLines;
  const mobileLines = Number(settings && settings.mobileSnippetLines);
  if (!Number.isFinite(mobileLines) || mobileLines <= 0) return desktopLines;
  return Math.max(1, Math.min(Math.floor(mobileLines), 3));
}

function getImageFile(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile && /^(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(file.extension)
    && getFileStatNumber(file, "size") <= 6 * 1024 * 1024 ? file : null;
}

function normalizeImageLink(value) {
  if (typeof value !== "string") return "";
  let link = value.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split("|")[0].trim();
  if (link.startsWith("<") && link.endsWith(">")) link = link.slice(1, -1);
  try { link = decodeURIComponent(link); } catch (error) { return ""; }
  // 僅允許 vault 連結；任何 scheme、網路路徑、Windows 絕對路徑皆略過。
  if (/^[a-z][a-z\d+.-]*:/i.test(link) || /^[\\/]{2}/.test(link) || link.includes("\\")) return "";
  return link.split("#")[0].split("?")[0].trim();
}

function getNoteImageLinks(content) {
  const body = removeYamlFrontmatter(content).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, "");
  const images = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(\s*(<[^>]+>|(?:[^\s()]|\([^()]*\))+)(?:\s+["'][^\n]*?["'])?\s*\)/g;
  return Array.from(body.matchAll(images), (match) => match[1] || match[2]);
}

function findNoteImagePath(app, file, content, imageLinks = getNoteImageLinks(content)) {
  const cache = app.metadataCache;
  if (!cache || typeof cache.getFirstLinkpathDest !== "function") return "";
  const metadata = typeof cache.getFileCache === "function" ? cache.getFileCache(file) || {} : {};
  const resolve = (value) => {
    const link = normalizeImageLink(value);
    if (!link) return "";
    try {
      const target = cache.getFirstLinkpathDest(link, file.path);
      return target instanceof TFile && getImageFile(app, target.path) ? target.path : "";
    } catch (error) { return ""; }
  };
  for (const key of ["cover", "banner", "image", "thumbnail", "feature"]) {
    const path = resolve(metadata.frontmatter && metadata.frontmatter[key]);
    if (path) return path;
  }
  // 候選連結與摘要共用一次讀取；cache hit 可在索引就緒後重解析，不需要再讀筆記。
  for (const link of imageLinks) {
    const path = resolve(link);
    if (path) return path;
  }
  // metadataCache 的 embeds 亦可提供 Obsidian 解析過的內文連結。
  for (const embed of metadata.embeds || []) {
    const path = resolve(embed.link);
    if (path) return path;
  }
  return "";
}

function shouldHideCanvasDetailsOnMobile(settings) {
  return isMobileOptimized(settings) && !!(settings && settings.mobileHideCanvasDetails);
}

function getSortDeviceHint(mode) {
  if (mode === "mtime") return "依檔案修改時間排序；跨裝置通常較接近，但 Dropbox 等同步工具可能更動時間。";
  if (mode === "opened") return "最近開啟時間只記錄在目前裝置；其他電腦或手機可能顯示不同順序。";
  if (mode === "localEdit") return "本機編輯時間不會同步到其他裝置；不同裝置的排序可能不同。";
  if (mode === "smart") return "智慧排序含本機開啟與編輯紀錄；不同裝置的順序可能不同。";
  return "有效編輯時間採本機內容紀錄；首次觀察與同步狀態不同時，裝置間排序可能不同。";
}

function computeSortInfo(file, settings, owner) {
  const activity = getFileActivity(owner, file.path);
  const mtime = Number(file.stat && file.stat.mtime) || 0;
  const opened = Number(activity.lastOpened) || 0;
  const localEdit = Number(activity.lastLocalEdit) || 0;
  const mode = settings.sortMode || "mtime";

  if (mode === "effective") {
    return { timestamp: getEffectiveTime(file, owner), priority: 0, reason: "有效編輯", opened, localEdit, fileMtime: mtime };
  }

  if (mode === "opened") {
    return { timestamp: opened || mtime, priority: opened ? 1 : 0, reason: opened ? "最近開啟" : "檔案修改", opened, localEdit, fileMtime: mtime };
  }

  if (mode === "localEdit") {
    return { timestamp: localEdit || mtime, priority: localEdit ? 1 : 0, reason: localEdit ? "本機編輯" : "檔案修改", opened, localEdit, fileMtime: mtime };
  }

  if (mode === "smart") {
    const activityCandidates = [
      { timestamp: localEdit, reason: "本機編輯" },
      { timestamp: opened, reason: "最近開啟" }
    ].filter((item) => item.timestamp > 0);
    activityCandidates.sort((a, b) => b.timestamp - a.timestamp);
    const winner = activityCandidates[0] || { timestamp: mtime, reason: "檔案修改" };
    return { timestamp: winner.timestamp, priority: activityCandidates.length > 0 ? 1 : 0, reason: winner.reason, opened, localEdit, fileMtime: mtime };
  }

  return { timestamp: mtime, priority: 0, reason: "檔案修改", opened, localEdit, fileMtime: mtime };
}

function pruneActivity(settings, existingPathSet, maxEntries = 2000) {
  const map = getActivityMap(settings);
  let changed = false;
  for (const path of Object.keys(map)) {
    if (!existingPathSet.has(path)) {
      delete map[path];
      changed = true;
    }
  }

  const entries = Object.entries(map);
  if (entries.length <= maxEntries) return changed;

  entries.sort((a, b) => {
    const av = Math.max(Number(a[1].lastOpened) || 0, Number(a[1].lastLocalEdit) || 0);
    const bv = Math.max(Number(b[1].lastOpened) || 0, Number(b[1].lastLocalEdit) || 0);
    return bv - av;
  });

  const keep = new Set(entries.slice(0, maxEntries).map(([path]) => path));
  for (const path of Object.keys(map)) {
    if (!keep.has(path)) {
      delete map[path];
      changed = true;
    }
  }
  return changed;
}

class RecentNotesFeedView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.searchQuery = "";
    this.typeFilter = plugin.settings.defaultTypeFilter || "all";
    this.filterOverrides = {};
    this.configuredTypeFilter = this.typeFilter;
    this.items = [];
    this.loading = false;
    this.longPressTriggered = false;
    this.searchExpanded = false;
    this.dateNavigatorCleanup = null;
    this.pendingDateJump = null;
    this.dateAnchors = new Map();
  }

  getViewType() {
    return VIEW_TYPE_RECENT_NOTES_FEED;
  }

  getDisplayText() {
    return "ReNotes";
  }

  getIcon() {
    return "renotes";
  }

  getContentRoot() {
    let root = null;

    // Obsidian versions and mobile/desktop layouts differ here.
    // Some builds expose ItemView.contentEl; some only expose containerEl.children[1].
    // v0.6.0 assumed contentEl existed and could crash with `reading empty`.
    if (this.contentEl instanceof HTMLElement) {
      root = this.contentEl;
    }

    if (!root && this.containerEl instanceof HTMLElement) {
      if (typeof this.containerEl.querySelector === "function") {
        root = this.containerEl.querySelector(".view-content");
      }
      if (!root && this.containerEl.children && this.containerEl.children.length > 1) {
        root = this.containerEl.children[1];
      }
      if (!root) root = this.containerEl;
    }

    if (!root) {
      root = document.createElement("div");
    }

    if (typeof root.empty !== "function") {
      root.empty = function () {
        while (this.firstChild) this.removeChild(this.firstChild);
      };
    }

    return root;
  }

  async onOpen() {
    const root = this.getContentRoot();
    root.empty();
    root.addClass("recent-notes-feed-root");
    this.rootEl = root;
    root.createDiv({ cls: "recent-notes-feed-loading", text: "載入最近修改..." });
    await this.refresh();
  }

  async refresh() {
    if (!this.rootEl) return;
    if (this.loading) {
      this.refreshPending = true;
      return this.refreshPromise;
    }
    this.loading = true;
    this.refreshPromise = (async () => {
      try {
        do {
          this.refreshPending = false;
          const items = await this.plugin.buildRecentNotes(this.getFilterSettings());
          if (!this.rootEl) return;
          if (this.refreshPending) continue;
          this.items = items;
          this.render();
        } while (this.refreshPending);
      } catch (error) {
        console.error("ReNotes: refresh failed", error);
        new Notice("ReNotes 載入失敗，請查看 Console");
        this.renderError(error);
      } finally {
        this.loading = false;
      }
    })();
    return this.refreshPromise;
  }

  async onClose() {
    if (this.dateNavigatorCleanup) this.dateNavigatorCleanup();
    this.dateNavigatorCleanup = null;
    this.pendingDateJump = null;
    this.dateAnchors = new Map();
    this.renderGeneration = (this.renderGeneration || 0) + 1;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = null;
    this.rootEl = null;
    this.listEl = null;
  }

  renderError(error) {
    const root = this.rootEl;
    if (!root) return;
    root.empty();
    root.createDiv({ cls: "recent-notes-feed-title", text: "近期" });
    root.createDiv({ cls: "recent-notes-feed-empty", text: "載入失敗。" });
    const pre = root.createEl("pre", { cls: "recent-notes-feed-debug" });
    pre.textContent = error && error.stack ? error.stack : String(error);
  }

  refreshActiveItemMarks() {
    if (!this.listEl) return;
    const currentPath = this.plugin.getCurrentOpenPath();
    this.listEl.querySelectorAll(".recent-note-item").forEach((row) => {
      row.toggleClass("is-active", !!currentPath && row.dataset.path === currentPath);
    });
  }

  observeWidth() {
    if (this.resizeObserver || !this.rootEl) return;
    this.updateWidth(this.rootEl.getBoundingClientRect ? this.rootEl.getBoundingClientRect().width : 280);
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.rootEl) return;
      const entry = entries.find((value) => value.target === this.rootEl);
      if (entry) this.updateWidth(entry.borderBoxSize && entry.borderBoxSize[0] ? entry.borderBoxSize[0].inlineSize : entry.contentRect.width);
    });
    this.resizeObserver.observe(this.rootEl);
  }

  updateWidth(width) {
    if (!this.rootEl) return;
    this.rootEl.dataset.width = getWidthClass(width, this.rootEl.dataset.width);
    if (this.filterButton) this.filterButton.setAttribute("aria-label", this.rootEl.dataset.width === "tiny" ? "搜尋與篩選" : "篩選");
  }

  applyDensityClass() {
    const root = this.rootEl;
    if (!root) return;
    root.addClass("recent-notes-feed-root");
    this.observeWidth();
    root.dataset.previewLines = String(getEffectiveSnippetLines(this.plugin.settings));
    root.toggleClass("recent-notes-preview-override", Number(this.plugin.settings.snippetLines) > 0
      || (isMobileOptimized(this.plugin.settings) && Number(this.plugin.settings.mobileSnippetLines) > 0));
    root.toggleClass("recent-notes-mobile-platform", isMobilePlatform());
    root.removeClass("recent-notes-density-compact");
    root.removeClass("recent-notes-density-standard");
    root.removeClass("recent-notes-density-card");
    root.removeClass("recent-notes-sticky-header");
    root.removeClass("recent-notes-nonsticky-header");
    root.removeClass("recent-notes-mobile-optimized");
    root.removeClass("recent-notes-desktop-optimized");
    root.removeClass("recent-notes-mobile-layout-compact");
    root.removeClass("recent-notes-mobile-layout-comfortable");
    root.removeClass("recent-notes-mobile-layout-reading");
    root.removeClass("recent-notes-mobile-compact-header");
    root.removeClass("recent-notes-mobile-regular-header");
    const density = getLayoutDensity(this.plugin.settings);
    root.addClass(`recent-notes-density-${density}`);
    root.addClass(this.plugin.settings.stickyHeader ? "recent-notes-sticky-header" : "recent-notes-nonsticky-header");
    if (isMobileOptimized(this.plugin.settings)) {
      root.addClass("recent-notes-mobile-optimized");
      root.addClass(`recent-notes-mobile-layout-${getMobileLayout(this.plugin.settings)}`);
      root.addClass(this.plugin.settings.mobileCompactHeader !== false ? "recent-notes-mobile-compact-header" : "recent-notes-mobile-regular-header");
    } else {
      root.addClass("recent-notes-desktop-optimized");
    }
  }

  render() {
    const root = this.rootEl;
    root.empty();
    const configuredTypeFilter = this.plugin.settings.defaultTypeFilter || "all";
    if (this.configuredTypeFilter !== configuredTypeFilter) {
      this.configuredTypeFilter = configuredTypeFilter;
      this.typeFilter = ["all", "markdown", "canvas"].includes(configuredTypeFilter) ? configuredTypeFilter : "all";
    }
    this.applyDensityClass();

    const top = root.createDiv({ cls: "recent-notes-feed-top" });
    const header = top.createDiv({ cls: "recent-notes-feed-header" });
    const titleWrap = header.createDiv({ cls: "recent-notes-feed-title-wrap" });
    titleWrap.createDiv({ cls: "recent-notes-feed-title", text: "近期" });
    this.countEl = titleWrap.createDiv({ cls: "recent-notes-feed-count", text: "" });
    this.debugSummaryEl = titleWrap.createDiv({ cls: "recent-notes-feed-debug-summary", text: "" });

    const tools = top.createDiv({ cls: "recent-notes-feed-tools" });
    root.toggleClass("recent-notes-search-expanded", this.searchExpanded);
    const panel = top.createDiv({ cls: "recent-notes-filter-panel" });
    panel.id = `rnf-filters-${++RecentNotesFeedView.panelId}`;
    panel.hidden = true;
    const headerActions = panel.createDiv({ cls: "recent-notes-feed-actions" });
    const refreshButton = headerActions.createEl("button", {
      cls: "recent-notes-feed-icon-button",
      attr: { "aria-label": "重新整理" }
    });
    refreshButton.textContent = "↻";
    refreshButton.addEventListener("click", () => this.refresh());

    if (this.plugin.settings.debugMode) {
      const debugButton = headerActions.createEl("button", {
        cls: "recent-notes-feed-icon-button",
        attr: { "aria-label": "複製 Debug 資訊" }
      });
      debugButton.textContent = "⧉";
      debugButton.addEventListener("click", () => this.plugin.copyDebugInfo());
    }

    if (this.plugin.settings.showSearch) {
      const searchButton = tools.createEl("button", {
        cls: "recent-notes-search-button", attr: { "aria-label": "搜尋", "aria-expanded": String(this.searchExpanded) }
      });
      setIcon(searchButton, "search");
      searchButton.addEventListener("click", () => {
        this.searchExpanded = !this.searchExpanded;
        root.toggleClass("recent-notes-search-expanded", this.searchExpanded);
        searchButton.setAttribute("aria-expanded", String(this.searchExpanded));
        if (this.searchExpanded) search.focus();
      });
      const searchWrap = tools.createDiv({ cls: "recent-notes-feed-search-wrap" });
      const searchIcon = searchWrap.createSpan({ cls: "recent-notes-feed-search-icon", attr: { "aria-hidden": "true" } });
      setIcon(searchIcon, "search");
      const search = searchWrap.createEl("input", {
        cls: "recent-notes-feed-search",
        type: "search",
        placeholder: "搜尋",
        attr: { "aria-label": "搜尋" },
        value: this.searchQuery
      });
      const clearSearch = searchWrap.createEl("button", {
        cls: "recent-notes-feed-clear-search",
        attr: { "aria-label": "清除搜尋" }
      });
      clearSearch.textContent = "×";
      clearSearch.toggleClass("is-visible", !!this.searchQuery);
      search.addEventListener("input", () => {
        this.searchQuery = search.value.trim().toLowerCase();
        clearSearch.toggleClass("is-visible", !!this.searchQuery);
        this.renderList();
      });
      search.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.searchExpanded = false;
          root.removeClass("recent-notes-search-expanded");
          searchButton.setAttribute("aria-expanded", "false");
          searchButton.focus();
        }
        if (event.key === "Enter" && isMobileOptimized(this.plugin.settings)) {
          search.blur();
        }
      });
      clearSearch.addEventListener("click", () => {
        this.searchQuery = "";
        search.value = "";
        clearSearch.toggleClass("is-visible", false);
        search.focus();
        this.renderList();
      });
    }

    this.filterButton = tools.createEl("button", {
      cls: "recent-notes-filter-button",
      attr: { "aria-label": "篩選", "aria-expanded": "false", "aria-controls": panel.id }
    });
    setIcon(this.filterButton, "filter");
    this.filterButton.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (root.dataset.width === "tiny") {
        this.searchExpanded = !panel.hidden;
        root.toggleClass("recent-notes-search-expanded", this.searchExpanded);
      }
      this.filterButton.setAttribute("aria-expanded", String(!panel.hidden));
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.hidden = true;
        if (root.dataset.width === "tiny") {
          this.searchExpanded = false;
          root.removeClass("recent-notes-search-expanded");
        }
        this.filterButton.setAttribute("aria-expanded", "false");
        this.filterButton.focus();
      }
    });
    this.updateWidth(Number.NaN);
    this.renderFilterPanel(panel);

    this.listEl = root.createDiv({ cls: "recent-notes-feed-list" });
    this.renderList(root);
  }

  renderTypeFilter(container) {
    const options = [
      { value: "all", label: "全部" },
      { value: "markdown", label: "筆記" },
      { value: "canvas", label: "Canvas" }
    ];

    for (const option of options) {
      const button = container.createEl("button", {
        cls: "recent-notes-filter-chip",
        attr: { "data-filter": option.value, "aria-label": `只顯示${option.label}` }
      });
      button.textContent = option.label;
      if (this.typeFilter === option.value) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.typeFilter = option.value;
        container.querySelectorAll(".recent-notes-filter-chip").forEach((chip) => chip.removeClass("is-active"));
        button.addClass("is-active");
        this.renderList();
      });
    }
  }

  getFilterSettings() {
    return Object.assign({}, this.plugin.settings, this.filterOverrides);
  }

  hasActiveFilters() {
    const settings = this.getFilterSettings();
    return !!this.searchQuery || this.typeFilter !== "all"
      || ["includedFolders", "excludedFolders", "excludedTags"].some((key) => normalizeList(settings[key]).length > 0)
      || settings.sortMode !== DEFAULT_SETTINGS.sortMode;
  }

  async clearFilters() {
    this.searchQuery = "";
    this.typeFilter = "all";
    this.filterOverrides = { includedFolders: "", excludedFolders: "", excludedTags: "", sortMode: DEFAULT_SETTINGS.sortMode };
    await this.refresh();
  }

  renderFilterPanel(panel) {
    if (this.plugin.settings.showTypeFilter) {
      panel.createDiv({ cls: "recent-notes-filter-label", text: "類型" });
      this.renderTypeFilter(panel.createDiv({ cls: "recent-notes-filter-bar" }));
    }
    const settings = this.getFilterSettings();
    for (const [key, label] of [["includedFolders", "資料夾"], ["excludedFolders", "排除資料夾"], ["excludedTags", "排除標籤"]]) {
      const labelEl = panel.createEl("label", { cls: "recent-notes-filter-field" });
      labelEl.createSpan({ text: label });
      const input = labelEl.createEl("input", { type: "text", value: settings[key] || "", placeholder: "多個項目以逗號分隔" });
      input.value = normalizeList(settings[key]).join(", ");
      input.addEventListener("change", () => {
        this.filterOverrides[key] = input.value;
        this.refresh();
      });
    }
    const labelEl = panel.createEl("label", { cls: "recent-notes-filter-field" });
    labelEl.createSpan({ text: "排序方式" });
    const sort = labelEl.createEl("select");
    for (const [value, label] of [["effective", "有效編輯時間（忽略無內容變更的重寫）"], ["opened", "最近開啟"], ["localEdit", "本機編輯"], ["smart", "智慧"], ["mtime", "修改時間"]]) {
      sort.createEl("option", { value, text: label });
    }
    sort.value = settings.sortMode;
    const sortSource = panel.createDiv({ cls: "recent-notes-sort-source" });
    const updateSortSource = () => {
      sortSource.textContent = getSortDeviceHint(sort.value);
    };
    updateSortSource();
    sort.addEventListener("change", () => {
      this.filterOverrides.sortMode = sort.value;
      updateSortSource();
      this.refresh();
    });
    const clear = panel.createEl("button", { text: "清除篩選" });
    clear.addEventListener("click", () => this.clearFilters());
  }

  getFilteredItems() {
    let visibleItems = this.items;

    if (this.typeFilter && this.typeFilter !== "all") {
      visibleItems = visibleItems.filter((item) => item.type === this.typeFilter);
    }

    if (this.searchQuery) {
      visibleItems = visibleItems.filter((item) => {
        const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
        const searchText = [
          item.title,
          item.snippet,
          item.path,
          item.folder || "",
          tags,
          item.canvasSearchText || ""
        ].join(" ").toLowerCase();
        return searchText.includes(this.searchQuery);
      });
    }

    return visibleItems;
  }

  updateCount(visibleCount) {
    if (this.countEl) {
      if (!this.plugin.settings.showResultCount) {
        this.countEl.textContent = "";
      } else {
        const total = this.items.length;
        const typeText = this.typeFilter === "canvas" ? "Canvas" : this.typeFilter === "markdown" ? "筆記" : "項目";
        this.countEl.textContent = this.searchQuery || this.typeFilter !== "all"
          ? `${visibleCount} / ${total} 個${typeText}`
          : `${total} 個項目`;
      }
    }

    if (this.debugSummaryEl) {
      const stats = this.plugin.lastBuildStats || {};
      if (this.plugin.settings.debugMode && this.plugin.settings.showPerformanceStats !== false && stats) {
        this.debugSummaryEl.textContent = `讀取 ${stats.readCount || 0}｜快取 ${stats.cacheHits || 0}/${stats.cacheLookups || 0}｜解析 ${stats.parseCount || 0}｜${stats.buildDurationMs || 0}ms`;
      } else {
        this.debugSummaryEl.textContent = "";
      }
    }
  }


  scrollToRecentDateAnchor(anchor, generation) {
    if (!anchor || !this.rootEl || generation !== this.renderGeneration) return false;
    const root = this.rootEl;
    const top = root.querySelector(".recent-notes-feed-top");
    if (typeof root.scrollTo === "function" && typeof anchor.getBoundingClientRect === "function") {
      const rootRect = root.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const headerHeight = this.plugin.settings.stickyHeader && top
        ? Math.max(0, Number(top.getBoundingClientRect().height) || 0) : 0;
      if (Number.isFinite(anchorRect.top) && Number.isFinite(rootRect.top)) {
        const next = Math.max(0, (root.scrollTop || 0) + anchorRect.top - rootRect.top - headerHeight - 8);
        root.scrollTo({ top: next, behavior: "smooth" });
        return true;
      }
    }
    if (typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }
    return false;
  }

  jumpToRecentDate(key, generation) {
    if (generation !== this.renderGeneration) return;
    const anchor = this.dateAnchors && this.dateAnchors.get(key);
    if (anchor) {
      this.pendingDateJump = null;
      this.scrollToRecentDateAnchor(anchor, generation);
    } else {
      // Progressive rendering may not yet have appended this date.
      this.pendingDateJump = { key, generation };
    }
  }

  renderRecentDateNavigator(container, dateIndex, generation) {
    if (!dateIndex.length) return;
    const holder = container.createDiv({ cls: "rnf-date-nav" });
    const toggle = holder.createEl("button", {
      cls: "rnf-date-nav-toggle",
      attr: { type: "button", title: "跳轉日期", "aria-label": "跳轉日期", "aria-haspopup": "dialog", "aria-expanded": "false" }
    });
    toggle.textContent = "⋯";
    const popover = holder.createDiv({ cls: "rnf-date-nav-popover", attr: { role: "dialog", "aria-label": "跳轉日期" } });
    popover.hidden = true;
    popover.createDiv({ cls: "rnf-date-nav-title", text: "跳轉日期" });

    const close = (restoreFocus = false) => {
      popover.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus && typeof toggle.focus === "function") toggle.focus();
    };
    const addDate = (parent, entry) => {
      const button = parent.createEl("button", { cls: "rnf-date-nav-option", attr: {
        type: "button", "data-date-key": entry.key,
        "aria-label": entry.label + "，" + entry.count + " 筆，跳轉"
      } });
      button.createSpan({ cls: "rnf-date-nav-option-label", text: entry.label });
      button.createSpan({ cls: "rnf-date-nav-option-count", text: entry.count + " 筆" });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        this.jumpToRecentDate(entry.key, generation);
      });
    };

    for (const entry of dateIndex.slice(0, 7)) addDate(popover, entry);
    if (dateIndex.length > 7) {
      const details = popover.createEl("details", { cls: "rnf-date-nav-more" });
      details.createEl("summary", { text: "更多日期（依月份）" });
      const older = dateIndex.slice(7);
      const months = new Map();
      for (const entry of older) {
        if (!months.has(entry.month)) months.set(entry.month, []);
        months.get(entry.month).push(entry);
      }
      const currentYear = new Date().getFullYear();
      for (const [month, entries] of months) {
        const section = details.createDiv({ cls: "rnf-date-nav-month" });
        const [year, number] = month.split("-").map(Number);
        section.createDiv({ cls: "rnf-date-nav-month-label", text:
          (year === currentYear ? "" : year + "年 ") + number + "月"
        });
        for (const entry of entries) addDate(section, entry);
      }
    }

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = popover.hidden;
      popover.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    holder.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    });
    const onOutside = (event) => {
      if (popover.hidden) return;
      let target = event.target;
      while (target) {
        if (target === holder) return;
        target = target.parentElement;
      }
      close();
    };
    document.addEventListener("pointerdown", onOutside, true);
    this.dateNavigatorCleanup = () => document.removeEventListener("pointerdown", onOutside, true);
  }

  renderList() {
    if (!this.listEl) return;
    this.renderGeneration = (this.renderGeneration || 0) + 1;
    const generation = this.renderGeneration;
    if (this.dateNavigatorCleanup) this.dateNavigatorCleanup();
    this.dateNavigatorCleanup = null;
    this.pendingDateJump = null;
    this.dateAnchors = new Map();
    this.listEl.empty();

    let visibleItems = this.getFilteredItems();
    this.updateCount(visibleItems.length);
    if (this.filterButton) this.filterButton.toggleClass("has-filters", this.hasActiveFilters());

    if (visibleItems.length === 0) {
      const empty = this.listEl.createDiv({ cls: "recent-notes-feed-empty" });
      empty.createDiv({ text: "沒有符合的項目" });
      empty.createDiv({ cls: "recent-notes-feed-empty-hint", text: this.hasActiveFilters() ? "試試其他條件，或清除篩選。" : "開啟或建立筆記後，項目會顯示在這裡。" });
      if (this.hasActiveFilters()) {
        empty.createEl("button", { text: "清除篩選" }).addEventListener("click", () => this.clearFilters());
      }
      const stats = this.plugin.lastBuildStats;
      if (stats && this.plugin.settings.debugMode) {
        const hint = this.listEl.createDiv({ cls: "recent-notes-feed-debug" });
        hint.textContent = `偵錯：Markdown ${stats.totalMarkdown} 篇，Canvas ${stats.totalCanvas || 0} 個，通過資料夾篩選 ${stats.afterFolderFilter} 個，實際讀取 ${stats.readCount} 個，快取命中 ${stats.cacheHits || 0} 個，快取寫入 ${stats.cacheWrites || 0} 個，排除標籤 ${stats.skippedByTags} 篇，耗時 ${stats.buildDurationMs || 0}ms。`;
      }
      return;
    }

    const currentPath = this.plugin.getCurrentOpenPath();
    const pinnedPaths = new Set(this.plugin.settings.pinnedPaths);
    const pinned = visibleItems.filter((item) => pinnedPaths.has(item.path));
    const regular = visibleItems.filter((item) => !pinnedPaths.has(item.path));
    // Date counts mirror the chronological (non-pinned) section, not the pinned collection.
    const dateIndex = getRecentDateIndex(regular.length ? regular : pinned);
    visibleItems = pinned.concat(regular);
    const groups = new Map();
    let pinnedItems = null;
    let dateNavigatorRendered = false;
    const observedDays = new Set();
    if (pinned.length) {
      const section = this.listEl.createDiv({ cls: "recent-notes-pinned-section" });
      const header = section.createDiv({ cls: "recent-notes-pinned-header" });
      setIcon(header.createSpan({ cls: "recent-notes-pin-icon", attr: { "aria-hidden": "true" } }), "pin");
      header.createSpan({ cls: "recent-notes-pinned-label", text: "釘選" });
      header.createSpan({ cls: "recent-notes-pinned-line", attr: { "aria-hidden": "true" } });
      header.createSpan({ cls: "recent-notes-pinned-count", text: String(pinned.length) });
      pinnedItems = section.createDiv({ cls: "recent-notes-group-items recent-notes-pinned-items" });
    }

    const appendItem = (item) => {
      if (!this.listEl || generation !== this.renderGeneration) return;
      const isPinned = pinnedPaths.has(item.path);
      const dayKey = getRecentLocalDayKey(item.mtime);
      let container = pinnedItems;
      let anchor = null;
      if (!isPinned) {
        const group = this.plugin.settings.groupByDate ? getDateGroup(item.mtime) : { key: "flat" };
        if (!groups.has(group.key)) {
          const section = this.listEl.createDiv({ cls: "recent-notes-date-group" });
          section.dataset.group = group.key;
          section.toggleClass("is-today", !!group.today);
          section.toggleClass("is-yesterday", group.key === "yesterday");
          const heading = section.createDiv({ cls: "rnf-date-header" });
          if (group.label) {
            section.setAttribute("aria-label", group.label);
            const pill = heading.createEl("h3", { cls: "recent-notes-date-pill" });
            pill.createSpan({ text: group.label });
            if (group.showDay) pill.createSpan({ cls: "recent-notes-date-pill-day", text: " " + group.number });
          } else section.addClass("is-flat");
          if (!dateNavigatorRendered) {
            this.renderRecentDateNavigator(heading, dateIndex, generation);
            dateNavigatorRendered = true;
          }
          groups.set(group.key, { items: section.createDiv({ cls: "recent-notes-group-items" }), heading });
        }
        const data = groups.get(group.key);
        container = data.items;
        if (!observedDays.has(dayKey)) {
          observedDays.add(dayKey);
          if (group.key === "today" || group.key === "yesterday") anchor = data.heading;
          else if (group.label) {
            anchor = container.createDiv({ cls: "rnf-date-subheading", text: formatRecentDateLabel(item.mtime) });
            anchor.dataset.day = dayKey;
          }
        }
      } else if (regular.length === 0 && !dateNavigatorRendered) {
        // A fully pinned feed still offers date navigation.
        const heading = this.listEl.createDiv({ cls: "rnf-date-header rnf-date-nav-pinned" });
        this.renderRecentDateNavigator(heading, dateIndex, generation);
        dateNavigatorRendered = true;
      }

      const card = this.renderItemCard(item, currentPath, container, isPinned);
      card.dataset.day = dayKey;
      if (!this.dateAnchors.has(dayKey) && (!isPinned || regular.length === 0)) {
        this.dateAnchors.set(dayKey, anchor || card);
        if (this.pendingDateJump && this.pendingDateJump.generation === generation
          && this.pendingDateJump.key === dayKey) this.jumpToRecentDate(dayKey, generation);
      }
    };

    const batchSize = Math.max(5, Math.min(Number(this.plugin.settings.renderBatchSize) || 30, 100));
    const useProgressiveRender = this.plugin.settings.progressiveRender !== false && visibleItems.length > batchSize;

    if (!useProgressiveRender) {
      for (const item of visibleItems) appendItem(item);
      return;
    }

    let index = 0;
    const renderBatch = () => {
      if (!this.listEl || generation !== this.renderGeneration) return;
      const end = Math.min(index + batchSize, visibleItems.length);
      for (; index < end; index += 1) {
        appendItem(visibleItems[index]);
      }
      if (index < visibleItems.length) {
        scheduleUiTask(renderBatch);
      }
    };

    renderBatch();
  }

  addCanvasDragHandle(card, item) {
    if (isMobilePlatform() || this.plugin.settings.enableCanvasDrag === false || item.type !== "markdown") return;
    const handle = card.createSpan({
      cls: "rnf-canvas-drag-handle",
      attr: {
        draggable: "true",
        title: "拖曳筆記到 Canvas",
        "aria-label": "拖曳 " + item.title + " 到 Canvas",
        "aria-hidden": "true"
      }
    });
    card.addClass("has-canvas-drag-handle");
    setIcon(handle, "grip-vertical");
    // Clicking the drag grip must not open the note underneath it.
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("dragstart", (event) => {
      const file = this.plugin.app.vault.getAbstractFileByPath(item.path);
      const dragManager = this.plugin.app.dragManager;
      if (!(file instanceof TFile) || file.extension !== "md"
        || typeof dragManager?.dragFile !== "function"
        || typeof dragManager?.onDragStart !== "function") {
        event.preventDefault();
        new Notice("無法拖曳此筆記，請從 Obsidian 檔案總管拖入 Canvas。");
        return;
      }
      try {
        const dragData = dragManager.dragFile(event, file);
        dragManager.onDragStart(event, dragData);
        card.addClass("rnf-is-dragging");
      } catch (error) {
        event.preventDefault();
        console.warn("ReNotes: native Canvas drag unavailable", error);
        new Notice("此 Obsidian 版本無法使用 ReNotes 拖曳，請改由檔案總管拖入。");
      }
    });
    handle.addEventListener("dragend", () => card.removeClass("rnf-is-dragging"));
  }

  renderItemCard(item, currentPath, container = this.listEl, pinned = this.plugin.isPinned(item.path)) {
    const card = container.createDiv({ cls: `recent-note-item recent-note-type-${item.type}` });
    card.addClass("rnf-a1-card");
    card.toggleClass("recent-notes-pinned-card", pinned);
    card.tabIndex = 0;
    card.dataset.path = item.path;
    this.addCanvasDragHandle(card, item);
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `開啟 ${item.title}`);
    if (currentPath && item.path === currentPath) {
      card.addClass("is-active");
    }

    const body = card.createDiv({ cls: "recent-note-body" });
    const heading = body.createDiv({ cls: "recent-note-heading" });
    if (pinned) {
      setIcon(heading.createSpan({ cls: "recent-note-pin", attr: { "aria-hidden": "true" } }), "pin");
    }
    const title = heading.createDiv({ cls: "recent-note-title", text: item.title });
    title.title = item.path;
    if (this.plugin.settings.showSnippet && item.hasSnippetContent !== false && String(item.snippet || "").trim()) {
      body.createDiv({ cls: "recent-note-snippet", text: item.snippet });
    }

    const bottom = card.createDiv({ cls: "rnf-card-bottom" });
    const bottomLeft = bottom.createDiv({ cls: "rnf-card-bottom-left" });
    const footer = bottom.createDiv({ cls: "recent-note-footer" });
    // Distinguish file types in the existing time row without changing card layout.
    if (item.type === "markdown" || item.type === "canvas") {
      const isCanvas = item.type === "canvas";
      const typeLabel = isCanvas ? "Canvas 白板" : "Markdown 筆記";
      const iconEl = footer.createSpan({ cls: "rnf-filetype-icon", attr: { role: "img", "aria-label": typeLabel, title: typeLabel } });
      // In this Obsidian release, Lucide grid-2x2 is named layout-grid; both render the same 2x2 rectangles.
      setIcon(iconEl, isCanvas ? "layout-grid" : "file-text");
    }
    const time = footer.createSpan({ cls: "recent-note-time", text: formatNoteTime(item.mtime) });
    time.title = formatTime(item.mtime, this.plugin.settings.dateFormat);
    const folder = item.folder && item.folder !== "/" ? item.folder.split("/").pop()
      : (this.plugin.app.vault.getName ? this.plugin.app.vault.getName() : "筆記");
    const extras = bottomLeft.createSpan({ cls: "rnf-card-meta-extras" });
    if (this.plugin.settings.showFolder) {
      extras.createSpan({ text: " · " });
      const label = extras.createSpan({ cls: "recent-note-folder", text: folder });
      label.title = item.folder || folder;
    }
    if (this.plugin.settings.showTags && Array.isArray(item.tags) && item.tags.length) {
      extras.createSpan({ cls: "recent-note-tags", text: " · " + item.tags.slice(0, 2).map((tag) => tag.startsWith("#") ? tag : "#" + tag).join(" · ") });
    }
    if (!extras.textContent) extras.remove();
    if (this.plugin.settings.showSortReason && item.sortReason) {
      body.createDiv({ cls: "recent-note-sort-reason recent-note-extra", text: item.sortReason });
    }
    if (item.type === "canvas" && item.canvas && !shouldHideCanvasDetailsOnMobile(this.plugin.settings)) {
      this.renderCanvasDetails(body, item, bottomLeft);
    }
    if (this.plugin.settings.showCanvasThumbnail !== false && item.type === "canvas" && item.canvas
      && Array.isArray(item.canvas.thumbnailNodes) && item.canvas.thumbnailNodes.length) {
      card.addClass("has-thumbnail");
      const thumbnail = card.createDiv({ cls: "recent-note-thumbnail", attr: { "aria-hidden": "true" } });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 68 68");
      thumbnail.appendChild(svg);
      for (const node of item.canvas.thumbnailNodes || []) {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        for (const key of ["x", "y", "width", "height"]) rect.setAttribute(key, String(node[key]));
        rect.setAttribute("rx", "1");
        rect.setAttribute("class", "recent-note-thumbnail-" + node.type);
        svg.appendChild(rect);
      }
    } else if (this.plugin.settings.showImageThumbnail !== false && item.type === "markdown" && item.imagePath
      && !this.plugin.failedImageThumbnails.has(item.imagePath)) {
      const file = getImageFile(this.plugin.app, item.imagePath);
      if (file && typeof this.plugin.app.vault.getResourcePath === "function") {
        card.addClass("has-thumbnail");
        const thumbnail = card.createDiv({ cls: "recent-note-thumbnail recent-note-image-thumbnail", attr: { "aria-hidden": "true" } });
        const img = thumbnail.createEl("img", { attr: { alt: "", loading: "lazy", decoding: "async" } });
        const discard = () => {
          this.plugin.failedImageThumbnails.add(item.imagePath);
          thumbnail.remove();
          card.removeClass("has-thumbnail");
        };
        img.addEventListener("error", discard, { once: true });
        try { img.setAttribute("src", this.plugin.app.vault.getResourcePath(file)); } catch (error) { discard(); }
      }
    }
    if (isMobilePlatform() && this.plugin.settings.mobileShowMenuButton !== false) {
      card.addClass("has-menu");
      const menuButton = card.createEl("button", {
        cls: "recent-note-menu-button",
        attr: { "aria-label": "開啟 " + item.title + " 的選單" }
      });
      menuButton.textContent = "⋯";
      menuButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.plugin.showFileMenu(item.path, event);
      });
    }

    card.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      if (this.longPressTriggered) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.openItem(item, event, false);
    });

    let middleClickOpened = false;
    const blockMiddleAutoscroll = (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const openFromMiddleClick = (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      if (middleClickOpened) return;
      middleClickOpened = true;
      window.setTimeout(() => {
        middleClickOpened = false;
      }, 350);
      this.openItem(item, event, true);
    };

    card.addEventListener("pointerdown", blockMiddleAutoscroll, { capture: true });
    card.addEventListener("mousedown", blockMiddleAutoscroll, { capture: true });
    card.addEventListener("pointerup", openFromMiddleClick, { capture: true });
    card.addEventListener("mouseup", openFromMiddleClick, { capture: true });
    card.addEventListener("auxclick", openFromMiddleClick, { capture: true });
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.openItem(item, event, false);
      }
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.plugin.showFileMenu(item.path, event);
    });
    this.setupMobileLongPressMenu(card, item);
    return card;
  }

  setupMobileLongPressMenu(card, item) {
    if (!isMobileOptimized(this.plugin.settings)) return;
    if (this.plugin.settings.mobileLongPressMenu === false) return;

    let timer = null;
    let startX = 0;
    let startY = 0;
    let latestX = 0;
    let latestY = 0;
    const cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };

    card.addEventListener("touchstart", (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      latestX = startX;
      latestY = startY;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        this.longPressTriggered = true;
        if (navigator && navigator.vibrate) {
          try { navigator.vibrate(8); } catch (error) {}
        }
        this.plugin.showFileMenu(item.path, { x: latestX, y: latestY });
        window.setTimeout(() => {
          this.longPressTriggered = false;
        }, 450);
      }, 560);
    }, { passive: true });

    card.addEventListener("touchmove", (event) => {
      if (!event.touches || event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      latestX = touch.clientX;
      latestY = touch.clientY;
      if (Math.abs(latestX - startX) > 10 || Math.abs(latestY - startY) > 10) {
        cancel();
      }
    }, { passive: true });

    card.addEventListener("touchend", cancel, { passive: true });
    card.addEventListener("touchcancel", cancel, { passive: true });
  }

  renderCanvasDetails(card, item, linkedContainer = card) {
    const canvas = item.canvas || {};

    if (this.plugin.settings.showCanvasStats) {
      card.createDiv({ cls: "recent-note-canvas-stats recent-note-extra", text: canvas.statsText || "Canvas 白板" });
    }

    const linkedFiles = filterCanvasDocumentLinks(canvas.linkedFiles);
    if (this.plugin.settings.showCanvasLinkedFiles !== false && linkedFiles.length > 0) {
      const linksEl = linkedContainer.createDiv({ cls: "recent-note-canvas-links" });
      const limit = getCanvasPreviewLimit(this.plugin.settings);
      for (const link of linkedFiles.slice(0, limit)) {
        const button = linksEl.createEl("button", {
          cls: "recent-note-canvas-link",
          attr: { title: link.path || link.title }
        });
        const fullTitle = link.title || basenameFromPath(link.path);
        button.textContent = truncateRecentCanvasLink(fullTitle);
        button.setAttribute("title", fullTitle);
        button.setAttribute("aria-label", "開啟 " + fullTitle);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.plugin.openCanvasLinkedFile(link.path, item.path, event.ctrlKey || event.metaKey);
        });
        button.addEventListener("auxclick", (event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          this.plugin.openCanvasLinkedFile(link.path, item.path, true);
        });
      }
      if (linkedFiles.length > limit) {
        linksEl.createSpan({ cls: "recent-note-canvas-more", text: `+${linkedFiles.length - limit}` });
      }
    }
  }

  async openItem(item, event, forceNewTab) {
    const openInNewTab = !!forceNewTab || event.ctrlKey || event.metaKey;
    await this.plugin.openFile(item.path, openInNewTab);
  }
}

RecentNotesFeedView.panelId = 0;

class RecentNotesFeedSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "ReNotes 設定" });
    containerEl.createEl("p", { text: "活動紀錄只存本裝置，手機與電腦各自獨立；釘選會隨 vault 同步。" });
    containerEl.createEl("h3", { text: "版面" });
    new Setting(containerEl)
      .setName("顯示摘要")
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.showSnippet)
        .onChange(async (value) => {
          this.plugin.settings.showSnippet = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    for (const [key, name, desc] of [
      ["showCanvasLinkedFiles", "顯示連結筆記晶片", "在 Canvas 卡片底部以 A1 極細圓框顯示連結筆記，每個名稱最多五字；點擊可開啟。"],
      ["showCanvasStats", "顯示 Canvas 詳細統計", "在寬版底部列下方顯示灰色統計文字，預設關閉。"],
      ["groupByDate", "依日期分組", "所有寬度均使用日期膠囊；更早項目依月份分組，跨年保留年份。"],
      ["showImageThumbnail", "顯示圖片縮圖", "右側顯示筆記第一張 vault 內圖片，預設開啟；忽略外部網址與超過 6 MB 的圖片。窄版隱藏。"],
      ["showCanvasThumbnail", "顯示 Canvas 縮圖", "右側顯示快取的 Canvas 節點縮圖，預設開啟；窄版隱藏。"],
      ["showFolder", "顯示資料夾", "在卡片下方左側顯示資料夾名稱，保留右側的時間對齊；預設關閉。"],
      ["showTags", "顯示標籤", "在卡片下方左側附上最多兩個標籤，預設關閉。"]
    ]) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) => toggle
          .setValue(!!this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettingsAndRefresh();
          }));
    }

    new Setting(containerEl)
      .setName("預覽行數（進階）")
      .setDesc("預設跟隨版面密度（1／2／3 行）；明確選擇後覆蓋密度。窄版最多 2 行，tiny 隱藏預覽。")
      .addDropdown((dropdown) => dropdown
        .addOption("auto", "跟隨密度")
        .addOption("1", "1 行")
        .addOption("2", "2 行")
        .addOption("3", "3 行")
        .setValue(this.plugin.settings.snippetLines == null ? "auto" : String(this.plugin.settings.snippetLines))
        .onChange(async (value) => {
          this.plugin.settings.snippetLines = value === "auto" ? null : Number.parseInt(value, 10);
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("版面密度")
      .setDesc("緊湊／標準／寬鬆控制卡片內距、標題、預覽行數與縮圖尺寸；寬度改變時仍有效。")
      .addDropdown((dropdown) => dropdown
        .addOption("compact", "緊湊")
        .addOption("standard", "標準")
        .addOption("card", "寬鬆")
        .setValue(this.plugin.settings.listDensity || "standard")
        .onChange(async (value) => {
          this.plugin.settings.listDensity = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    containerEl.createEl("h3", { text: "一般設定" });
    new Setting(containerEl)
      .setName("顯示最近幾篇")
      .setDesc("建議 20–100。數字越大，讀取摘要越多。")
      .addText((text) => text
        .setPlaceholder("50")
        .setValue(String(this.plugin.settings.maxNotes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.maxNotes = Math.max(1, Math.min(parsed, 300));
            await this.plugin.saveSettingsAndRefresh();
          }
        }));

    containerEl.createEl("h3", { text: "手機版優化" });

    new Setting(containerEl)
      .setName("啟用手機版優化")
      .setDesc("手機版會加大觸控區、調整搜尋與篩選列、支援長按開啟選單。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mobileOptimized !== false)
        .onChange(async (value) => {
          this.plugin.settings.mobileOptimized = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("手機列表樣式")
      .setDesc("保留手機偏好：標準版面密度時使用此樣式；明確選擇緊湊或寬鬆版面密度時優先使用版面密度。")
      .addDropdown((dropdown) => dropdown
        .addOption("compact", "緊湊")
        .addOption("comfortable", "舒適")
        .addOption("reading", "閱讀")
        .setValue(this.plugin.settings.mobileLayout || "comfortable")
        .onChange(async (value) => {
          this.plugin.settings.mobileLayout = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("手機預覽行數（進階）")
      .setDesc("預設沿用桌機的密度或預覽覆蓋，最多 3 行；窄版最多 2 行，tiny 隱藏。")
      .addDropdown((dropdown) => dropdown
        .addOption("0", "沿用桌機設定")
        .addOption("1", "1 行")
        .addOption("2", "2 行")
        .addOption("3", "3 行")
        .setValue(String(this.plugin.settings.mobileSnippetLines || 0))
        .onChange(async (value) => {
          this.plugin.settings.mobileSnippetLines = value === "0" ? null : Number.parseInt(value, 10);
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("手機顯示選單按鈕")
      .setDesc("在每筆項目右側顯示 ⋯，方便開新分頁、重新命名、刪除或在資料夾中顯示。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mobileShowMenuButton !== false)
        .onChange(async (value) => {
          this.plugin.settings.mobileShowMenuButton = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("手機長按開啟右鍵選單")
      .setDesc("在手機上長按筆記項目約半秒，會開啟和右鍵相同的選單。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mobileLongPressMenu !== false)
        .onChange(async (value) => {
          this.plugin.settings.mobileLongPressMenu = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("手機壓縮頂部工具列")
      .setDesc("減少標題、搜尋與篩選列佔用高度，避免列表被鍵盤與工具列擠壓。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mobileCompactHeader !== false)
        .onChange(async (value) => {
          this.plugin.settings.mobileCompactHeader = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("手機隱藏 Canvas 詳細資訊")
      .setDesc("只保留 Canvas 標題與摘要，不顯示統計晶片與連結筆記晶片；適合小螢幕。")
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.mobileHideCanvasDetails)
        .onChange(async (value) => {
          this.plugin.settings.mobileHideCanvasDetails = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("拖曳筆記到 Canvas（桌面版）")
      .setDesc("在 Markdown 卡片右上方提供拖曳把手，放進 Canvas 時使用 Obsidian 原生檔案引用；不複製筆記或修改筆記內容。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableCanvasDrag !== false)
        .onChange(async (value) => {
          this.plugin.settings.enableCanvasDrag = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("排序模式")
      .setDesc("有效編輯時間只在內容指紋改變時更新，排序、卡片時間與日期分組都使用它。紀錄只存本機，不會同步。首次觀察以當時 mtime 為基準；已被重寫的舊時間無法回推，不會自我修正。未讀取、超大或讀取失敗的檔案以 mtime 暫代。其他排序沿用原本時間。")
      .addDropdown((dropdown) => dropdown
        .addOption("effective", "有效編輯時間（忽略無內容變更的重寫）")
        .addOption("mtime", "檔案修改時間")
        .addOption("opened", "最近開啟時間")
        .addOption("localEdit", "本機編輯時間")
        .addOption("smart", "智慧排序：本機編輯 / 開啟 / 檔案修改")
        .setValue(this.plugin.settings.sortMode || DEFAULT_SETTINGS.sortMode)
        .onChange(async (value) => {
          this.plugin.settings.sortMode = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("重設有效編輯時間基準")
      .setDesc("清空本機內容指紋與有效時間；下次摘要讀取以目前 mtime 為基準。無法恢復被重寫前的時間，不會修改筆記或同步設定。")
      .addButton((button) => button
        .setButtonText("重設基準")
        .setWarning()
        .onClick(async () => {
          await this.plugin.resetEffectiveRecords();
          new Notice("已重設有效編輯時間基準");
        }));

    new Setting(containerEl)
      .setName("記錄最近開啟")
      .setDesc("只寫入本裝置儲存，不會同步。用於最近開啟與智慧排序。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.trackRecentOpened !== false)
        .onChange(async (value) => {
          this.plugin.settings.trackRecentOpened = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("記錄本機編輯")
      .setDesc("偵測 Obsidian 編輯器變更，記錄本機編輯時間；同步工具改 mtime 時不會被當成本機編輯。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.trackLocalEdits !== false)
        .onChange(async (value) => {
          this.plugin.settings.trackLocalEdits = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("內容變更確認")
      .setDesc("v0.3.1 新增。只有內容 hash 真的改變時，才記為本機編輯；可避免手機只是點出鍵盤就排序更新。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.confirmContentChange !== false)
        .onChange(async (value) => {
          this.plugin.settings.confirmContentChange = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("手機防誤判模式")
      .setDesc("手機版開啟筆記後短時間內，若內容沒有變化，會被視為焦點 / 鍵盤事件，不記為本機編輯。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mobileFalseEditGuard !== false)
        .onChange(async (value) => {
          this.plugin.settings.mobileFalseEditGuard = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("內容確認延遲")
      .setDesc("桌機 / 手機的 hash debounce。數字越大越省電，也越不容易受連續事件干擾。")
      .addText((text) => text
        .setPlaceholder("桌機 ms，例如 900")
        .setValue(String(this.plugin.settings.hashDebounceMs || 900))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.hashDebounceMs = Math.max(200, Math.min(parsed, 10000));
            await this.plugin.saveSettings();
          }
        }))
      .addText((text) => text
        .setPlaceholder("手機 ms，例如 1800")
        .setValue(String(this.plugin.settings.mobileHashDebounceMs || 1800))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.mobileHashDebounceMs = Math.max(200, Math.min(parsed, 10000));
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("大檔案略過門檻")
      .setDesc("超過此大小就不做內容 hash，避免大型筆記或 Canvas 影響手機效能。單位：KB。")
      .addText((text) => text
        .setPlaceholder("1024")
        .setValue(String(Math.round((this.plugin.settings.maxHashFileSizeBytes || 1048576) / 1024)))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            const kb = Math.max(64, Math.min(parsed, 20480));
            this.plugin.settings.maxHashFileSizeBytes = kb * 1024;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("顯示排序來源")
      .setDesc("在每個項目時間旁顯示：有效編輯、檔案修改、最近開啟或本機編輯。")
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.showSortReason)
        .onChange(async (value) => {
          this.plugin.settings.showSortReason = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("清除本機排序紀錄")
      .setDesc("清除外掛記錄的最近開啟與本機編輯時間；不會刪除任何筆記。")
      .addButton((button) => button
        .setButtonText("清除")
        .setWarning()
        .onClick(async () => {
          const ok = window.confirm("確定要清除 ReNotes 的本機排序紀錄嗎？\n\n這不會刪除任何筆記，只會清除最近開啟 / 本機編輯時間。");
          if (!ok) return;
          for (const path of this.plugin.pendingLocalEditTimers.keys()) this.plugin.clearPendingLocalEditTimer(path);
          this.plugin.fileActivity = Object.create(null);
          this.plugin.saveActivityDebounced.cancel();
          await this.plugin.saveActivity();
          await this.plugin.refreshViews();
          new Notice("已清除本機排序紀錄");
        }));

    new Setting(containerEl)
      .setName("標題來源")
      .setDesc("自動：優先使用第一個 H1，沒有 H1 時使用檔名。")
      .addDropdown((dropdown) => dropdown
        .addOption("auto", "自動")
        .addOption("filename", "檔名")
        .addOption("h1", "第一個 H1")
        .setValue(this.plugin.settings.titleSource)
        .onChange(async (value) => {
          this.plugin.settings.titleSource = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("點擊筆記開啟方式")
      .setDesc("固定行為：左鍵取代目前主要分頁；滑鼠中鍵或 Ctrl/Cmd 點擊另開新分頁。右鍵選單包含開新分頁、新視窗開啟與刪除，並保留 Obsidian 原本的檔案選單項目。");

    new Setting(containerEl)
      .setName("包含 Canvas")
      .setDesc("開啟後，.canvas 檔會和 Markdown 筆記一起依最近修改時間排序顯示；不會建立新的 Canvas。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeCanvas !== false)
        .onChange(async (value) => {
          this.plugin.settings.includeCanvas = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    containerEl.createEl("h3", { text: "Canvas 深度支援" });

    new Setting(containerEl)
      .setName("Canvas 摘要模式")
      .setDesc("智慧模式會依序使用白板文字、分組名稱、連結筆記與結構統計。")
      .addDropdown((dropdown) => dropdown
        .addOption("smart", "智慧摘要")
        .addOption("text", "優先顯示文字節點")
        .addOption("files", "優先顯示連結筆記")
        .addOption("stats", "只顯示結構統計")
        .setValue(this.plugin.settings.canvasPreviewMode || "smart")
        .onChange(async (value) => {
          this.plugin.settings.canvasPreviewMode = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("Canvas 預覽項目數")
      .setDesc("控制 Canvas 摘要與連結筆記晶片最多顯示幾個項目。")
      .addText((text) => text
        .setPlaceholder("5")
        .setValue(String(this.plugin.settings.canvasPreviewItemLimit || 5))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.canvasPreviewItemLimit = Math.max(1, Math.min(parsed, 20));
            await this.plugin.saveSettingsAndRefresh();
          }
        }));

    new Setting(containerEl)
      .setName("顯示搜尋框")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showSearch)
        .onChange(async (value) => {
          this.plugin.settings.showSearch = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("顯示類型篩選")
      .setDesc("在篩選面板內顯示：全部 / 筆記 / Canvas。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showTypeFilter !== false)
        .onChange(async (value) => {
          this.plugin.settings.showTypeFilter = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("預設類型篩選")
      .setDesc("最近修改面板開啟時預設顯示的檔案類型。")
      .addDropdown((dropdown) => dropdown
        .addOption("all", "全部")
        .addOption("markdown", "筆記")
        .addOption("canvas", "Canvas")
        .setValue(this.plugin.settings.defaultTypeFilter || "all")
        .onChange(async (value) => {
          this.plugin.settings.defaultTypeFilter = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("顯示結果數量")
      .setDesc("在標題下方顯示目前列表項目數。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showResultCount !== false)
        .onChange(async (value) => {
          this.plugin.settings.showResultCount = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("固定頂部工具列")
      .setDesc("捲動列表時，標題、搜尋與篩選區會固定在面板上方。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.stickyHeader !== false)
        .onChange(async (value) => {
          this.plugin.settings.stickyHeader = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("時間格式")
      .setDesc("控制游標停留時的時間提示；清單固定今天／昨天 HH:mm、七天內星期、更早日期。")
      .addDropdown((dropdown) => dropdown
        .addOption("short", "簡短")
        .addOption("full", "完整日期時間")
        .setValue(this.plugin.settings.dateFormat)
        .onChange(async (value) => {
          this.plugin.settings.dateFormat = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("只包含這些資料夾")
      .setDesc("每行一個資料夾。留空代表全 Vault。")
      .addTextArea((text) => text
        .setPlaceholder("日記\n專案")
        .setValue(this.plugin.settings.includedFolders)
        .onChange(async (value) => {
          this.plugin.settings.includedFolders = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("排除資料夾")
      .setDesc("每行一個資料夾，例如 Templates、Archive。")
      .addTextArea((text) => text
        .setPlaceholder("Templates\nArchive")
        .setValue(this.plugin.settings.excludedFolders)
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("排除標籤")
      .setDesc("每行一個標籤，例如 #archive、#封存。")
      .addTextArea((text) => text
        .setPlaceholder("#archive\n#封存")
        .setValue(this.plugin.settings.excludedTags)
        .onChange(async (value) => {
          this.plugin.settings.excludedTags = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("最近修改面板位置")
      .setDesc("建議選左側，會比較接近 UpNote 的筆記列表。")
      .addDropdown((dropdown) => dropdown
        .addOption("left", "左側")
        .addOption("right", "右側")
        .setValue(this.plugin.settings.viewLocation || "left")
        .onChange(async (value) => {
          this.plugin.settings.viewLocation = value;
          await this.plugin.saveSettings();
          new Notice("面板位置設定已儲存，請關閉舊的最近修改面板後重新開啟。");
        }));

    containerEl.createEl("h3", { text: "效能與快取" });

    new Setting(containerEl)
      .setName("啟用摘要快取")
      .setDesc("檔案修改時間與大小沒有改變時，重用已解析的標題、摘要、標籤與 Canvas 結構，減少重複讀取檔案。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableCache !== false)
        .onChange(async (value) => {
          this.plugin.settings.enableCache = value;
          if (!value) this.plugin.clearItemCache(false);
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("快取上限")
      .setDesc("最多保留幾個檔案的解析結果。大量筆記建議 800–2000。")
      .addText((text) => text
        .setPlaceholder("1200")
        .setValue(String(this.plugin.settings.cacheMaxEntries || 1200))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.cacheMaxEntries = Math.max(100, Math.min(parsed, 10000));
            this.plugin.pruneItemCache();
            await this.plugin.saveSettingsAndRefresh();
          }
        }));

    new Setting(containerEl)
      .setName("可快取檔案大小上限")
      .setDesc("超過此大小仍可顯示，但不會放入摘要快取，避免快取占用過多記憶體。單位：KB。")
      .addText((text) => text
        .setPlaceholder("2048")
        .setValue(String(Math.round((this.plugin.settings.cacheMaxFileSizeBytes || 2097152) / 1024)))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            const kb = Math.max(64, Math.min(parsed, 51200));
            this.plugin.settings.cacheMaxFileSizeBytes = kb * 1024;
            this.plugin.pruneItemCache();
            await this.plugin.saveSettingsAndRefresh();
          }
        }));

    new Setting(containerEl)
      .setName("分批渲染列表")
      .setDesc("大量項目時分批畫出列表，減少手機版或大型 Vault 開啟面板時的卡頓。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.progressiveRender !== false)
        .onChange(async (value) => {
          this.plugin.settings.progressiveRender = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("每批渲染數量")
      .setDesc("分批渲染開啟時，每次畫出幾筆。手機建議 15–30；桌機可 30–60。")
      .addText((text) => text
        .setPlaceholder("30")
        .setValue(String(this.plugin.settings.renderBatchSize || 30))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            this.plugin.settings.renderBatchSize = Math.max(5, Math.min(parsed, 100));
            await this.plugin.saveSettingsAndRefresh();
          }
        }));

    new Setting(containerEl)
      .setName("顯示效能統計")
      .setDesc("Debug 模式開啟時，在標題下方顯示讀取數、快取命中數、解析數與耗時。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showPerformanceStats !== false)
        .onChange(async (value) => {
          this.plugin.settings.showPerformanceStats = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("清除摘要快取")
      .setDesc("清除記憶體中的摘要快取。下一次重新整理會重新讀取並建立快取；不會影響任何筆記內容。")
      .addButton((button) => button
        .setButtonText("清除快取")
        .onClick(async () => {
          const count = this.plugin.clearItemCache(false);
          await this.plugin.refreshViews();
          new Notice(`已清除 ${count} 筆摘要快取`);
        }));

    new Setting(containerEl)
      .setName("Debug 模式")
      .setDesc("列表為空時顯示讀取統計，方便排查資料夾或標籤篩選。")
      .addToggle((toggle) => toggle
        .setValue(!!this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettingsAndRefresh();
        }));

    new Setting(containerEl)
      .setName("空摘要文字")
      .setDesc("筆記沒有可顯示內容時出現的文字。")
      .addText((text) => text
        .setValue(this.plugin.settings.emptySnippetText)
        .onChange(async (value) => {
          this.plugin.settings.emptySnippetText = value || "沒有其他文字";
          await this.plugin.saveSettingsAndRefresh();
        }));
    containerEl.createEl("h3", { text: "說明" });
    containerEl.createEl("p", {
      text: "若使用 Lazy Loader，建議把 ReNotes 設為『instant』，可避免側欄分頁短暫顯示幽靈圖示"
    });
  }
}


// ReNotes-specific confirmation; does not modify global Obsidian delete prompts.
let rnfDeleteDialogSequence = 0;
class ReNotesDeleteModal extends Modal {
  constructor(app, file, onConfirm) {
    super(app);
    this.file = file;
    this.onConfirm = onConfirm;
    this.isSubmitting = false;
    this.dialogId = "rnf-delete-" + (++rnfDeleteDialogSequence);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("rnf-delete-content");
    if (this.modalEl) {
      this.modalEl.addClass("rnf-delete-dialog");
      this.modalEl.setAttribute("role", "alertdialog");
      this.modalEl.setAttribute("aria-labelledby", this.dialogId + "-title");
      this.modalEl.setAttribute("aria-describedby", this.dialogId + "-details");
    }
    const isCanvas = this.file.extension === "canvas";
    const mode = this.app.vault.getConfig?.("trashOption") ?? this.app.vault.config?.trashOption;
    const isPermanent = mode === "none";
    const heading = contentEl.createDiv({ cls: "rnf-delete-heading" });
    const iconEl = heading.createDiv({ cls: "rnf-delete-icon" });
    setIcon(iconEl, "trash-2");
    const headingBody = heading.createDiv({ cls: "rnf-delete-heading-body" });
    const title = headingBody.createEl("h2", {
      cls: "rnf-delete-title",
      text: isCanvas ? "要刪除這張 Canvas 嗎？" : "要刪除這份筆記嗎？"
    });
    title.setAttribute("id", this.dialogId + "-title");
    const subtitle = headingBody.createEl("p", {
      cls: "rnf-delete-subtitle",
      text: "請先確認下方檔案，只有按下確認才會執行刪除。"
    });
    subtitle.setAttribute("id", this.dialogId + "-details");

    const fileRow = contentEl.createDiv({ cls: "rnf-delete-file" });
    const fileIcon = fileRow.createDiv({ cls: "rnf-delete-file-icon" });
    setIcon(fileIcon, isCanvas ? "layout-dashboard" : "file-text");
    const fileDetails = fileRow.createDiv({ cls: "rnf-delete-file-details" });
    fileDetails.createDiv({ cls: "rnf-delete-filename", text: this.file.name });
    const folder = this.file.parent?.path && this.file.parent.path !== "/" ? this.file.parent.path : "Vault 根目錄";
    fileDetails.createDiv({ cls: "rnf-delete-filepath", text: folder });

    const info = contentEl.createDiv({ cls: "rnf-delete-info" });
    const infoIcon = info.createDiv({ cls: "rnf-delete-info-icon" });
    setIcon(infoIcon, "info");
    const message = mode === "system"
      ? "檔案會移至系統垃圾桶，可依系統設定嘗試還原。"
      : mode === "local"
        ? "檔案會移至這個 Vault 的 .trash 資料夾。"
        : isPermanent
          ? "目前 Obsidian 設定為永久刪除，這項操作可能無法復原。"
          : "實際刪除方式依 Obsidian 的垃圾桶設定而定；部分方式可能無法復原。";
    info.createDiv({ cls: "rnf-delete-info-text", text: message });
    this.errorEl = contentEl.createDiv({ cls: "rnf-delete-error" });
    this.errorEl.setAttribute("role", "status");
    this.errorEl.setAttribute("aria-live", "polite");

    const actions = contentEl.createDiv({ cls: "rnf-delete-actions" });
    const cancelButton = actions.createEl("button", { cls: "rnf-delete-cancel", text: "取消" });
    const actionLabel = isPermanent ? "永久刪除" : (mode === "local" || mode === "system") ? "移至垃圾桶" : "確認刪除";
    const submitButton = actions.createEl("button", { cls: "rnf-delete-confirm mod-warning", text: actionLabel });
    cancelButton.addEventListener("click", () => {
      if (!this.isSubmitting) this.close();
    });
    submitButton.addEventListener("click", async () => {
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      cancelButton.disabled = true;
      submitButton.disabled = true;
      submitButton.textContent = "處理中…";
      this.errorEl.textContent = "";
      try {
        const outcome = await this.onConfirm();
        if (outcome?.ok) {
          this.close();
          return;
        }
        this.errorEl.textContent = outcome?.error || "操作未完成，請稍後再試。";
      } catch (error) {
        console.error("ReNotes: unexpected delete modal error", error);
        this.errorEl.textContent = "發生非預期錯誤，檔案尚未確認刪除成功。";
      } finally {
        this.isSubmitting = false;
        cancelButton.disabled = false;
        submitButton.disabled = false;
        submitButton.textContent = actionLabel;
      }
    });
    // Default focus is Cancel: Enter cannot accidentally delete the note.
    cancelButton.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class RenameFileModal extends Modal {
  constructor(app, file, onSubmit) {
    super(app);
    this.file = file;
    this.onSubmit = onSubmit;
    this.inputEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("recent-notes-feed-root", "rnf-rename-modal");

    contentEl.createEl("h2", { text: "重新命名" });
    contentEl.createEl("p", {
      text: "輸入新的檔名。若沒有輸入副檔名，會自動保留原本的副檔名。",
      cls: "rnf-rename-desc"
    });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      value: this.file.name,
      cls: "rnf-rename-input"
    });
    this.inputEl.setAttr("aria-label", "新的檔名");

    const buttonsEl = contentEl.createDiv({ cls: "rnf-rename-buttons" });
    const cancelButton = buttonsEl.createEl("button", { text: "取消" });
    const submitButton = buttonsEl.createEl("button", { text: "重新命名", cls: "mod-cta" });

    const submit = async () => {
      if (!this.inputEl) return;
      submitButton.disabled = true;
      const ok = await this.onSubmit(this.inputEl.value);
      submitButton.disabled = false;
      if (ok) this.close();
    };

    cancelButton.addEventListener("click", () => this.close());
    submitButton.addEventListener("click", submit);
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") this.close();
    });

    window.setTimeout(() => {
      this.inputEl.focus();
      const dot = this.file.name.lastIndexOf(".");
      const end = dot > 0 ? dot : this.file.name.length;
      this.inputEl.setSelectionRange(0, end);
    }, 20);
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class RecentNotesFeedPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    addIcon("renotes", RENOTES_ICON);
    this.lastMainLeaf = null;
    this.sidebarLayoutReadyHandled = false;
    this.sidebarLayoutWaiters = new Set();
    this.sidebarCleanupTimes = [];
    this.sidebarLastLayoutChange = Date.now();
    this.sidebarTimer = null;
    // registerView can temporarily remove a ghost from BOTH leaf iterators while
    // the host rebuilds it. Remember restored placeholders before registering.
    this.sidebarRestoringLeaves = new Set(this.getRecentNotesLeaves().filter((leaf) => !leaf.isDeferred && !this.isRealRecentNotesLeaf(leaf)));
    this.pendingLocalEditTimers = new Map();
    this.localEditTokens = new Map();
    this.unloaded = false;
    this.itemCache = new Map();
    this.failedImageThumbnails = new Set();
    this.cacheInvalidationCount = 0;
    this.savePinsDebounced = debounce(() => this.savePinnedSettings(), 300);
    this.saveActivityDebounced = debounce(() => this.saveActivity(), 1500);
    this.saveEffectiveDebounced = debounce(() => this.saveEffectiveRecords(), 1500);
    this.refreshForActivityDebounced = debounce(() => this.refreshViews(), 500);

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      if (this.unloaded) return;
      this.sidebarLastLayoutChange = Date.now();
      this.updateRestoringRecentNotesLeaves();
    }));
    this.registerView(
      VIEW_TYPE_RECENT_NOTES_FEED,
      (leaf) => new RecentNotesFeedView(leaf, this)
    );

    this.addRibbonIcon("renotes", "開啟 ReNotes", () => this.activateView());

    this.addCommand({
      id: "open-recent-notes-feed",
      name: "開啟 ReNotes",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "refresh-recent-notes-feed",
      name: "重新整理 ReNotes",
      callback: () => this.refreshViews()
    });

    for (const pinned of [true, false]) {
      this.addCommand({
        id: pinned ? "pin-current-file" : "unpin-current-file",
        name: pinned ? "釘選目前檔案" : "取消釘選目前檔案",
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!(file instanceof TFile) || !["md", "canvas"].includes(file.extension)) return false;
          if (this.isPinned(file.path) === pinned) return false;
          if (!checking) this.setPinned(file.path, pinned);
          return true;
        }
      });
    }

    this.addSettingTab(new RecentNotesFeedSettingTab(this.app, this));

    this.scheduleRefresh = debounce(() => this.refreshViews(), this.settings.debounceMs);

    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultChanged(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChanged(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.clearPendingLocalEditTimer(file && file.path);
      this.invalidateFileCache(file);
      this.removeActivityForFile(file);
      this.changeEffectivePaths(file, null);
      this.settings.pinnedPaths = this.settings.pinnedPaths.filter((path) => path !== file.path && !path.startsWith(file.path + "/"));
      this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.clearPendingLocalEditTimer(oldPath);
      this.migrateActivityPath(file, oldPath);
      this.migrateCachePath(file, oldPath);
      this.changeEffectivePaths(file, oldPath);
      this.settings.pinnedPaths = normalizePinnedPaths(this.settings.pinnedPaths.map((path) => path === oldPath ? file.path : path.startsWith(oldPath + "/") ? file.path + path.slice(oldPath.length) : path));
      this.scheduleRefresh();
    }));

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (this.isMainWorkspaceLeaf(leaf)) {
        this.lastMainLeaf = leaf;
      }
      this.refreshActiveItemMarks();
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile) {
        this.markFileOpened(file);
      }
      this.refreshActiveItemMarks();
    }));

    try {
      this.registerDomEvent(document, "beforeinput", (event) => this.captureLocalInput(event), true);
      for (const name of ["paste", "cut", "drop", "keydown"]) {
        this.registerDomEvent(document, name, (event) => this.captureLocalInput(event), true);
      }
      this.registerEvent(this.app.workspace.on("editor-change", (editor, view) => {
        const file = view && view.file instanceof TFile ? view.file : this.app.workspace.getActiveFile();
        const input = this.localInput;
        this.localInput = null;
        if (file instanceof TFile && file.extension === "md" && input
          && input.path === file.path && Date.now() - input.at < 1500
          && editor && typeof editor.getValue === "function") {
          this.markFileEditedLocally(file, simpleContentHash(editor.getValue()));
        }
      }));
    } catch (error) {
      console.warn("ReNotes: editor-change event is not available", error);
    }

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (this.sidebarLayoutReadyHandled) return this.sidebarStartupPromise;
      this.sidebarLayoutReadyHandled = true;
      this.sidebarStartupPromise = this.restoreRecentNotesSidebar();
      return this.sidebarStartupPromise;
    });
  }

  onunload() {
    if (this.savePinsDebounced) this.savePinsDebounced.cancel();
    if (this.pendingPinSave) this.savePinnedSettings();
    this.unloaded = true;
    if (this.sidebarTimer !== null) window.clearInterval(this.sidebarTimer);
    this.sidebarTimer = null;
    for (const waiter of this.sidebarLayoutWaiters || []) waiter.resolve(false);
    if (this.sidebarLayoutWaiters) this.sidebarLayoutWaiters.clear();
    this.sidebarCleanupTimes = [];
    if (this.sidebarRestoringLeaves) this.sidebarRestoringLeaves.clear();
    if (this.localEditTokens) this.localEditTokens.clear();
    for (const timer of (this.pendingLocalEditTimers || new Map()).values()) window.clearTimeout(timer);
    for (const fn of [this.saveActivityDebounced, this.saveEffectiveDebounced, this.refreshForActivityDebounced, this.scheduleRefresh]) {
      if (fn && fn.cancel) fn.cancel();
    }
    this.saveActivity();
    if (this.effectiveDirty) this.saveEffectiveRecords();
  }

  async loadSettings() {
    const data = await this.loadData();
    this.pendingActivityMigration = false;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    delete this.settings.fileActivity;
    const storedLayoutVersion = Number(data && data.layoutVersion);
    const upgradeLayout = data && Object.keys(data).length > 0
      && (!Number.isFinite(storedLayoutVersion) || storedLayoutVersion < 5);
    if (upgradeLayout) {
      if (!Number.isFinite(storedLayoutVersion) || storedLayoutVersion < 4) {
        for (const key of ["showSnippet", "groupByDate", "showFolder", "showTags", "listDensity", "showImageThumbnail", "showCanvasThumbnail", "snippetLines", "mobileSnippetLines"]) {
          this.settings[key] = DEFAULT_SETTINGS[key];
        }
      }
      this.settings.sortMode = "effective";
      this.settings.layoutVersion = 5;
    }
    this.persistedPinnedPaths = normalizePinnedPaths(data && data.pinnedPaths);
    // 啟動時 vault 索引可能尚未就緒，載入階段不依檔案是否存在過濾；列表渲染只會顯示實際存在的項目，
    // 失效路徑留到使用者下一次明確釘選操作時才清理。
    this.settings.pinnedPaths = this.persistedPinnedPaths.slice();
    this.pendingPinSave = false;
    this.fileActivity = Object.create(null);
    try {
      const value = await this.app.loadLocalStorage(ACTIVITY_STORAGE_KEY);
      if (typeof value === "string") this.fileActivity = mergeActivity(JSON.parse(value));
    } catch (error) {
      console.warn("ReNotes: invalid local activity, using empty records", error);
    }
    this.effectiveRecords = Object.create(null);
    this.effectiveDirty = false;
    try {
      const value = await this.app.loadLocalStorage(EFFECTIVE_STORAGE_KEY);
      if (typeof value === "string") this.effectiveRecords = normalizeEffectiveRecords(JSON.parse(value));
    } catch (error) {
      console.warn("ReNotes: invalid local effective times, using empty records", error);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, "fileActivity")) {
      this.fileActivity = mergeActivity(this.fileActivity, data.fileActivity);
      this.pendingActivityMigration = true;
    }
    if (this.pendingActivityMigration || upgradeLayout) await this.saveSettings();
  }

  async saveSettings() {
    const settings = Object.assign({}, this.settings);
    delete settings.fileActivity;
    settings.pinnedPaths = this.persistedPinnedPaths.slice();
    const save = async () => {
      if (this.pendingActivityMigration && !(await this.saveActivity())) return false;
      await this.saveData(settings);
      this.pendingActivityMigration = false;
      return true;
    };
    // 避免較慢的舊釘選／設定寫入晚於新操作完成，覆蓋最新清單。
    const pending = (this.settingsSavePromise || Promise.resolve()).then(save);
    this.settingsSavePromise = pending.catch(() => {});
    return pending;
  }

  isPinned(path) {
    return this.settings.pinnedPaths.includes(path);
  }

  setPinned(path, pinned) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !["md", "canvas"].includes(file.extension)) return;
    if (this.isPinned(path) === pinned) return;
    this.settings.pinnedPaths = this.settings.pinnedPaths.filter((value) => value !== path);
    if (pinned) this.settings.pinnedPaths.unshift(path);
    this.pendingPinSave = true;
    this.savePinsDebounced();
    this.refreshViews();
  }

  async savePinnedSettings() {
    if (!this.pendingPinSave) return;
    this.pendingPinSave = false;
    this.settings.pinnedPaths = this.settings.pinnedPaths.filter((path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile && ["md", "canvas"].includes(file.extension);
    });
    this.persistedPinnedPaths = this.settings.pinnedPaths.slice();
    try {
      if (!(await this.saveSettings())) this.pendingPinSave = true;
    } catch (error) {
      this.pendingPinSave = true;
      console.warn("ReNotes: failed to save pins", error);
      new Notice("釘選儲存失敗，下一次操作會重試");
    }
  }

  async saveActivity() {
    const map = getActivityMap(this);
    pruneActivity(this, new Set(Object.keys(map)));
    try {
      await this.app.saveLocalStorage(ACTIVITY_STORAGE_KEY, JSON.stringify(map));
      return true;
    } catch (error) {
      console.warn("ReNotes: failed to save device activity", error);
      return false;
    }
  }

  async saveEffectiveRecords() {
    pruneEffectiveRecords(this.effectiveRecords);
    // 依序寫入，避免較慢的舊保存覆蓋重設或較新的觀察。
    const value = JSON.stringify(this.effectiveRecords);
    this.effectiveDirty = false;
    const save = async () => {
      try {
        await this.app.saveLocalStorage(EFFECTIVE_STORAGE_KEY, value);
        return true;
      } catch (error) {
        this.effectiveDirty = true;
        console.warn("ReNotes: failed to save effective times", error);
        return false;
      }
    };
    this.effectiveSavePromise = (this.effectiveSavePromise || Promise.resolve()).then(save);
    return this.effectiveSavePromise;
  }

  observeEffectiveContent(file, content, fp) {
    if (this.unloaded || this.shouldSkipHashForSize(file)) return null;
    const map = this.effectiveRecords;
    const previous = map[file.path];
    const m = getFileStatNumber(file, "mtime"), s = getFileStatNumber(file, "size");
    if (previous && previous.m === m && previous.s === s) return previous;
    fp = fp || contentFingerprint(content, file.extension);
    const entry = { fp, t: previous && previous.fp === fp ? previous.t : m, m, s };
    map[file.path] = entry;
    pruneEffectiveRecords(map);
    this.effectiveDirty = true;
    this.saveEffectiveDebounced();
    return entry;
  }

  changeEffectivePaths(file, oldPath) {
    if (!file || !file.path) return;
    const map = this.effectiveRecords;
    let changed = false;
    const prefix = oldPath || file.path;
    for (const path of Object.keys(map)) {
      if (path !== prefix && !path.startsWith(prefix + "/")) continue;
      const entry = map[path];
      delete map[path];
      if (oldPath) map[file.path + path.slice(prefix.length)] = entry;
      changed = true;
    }
    if (changed) {
      this.effectiveDirty = true;
      this.saveEffectiveDebounced();
    }
  }

  async resetEffectiveRecords() {
    this.saveEffectiveDebounced.cancel();
    this.effectiveRecords = Object.create(null);
    // 已讀內容的指紋仍留在摘要快取；下次命中可建立新基準，不必重讀。
    await this.saveEffectiveRecords();
    await this.refreshViews();
  }

  captureLocalInput(event) {
    if (!event.isTrusted || !event.target || typeof event.target.closest !== "function") return;
    if (!event.target.closest(".markdown-source-view")) return;
    if (event.type === "keydown") {
      const command = event.ctrlKey || event.metaKey;
      const changesText = command ? ["z", "y", "v", "x"].includes(String(event.key).toLowerCase())
        : event.key.length === 1 || ["Backspace", "Delete", "Enter", "Tab"].includes(event.key);
      if (!changesText || event.altKey) return;
    }
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile) this.localInput = { path: file.path, at: Date.now() };
  }

  async saveSettingsAndRefresh() {
    await this.saveSettings();
    await this.refreshViews();
  }

  touchActivity(file, patch) {
    if (this.unloaded) return;
    if (!(file instanceof TFile)) return;
    if (!isSupportedRecentFile(file, this.settings)) return;
    const map = getActivityMap(this);
    const existing = map[file.path] && typeof map[file.path] === "object" ? map[file.path] : {};
    map[file.path] = Object.assign({}, existing, patch);
    this.saveActivityDebounced();
  }

  markFileOpened(file) {
    if (this.settings.trackRecentOpened !== false) {
      this.touchActivity(file, { lastOpened: Date.now() });
      if (["opened", "smart"].includes(this.settings.sortMode)) {
        this.refreshForActivityDebounced();
      }
    }

    if (this.settings.baselineContentHashOnOpen !== false && this.settings.confirmContentChange !== false) {
      this.updateContentHashBaseline(file, "open");
    }
  }

  markFileEditedLocally(file, expectedHash) {
    if (this.settings.trackLocalEdits === false) return;

    if (this.settings.confirmContentChange === false) {
      this.touchActivity(file, { lastLocalEdit: Date.now(), lastLocalEditSource: "editor-change" });
      if (["localEdit", "smart"].includes(this.settings.sortMode)) {
        this.refreshForActivityDebounced();
      }
      return;
    }

    this.scheduleLocalEditConfirmation(file, expectedHash);
  }

  getEffectiveHashDebounceMs() {
    const fallback = isMobilePlatform() ? 1800 : 900;
    const configured = isMobilePlatform()
      ? Number(this.settings.mobileHashDebounceMs)
      : Number(this.settings.hashDebounceMs);
    return Math.max(200, Math.min(Number.isFinite(configured) && configured > 0 ? configured : fallback, 10000));
  }

  getMaxHashFileSizeBytes() {
    const configured = Number(this.settings.maxHashFileSizeBytes);
    if (!Number.isFinite(configured) || configured <= 0) return 1048576;
    return Math.max(64 * 1024, Math.min(configured, 20 * 1024 * 1024));
  }

  clearPendingLocalEditTimer(path) {
    if (!path || !this.pendingLocalEditTimers) return;
    if (this.localEditTokens) this.localEditTokens.delete(path);
    const timer = this.pendingLocalEditTimers.get(path);
    if (timer) window.clearTimeout(timer);
    this.pendingLocalEditTimers.delete(path);
  }

  shouldSkipHashForSize(file) {
    const size = Number(file && file.stat && file.stat.size) || 0;
    return size > this.getMaxHashFileSizeBytes();
  }

  storeContentHash(file, content, patch = {}) {
    if (!(file instanceof TFile)) return false;
    if (!isSupportedRecentFile(file, this.settings)) return false;
    const hash = simpleContentHash(content);
    const size = Number(file.stat && file.stat.size) || String(content || "").length;
    this.touchActivity(file, Object.assign({
      contentHash: hash,
      contentLength: String(content || "").length,
      contentSize: size,
      contentHashMtime: Number(file.stat && file.stat.mtime) || 0,
      contentHashUpdatedAt: Date.now(),
      contentHashSkipped: false
    }, patch));
    return true;
  }

  async updateContentHashBaseline(file, source = "baseline") {
    if (!(file instanceof TFile)) return;
    if (!isSupportedRecentFile(file, this.settings)) return;
    if (this.localEditTokens && this.localEditTokens.has(file.path)) return;
    const path = file.path;
    const map = getActivityMap(this);
    const entry = map[path];
    const stamp = getFileReadStamp(file);
    if (this.shouldSkipHashForSize(file)) {
      this.touchActivity(file, {
        contentHashSkipped: true,
        contentHashSkipReason: "large-file",
        contentHashUpdatedAt: Date.now()
      });
      return;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      if (!this.isCurrentActivityFile(file, path, map, stamp) || map[path] !== entry) return;
      if (this.localEditTokens && this.localEditTokens.has(path)) return;
      this.storeContentHash(file, content, { contentHashSource: source });
    } catch (error) {
      console.warn("ReNotes: failed to update content hash baseline", file.path, error);
    }
  }

  scheduleLocalEditConfirmation(file, expectedHash) {
    if (!(file instanceof TFile)) return;
    if (!isSupportedRecentFile(file, this.settings)) return;

    if (this.shouldSkipHashForSize(file)) {
      // Large files are intentionally ignored when content confirmation is enabled.
      // This avoids slow reads on mobile and prevents false local-edit sorting.
      this.touchActivity(file, {
        contentHashSkipped: true,
        contentHashSkipReason: "large-file",
        contentHashUpdatedAt: Date.now()
      });
      return;
    }

    const path = file.path;
    const previousHash = getFileActivity(this, path).contentHash;
    this.clearPendingLocalEditTimer(path);
    const token = {};
    this.localEditTokens.set(path, token);
    const wait = this.getEffectiveHashDebounceMs();
    const timer = window.setTimeout(() => {
      if (this.pendingLocalEditTimers) this.pendingLocalEditTimers.delete(path);
      this.confirmLocalEditByContent(path, expectedHash, previousHash, token).finally(() => {
        if (this.localEditTokens.get(path) === token) this.localEditTokens.delete(path);
      });
    }, wait);
    this.pendingLocalEditTimers.set(path, timer);
  }

  isCurrentActivityFile(file, path, map, stamp) {
    return !this.unloaded && this.fileActivity === map && file.path === path
      && this.app.vault.getAbstractFileByPath(path) === file
      && (stamp === undefined || stamp === getFileReadStamp(file));
  }

  async confirmLocalEditByContent(path, expectedHash, baselineHash, token) {
    if (this.settings.trackLocalEdits === false) return;
    const freshFile = this.app.vault.getAbstractFileByPath(path);
    if (!(freshFile instanceof TFile)) return;
    if (!isSupportedRecentFile(freshFile, this.settings)) return;
    if (this.shouldSkipHashForSize(freshFile)) return;
    const map = getActivityMap(this);
    const stamp = getFileReadStamp(freshFile);

    let content = "";
    try {
      content = await this.app.vault.cachedRead(freshFile);
    } catch (error) {
      console.warn("ReNotes: failed to confirm local edit", path, error);
      return;
    }

    if (!this.isCurrentActivityFile(freshFile, path, map, stamp) || this.settings.trackLocalEdits === false) return;
    if (token && this.localEditTokens.get(path) !== token) return;

    const now = Date.now();
    const hash = simpleContentHash(content);
    const activity = getFileActivity(this, freshFile.path);
    const previousHash = typeof baselineHash === "string" ? baselineHash : activity.contentHash || "";
    if (expectedHash && expectedHash !== hash) {
      this.storeContentHash(freshFile, content, { contentHashSource: "external-change", lastIgnoredLocalEditReason: "editor-content-mismatch" });
      return;
    }
    const lastOpened = Number(activity.lastOpened) || 0;
    const withinMobileGuardWindow = this.settings.mobileFalseEditGuard !== false
      && isMobilePlatform()
      && lastOpened > 0
      && now - lastOpened < 3000;

    if (!previousHash) {
      // First observation only establishes a baseline. This prevents opening a note
      // or focusing the mobile editor from being recorded as a real local edit.
      this.storeContentHash(freshFile, content, {
        contentHashSource: withinMobileGuardWindow ? "mobile-guard-baseline" : "first-baseline",
        lastIgnoredLocalEditAt: now,
        lastIgnoredLocalEditReason: "no-previous-content-hash"
      });
      return;
    }

    if (previousHash === hash) {
      this.storeContentHash(freshFile, content, {
        contentHashSource: withinMobileGuardWindow ? "mobile-guard-no-change" : "no-change",
        lastIgnoredLocalEditAt: now,
        lastIgnoredLocalEditReason: "content-unchanged"
      });
      return;
    }

    this.storeContentHash(freshFile, content, {
      contentHashSource: "confirmed-local-edit",
      lastLocalEdit: now,
      lastLocalEditSource: "content-hash",
      lastConfirmedLocalEditAt: now,
      lastIgnoredLocalEditReason: ""
    });

    if (["localEdit", "smart"].includes(this.settings.sortMode)) {
      this.refreshForActivityDebounced();
    }
  }

  removeActivityForFile(file) {
    if (!file || !file.path) return;
    const map = getActivityMap(this);
    if (map[file.path]) {
      delete map[file.path];
      this.saveActivityDebounced();
    }
  }

  migrateActivityPath(file, oldPath) {
    if (!(file instanceof TFile) || !oldPath) return;
    const map = getActivityMap(this);
    if (!map[oldPath]) return;
    map[file.path] = mergeActivity({ [file.path]: map[file.path] }, { [file.path]: map[oldPath] })[file.path];
    delete map[oldPath];
    this.saveActivityDebounced();
  }

  getPreferredSidebarLeaf() {
    const preferred = this.settings.viewLocation === "right" ? "right" : "left";
    const methods = preferred === "right"
      ? ["getRightLeaf", "getLeftLeaf"]
      : ["getLeftLeaf", "getRightLeaf"];

    for (const method of methods) {
      if (typeof this.app.workspace[method] !== "function") continue;
      try {
        const existing = this.app.workspace[method](false);
        if (existing) return existing;
      } catch (error) {}
      try {
        const created = this.app.workspace[method](true);
        if (created) return created;
      } catch (error) {}
    }

    return this.app.workspace.getLeaf(true);
  }

  async activateView(reveal = true, layoutSettled = false) {
    if (this.unloaded) return;
    const activeLeafBeforeOpen = this.app.workspace.activeLeaf;
    if (this.isMainWorkspaceLeaf(activeLeafBeforeOpen)) {
      this.lastMainLeaf = activeLeafBeforeOpen;
    }

    // Layout restoration and a ribbon click can arrive while setViewState is pending.
    if (!this.sidebarLeafPromise) this.sidebarLeafPromise = this.ensureRecentNotesLeaf(layoutSettled);
    const pending = this.sidebarLeafPromise;
    let leaf;
    try {
      leaf = await pending;
    } catch (error) {
      console.warn("ReNotes: sidebar view could not be restored", error);
      return;
    } finally {
      if (this.sidebarLeafPromise === pending) this.sidebarLeafPromise = null;
    }

    if (reveal && leaf && !this.unloaded) {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  getRecentNotesLeaves() {
    const leaves = [];
    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      // Obsidian stops on a truthy callback result. Use a block with no returned
      // value, including when a deferred view has been found; Array.push returns a length.
      this.app.workspace.iterateAllLeaves((candidate) => {
        if (!leaves.includes(candidate) && typeof candidate.getViewState === "function") {
          try {
            // Deferred placeholders still expose the saved view type. Search even
            // when a materialized ReNotes exists, so startup also finds duplicates.
            if (candidate.getViewState().type === VIEW_TYPE_RECENT_NOTES_FEED) leaves.push(candidate);
          } catch (error) {}
        }
      });
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RECENT_NOTES_FEED)) {
      if (!leaves.includes(leaf)) leaves.push(leaf);
    }
    // Prefer actual sidebar position over a host enumeration's incidental order.
    const positions = new Map();
    const visit = (node) => {
      if (!node || positions.has(node)) return;
      positions.set(node, positions.size);
      for (const child of node.children || []) visit(child);
    };
    visit(this.app.workspace.leftSplit);
    visit(this.app.workspace.rightSplit);
    leaves.sort((a, b) => (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity));
    return leaves;
  }

  isRealRecentNotesLeaf(leaf) {
    try {
      return !leaf.isDeferred && leaf.view.getViewType() === VIEW_TYPE_RECENT_NOTES_FEED
        && typeof leaf.view.getIcon === "function" && leaf.view.getIcon() === "renotes";
    } catch (error) { return false; }
  }

  getRecentNotesLeafToKeep(leaves) {
    const workspace = this.app.workspace;
    const sidebarLeaves = leaves.filter((leaf) => {
      try {
        const root = typeof leaf.getRoot === "function" ? leaf.getRoot() : null;
        return root && (root === workspace.leftSplit || root === workspace.rightSplit);
      } catch (error) { return false; }
    });
    return sidebarLeaves.find((leaf) => this.isRealRecentNotesLeaf(leaf))
      || leaves.find((leaf) => this.isRealRecentNotesLeaf(leaf)) || leaves[0];
  }

  updateRestoringRecentNotesLeaves() {
    const leaves = this.getRecentNotesLeaves();
    for (const leaf of leaves) {
      if (!leaf.isDeferred && !this.isRealRecentNotesLeaf(leaf)) this.sidebarRestoringLeaves.add(leaf);
    }
    for (const leaf of this.sidebarRestoringLeaves) {
      try {
        if (leaf.getViewState().type !== VIEW_TYPE_RECENT_NOTES_FEED
          || (leaves.includes(leaf) && this.isRealRecentNotesLeaf(leaf))) this.sidebarRestoringLeaves.delete(leaf);
      } catch (error) {}
    }
  }

  startSidebarTimer() {
    if (this.unloaded || this.sidebarTimer !== null) return;
    this.sidebarTimer = window.setInterval(() => {
      this.updateRestoringRecentNotesLeaves();
      const now = Date.now();
      for (const waiter of this.sidebarLayoutWaiters) {
        if ((now - Math.max(waiter.started, this.sidebarLastLayoutChange) >= 600
          && this.sidebarRestoringLeaves.size === 0) || now - waiter.started >= 4000) {
          this.sidebarLayoutWaiters.delete(waiter);
          waiter.resolve(true);
        }
      }
      while (this.sidebarCleanupTimes.length && now >= this.sidebarCleanupTimes[0]) {
        this.sidebarCleanupTimes.shift();
        // Only clean up views seen during startup; never remove a later user-created tab.
        this.removeDuplicateRecentNotesLeaves(this.sidebarStartupCandidates);
      }
      if (!this.sidebarLayoutWaiters.size && !this.sidebarCleanupTimes.length) {
        window.clearInterval(this.sidebarTimer);
        this.sidebarTimer = null;
      }
    }, 50);
    this.registerInterval(this.sidebarTimer);
  }

  waitForSidebarLayout() {
    if (this.unloaded) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.sidebarLayoutWaiters.add({ started: Date.now(), resolve });
      this.startSidebarTimer();
    });
  }

  async restoreRecentNotesSidebar() {
    if (!await this.waitForSidebarLayout() || this.unloaded) return;
    this.sidebarStartupCandidates = new Set([...(this.sidebarRestoringLeaves || []), ...this.getRecentNotesLeaves()]);
    this.removeDuplicateRecentNotesLeaves();
    this.sidebarCleanupTimes = [Date.now() + 3000, Date.now() + 8000];
    this.startSidebarTimer();
    // This startup path has already waited. Ribbon/command requests always use
    // the default and must wait themselves if there is no existing leaf.
    return this.activateView(false, true);
  }

  removeDuplicateRecentNotesLeaves(onlyCandidates = null) {
    if (this.unloaded) return;
    const workspace = this.app.workspace;
    const leaves = this.getRecentNotesLeaves();
    const keep = this.getRecentNotesLeafToKeep(leaves);
    for (const leaf of leaves) {
      if (leaf === keep || (onlyCandidates && !onlyCandidates.has(leaf))) continue;
      // Only remove confirmed sidebar duplicates. Preserve editor/floating tabs
      // (including an active ReNotes tab) and leaves whose location is unknown.
      try {
        const root = typeof leaf.getRoot === "function" ? leaf.getRoot() : null;
        if (root && (root === workspace.leftSplit || root === workspace.rightSplit)
          && typeof leaf.detach === "function") {
          leaf.detach();
          this.sidebarRestoringLeaves.delete(leaf);
        }
      } catch (error) {
        console.warn("ReNotes: duplicate sidebar view could not be closed", error);
      }
    }
  }

  async ensureRecentNotesLeaf(layoutSettled = false) {
    if (this.unloaded) return null;
    let leaf = this.getRecentNotesLeafToKeep(this.getRecentNotesLeaves());
    if (!layoutSettled && (!leaf || (!leaf.isDeferred && !this.isRealRecentNotesLeaf(leaf)))) {
      if (!await this.waitForSidebarLayout() || this.unloaded) return null;
      leaf = this.getRecentNotesLeafToKeep(this.getRecentNotesLeaves());
    }
    if (leaf) {
      if (leaf.isDeferred && typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
      return leaf;
    }
    // A known placeholder still rebuilding at the deadline is not proof of an
    // empty sidebar. Let the host finish; a later activation can reuse it.
    if (this.sidebarRestoringLeaves.size || this.unloaded) return null;
    leaf = this.getPreferredSidebarLeaf();
    if (leaf) await leaf.setViewState({ type: VIEW_TYPE_RECENT_NOTES_FEED, active: false });
    return leaf;
  }

  async refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RECENT_NOTES_FEED);
    for (const leaf of leaves) {
      if (leaf.view && typeof leaf.view.refresh === "function") {
        await leaf.view.refresh();
      }
    }
  }

  onVaultChanged(file) {
    if (file instanceof TFile && !isSupportedRecentFile(file, this.settings)) {
      if (/^(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(file.extension)) this.scheduleRefresh();
      return;
    }
    this.invalidateFileCache(file);
    this.scheduleRefresh();
  }

  isMarkdownLeaf(leaf) {
    if (!leaf || !leaf.view || typeof leaf.view.getViewType !== "function") return false;
    const viewType = leaf.view.getViewType();
    return viewType === "markdown" || viewType === "canvas";
  }

  getRootLeaves() {
    const leaves = [];
    if (typeof this.app.workspace.iterateRootLeaves === "function") {
      try {
        // A truthy return stops Obsidian's traversal; never return Array.push's length.
        this.app.workspace.iterateRootLeaves((leaf) => {
          leaves.push(leaf);
        });
      } catch (error) {}
    }
    return leaves;
  }

  isMainWorkspaceLeaf(leaf) {
    if (!leaf) return false;
    const workspace = this.app.workspace;
    // ReNotes can also be restored in the editor area. Never open a note over it.
    try {
      if (leaf.view && typeof leaf.view.getViewType === "function"
        && leaf.view.getViewType() === VIEW_TYPE_RECENT_NOTES_FEED) return false;
    } catch (error) { return false; }
    try {
      if (typeof leaf.getRoot === "function") {
        const root = leaf.getRoot();
        // This is the primary check, including empty/new tabs. Floating windows
        // have a different root and are deliberately not reusable main editors.
        if (root && workspace.rootSplit) return root === workspace.rootSplit;
        if (root && (root === workspace.leftSplit || root === workspace.rightSplit)) return false;
      }
    } catch (error) {}
    // Older hosts or temporarily unavailable roots can fall back to enumeration.
    if (typeof workspace.iterateRootLeaves === "function") return this.getRootLeaves().includes(leaf);
    return true;
  }

  isMainMarkdownLeaf(leaf) {
    return this.isMarkdownLeaf(leaf) && this.isMainWorkspaceLeaf(leaf);
  }

  getCurrentOpenPath() {
    try {
      if (typeof this.app.workspace.getActiveFile === "function") {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path) return activeFile.path;
      }
    } catch (error) {}

    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf && activeLeaf.view && activeLeaf.view.file && activeLeaf.view.file.path) {
      return activeLeaf.view.file.path;
    }

    return "";
  }

  refreshActiveItemMarks() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RECENT_NOTES_FEED);
    for (const leaf of leaves) {
      if (leaf.view && typeof leaf.view.refreshActiveItemMarks === "function") {
        leaf.view.refreshActiveItemMarks();
      }
    }
  }

  getTargetLeaf(newTab) {
    const workspace = this.app.workspace;
    const activeLeaf = workspace.activeLeaf;
    let reusableLeaf = this.isMainWorkspaceLeaf(activeLeaf) ? activeLeaf : null;
    if (!reusableLeaf && typeof workspace.getMostRecentLeaf === "function") {
      try {
        const recentLeaf = workspace.getMostRecentLeaf();
        if (this.isMainWorkspaceLeaf(recentLeaf)) reusableLeaf = recentLeaf;
      } catch (error) {}
    }
    if (!reusableLeaf && this.isMainWorkspaceLeaf(this.lastMainLeaf)) reusableLeaf = this.lastMainLeaf;
    const rootLeaves = this.getRootLeaves();
    if (!reusableLeaf) {
      reusableLeaf = rootLeaves.find((leaf) => this.isMainWorkspaceLeaf(leaf))
        || [
          ...workspace.getLeavesOfType("markdown"),
          ...workspace.getLeavesOfType("canvas")
        ].find((leaf) => this.isMainWorkspaceLeaf(leaf));
    }
    if (reusableLeaf) this.lastMainLeaf = reusableLeaf;

    let pinned = !!(reusableLeaf && reusableLeaf.pinned);
    try {
      if (reusableLeaf && typeof reusableLeaf.getViewState === "function") {
        pinned = pinned || !!reusableLeaf.getViewState().pinned;
      }
    } catch (error) {}
    if (newTab || pinned) {
      // A sidebar click must not activate the old editor merely to place a new tab.
      if (reusableLeaf && activeLeaf !== reusableLeaf && typeof workspace.createLeafInParent === "function") {
        const parent = reusableLeaf.parent;
        const index = parent && Array.isArray(parent.children) ? parent.children.indexOf(reusableLeaf) : -1;
        if (index >= 0) {
          try {
            const leaf = workspace.createLeafInParent(parent, index + 1);
            if (leaf) return leaf;
          } catch (error) {}
        }
      }
      return workspace.getLeaf("tab");
    }

    if (reusableLeaf) return reusableLeaf;

    // Last-resort fallback for a freshly opened vault.
    return workspace.getLeaf(true);
  }

  getCacheMaxEntries() {
    const configured = Number(this.settings.cacheMaxEntries);
    if (!Number.isFinite(configured) || configured <= 0) return 1200;
    return Math.max(100, Math.min(configured, 10000));
  }

  getCacheMaxFileSizeBytes() {
    const configured = Number(this.settings.cacheMaxFileSizeBytes);
    if (!Number.isFinite(configured) || configured <= 0) return 2097152;
    return Math.max(64 * 1024, Math.min(configured, 50 * 1024 * 1024));
  }

  isCacheEnabled() {
    return this.settings.enableCache !== false;
  }

  isCacheableFile(file) {
    if (!this.isCacheEnabled()) return false;
    if (!(file instanceof TFile)) return false;
    if (!isSupportedRecentFile(file, this.settings)) return false;
    const size = getFileStatNumber(file, "size");
    return size <= this.getCacheMaxFileSizeBytes();
  }

  getValidCacheEntry(file) {
    if (!this.itemCache || !this.isCacheEnabled()) return null;
    const entry = this.itemCache.get(file.path);
    if (!entry) return null;
    if (entry.cacheVersion !== CACHE_FORMAT_VERSION) return null;
    if (entry.mtime !== getFileStatNumber(file, "mtime")) return null;
    if (entry.size !== getFileStatNumber(file, "size")) return null;
    if (entry.extension !== file.extension) return null;
    entry.lastAccessedAt = Date.now();
    return entry;
  }

  parseFileForCache(file, content) {
    const isCanvas = file.extension === "canvas";
    const canvasInfo = isCanvas ? parseCanvasContent(content, this.isCacheableFile(file)) : null;
    const markdownLines = isCanvas ? [] : stripMarkdownForSnippet(content, file.basename);
    const h1 = isCanvas ? "" : getFirstH1(content);
    const tags = isCanvas ? [] : collectTags(content);
    const imageLinks = isCanvas ? [] : getNoteImageLinks(content);
    const parsedAt = Date.now();

    return {
      cacheVersion: CACHE_FORMAT_VERSION,
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      mtime: getFileStatNumber(file, "mtime"),
      size: getFileStatNumber(file, "size"),
      folder: file.parent ? file.parent.path : "",
      h1,
      markdownLines,
      tags,
      imageLinks,
      imagePath: isCanvas ? "" : findNoteImagePath(this.app, file, content, imageLinks),
      canvasInfo,
      canvasSearchText: isCanvas ? getCanvasSearchText(canvasInfo) : "",
      contentHash: simpleContentHash(content),
      contentLength: String(content || "").length,
      parsedAt,
      lastAccessedAt: parsedAt
    };
  }

  setCacheEntry(file, entry, stats) {
    if (!this.itemCache || !this.isCacheableFile(file) || !entry) return;
    this.itemCache.set(file.path, entry);
    if (stats) stats.cacheWrites += 1;
    this.pruneItemCache();
  }

  invalidateFileCache(fileOrPath) {
    if (!this.itemCache || !fileOrPath) return false;
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    if (!path) return false;
    const existed = this.itemCache.delete(path);
    if (existed) this.cacheInvalidationCount = (this.cacheInvalidationCount || 0) + 1;
    return existed;
  }

  migrateCachePath(file, oldPath) {
    if (!this.itemCache || !oldPath || !(file instanceof TFile)) return;
    const entry = this.itemCache.get(oldPath);
    this.itemCache.delete(oldPath);
    if (entry) {
      if (entry.extension !== file.extension || entry.mtime !== getFileStatNumber(file, "mtime") || entry.size !== getFileStatNumber(file, "size")) return;
      entry.path = file.path;
      entry.basename = file.basename;
      entry.folder = file.parent ? file.parent.path : "";
      entry.extension = file.extension;
      entry.mtime = getFileStatNumber(file, "mtime");
      entry.size = getFileStatNumber(file, "size");
      this.itemCache.set(file.path, entry);
    }
  }

  clearItemCache(refresh = true) {
    const count = this.itemCache ? this.itemCache.size : 0;
    this.itemCache = new Map();
    this.cacheInvalidationCount = 0;
    if (refresh) this.refreshViews();
    return count;
  }

  pruneItemCache() {
    if (!this.itemCache || this.itemCache.size === 0) return;
    const maxEntries = this.getCacheMaxEntries();

    for (const [path, entry] of Array.from(this.itemCache.entries())) {
      if (!entry || entry.cacheVersion !== CACHE_FORMAT_VERSION) {
        this.itemCache.delete(path);
        continue;
      }
      if (Number(entry.size) > this.getCacheMaxFileSizeBytes()) {
        this.itemCache.delete(path);
      }
    }

    if (this.itemCache.size <= maxEntries) return;

    const entries = Array.from(this.itemCache.entries());
    entries.sort((a, b) => (Number(b[1].lastAccessedAt) || 0) - (Number(a[1].lastAccessedAt) || 0));
    const keep = new Set(entries.slice(0, maxEntries).map(([path]) => path));
    for (const path of this.itemCache.keys()) {
      if (!keep.has(path)) this.itemCache.delete(path);
    }
  }

  async getParsedFileEntry(file, stats) {
    if (!(file instanceof TFile)) return null;
    if (!isSupportedRecentFile(file, this.settings)) return null;

    stats.cacheLookups += 1;
    const cached = this.getValidCacheEntry(file);
    if (cached) {
      if (cached.effectiveFingerprint) this.observeEffectiveContent(file, "", cached.effectiveFingerprint);
      if (file.extension === "md") cached.imagePath = findNoteImagePath(this.app, file, "", cached.imageLinks || []);
      stats.cacheHits += 1;
      return cached;
    }

    stats.cacheMisses += 1;
    const path = file.path;
    const map = getActivityMap(this);
    const stamp = getFileReadStamp(file);
    const effectiveMap = this.effectiveRecords;

    let content = "";
    try {
      content = await this.app.vault.cachedRead(file);
      stats.readCount += 1;
    } catch (error) {
      stats.readErrors += 1;
      console.warn("ReNotes: failed to read", file.path, error);
      return null;
    }
    if (!this.isCurrentActivityFile(file, path, map, stamp) || this.effectiveRecords !== effectiveMap) return null;

    const parseStart = nowMs();
    const entry = this.parseFileForCache(file, content);
    const effective = this.observeEffectiveContent(file, content);
    entry.effectiveFingerprint = effective && effective.fp;
    stats.parseCount += 1;
    stats.parseDurationMs += Math.round(nowMs() - parseStart);

    if (this.settings.confirmContentChange !== false && !this.shouldSkipHashForSize(file)) {
      const activity = getFileActivity(this, file.path);
      const hasPendingLocalEdit = this.localEditTokens && this.localEditTokens.has(file.path);
      if (!hasPendingLocalEdit && activity.contentHash !== entry.contentHash) {
        this.storeContentHash(file, content, { contentHashSource: activity.contentHash ? "list-refresh" : "list-baseline" });
      }
    }

    this.setCacheEntry(file, entry, stats);
    return entry;
  }

  async copyDebugInfo() {
    const stats = this.lastBuildStats || {};
    const info = {
      version: this.manifest && this.manifest.version,
      settings: this.settings,
      stats,
      cacheSize: this.itemCache ? this.itemCache.size : 0,
      cacheInvalidationCount: this.cacheInvalidationCount || 0,
      activePath: this.getCurrentOpenPath(),
      recentViewCount: this.app.workspace.getLeavesOfType(VIEW_TYPE_RECENT_NOTES_FEED).length
    };
    const text = JSON.stringify(info, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      new Notice("已複製 Debug 資訊");
    } catch (error) {
      console.error("ReNotes: copy debug info failed", error);
      new Notice("複製 Debug 資訊失敗，請查看 Console");
    }
  }

  async copyObsidianLink(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);
    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到檔案：${path}`);
      await this.refreshViews();
      return;
    }

    let linkText = freshFile.path;
    try {
      if (this.app.metadataCache && typeof this.app.metadataCache.fileToLinktext === "function") {
        linkText = this.app.metadataCache.fileToLinktext(freshFile, "");
      }
    } catch (error) {}

    const link = `[[${linkText}]]`;
    try {
      await navigator.clipboard.writeText(link);
      new Notice("已複製 Obsidian 連結");
    } catch (error) {
      console.error("ReNotes: copy link failed", error);
      new Notice("複製連結失敗");
    }
  }

  showInFolder(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);
    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到檔案：${path}`);
      this.refreshViews();
      return;
    }

    try {
      if (typeof this.app.showInFolder === "function") {
        this.app.showInFolder(freshFile.path);
        return;
      }

      // Fallback for environments without showInFolder, mostly mobile or older Obsidian.
      this.app.workspace.trigger("reveal-in-navigation", freshFile);
      new Notice("已嘗試在 Obsidian 檔案列表中顯示");
    } catch (error) {
      console.error("ReNotes: show in folder failed", error);
      new Notice("無法在資料夾中顯示");
    }
  }

  isNativeDuplicateMenuTitle(title) {
    const normalized = String(title || "").trim().toLowerCase();
    const duplicateTitles = [
      // We provide these actions at the top of the menu to keep behavior consistent.
      "新視窗開啟",
      "開啟新視窗",
      "在新視窗中開啟",
      "在新窗口中打开",
      "新窗口打开",
      "open in new window",
      "open in new pane window",
      "重新命名",
      "重命名",
      "rename",
      "刪除",
      "删除",
      "delete",
      "移至垃圾桶",
      "移动到废纸篓",
      "move to trash",
      "在資料夾中顯示",
      "在文件夹中显示",
      "在系統檔案總管中顯示",
      "在系统文件夹中显示",
      "show in folder",
      "show in system explorer",
      "reveal in file explorer"
    ];
    return duplicateTitles.includes(normalized);
  }

  getMenuItemText(item) {
    if (!item) return "";
    for (const key of ["dom", "itemEl", "el"]) {
      const element = item[key];
      if (element && typeof element.textContent === "string") {
        const text = element.textContent.trim();
        if (text) return text;
      }
    }
    if (typeof item.title === "string") return item.title.trim();
    return "";
  }

  removeMenuItemDom(item) {
    if (!item) return;
    for (const key of ["dom", "itemEl", "el"]) {
      const element = item[key];
      if (element && typeof element.remove === "function") element.remove();
    }
  }

  triggerNativeFileMenuWithDedupedItems(menu, file) {
    const originalAddItem = menu.addItem ? menu.addItem.bind(menu) : null;
    const canEditItems = Array.isArray(menu.items);
    const nativeStartIndex = canEditItems ? menu.items.length : 0;

    if (!originalAddItem || !canEditItems) {
      this.app.workspace.trigger("file-menu", menu, file, "recent-notes-feed");
      return;
    }

    menu.addItem = (callback) => {
      const beforeLength = menu.items.length;
      let title = "";
      const result = originalAddItem((item) => {
        if (item && typeof item.setTitle === "function") {
          const originalSetTitle = item.setTitle.bind(item);
          item.setTitle = (value) => {
            title = String(value || "");
            return originalSetTitle(value);
          };
        }
        callback(item);
      });

      if (this.isNativeDuplicateMenuTitle(title) && menu.items.length > beforeLength) {
        const addedItems = menu.items.slice(beforeLength);
        for (const addedItem of addedItems) {
          this.removeMenuItemDom(addedItem);
        }
        menu.items.splice(beforeLength, menu.items.length - beforeLength);
      }

      return result;
    };

    try {
      this.app.workspace.trigger("file-menu", menu, file, "recent-notes-feed");
    } finally {
      menu.addItem = originalAddItem;
    }

    // Fallback cleanup: some Obsidian versions/plugins may set the title before the
    // hook can capture it. Scan only the native items appended after our custom items.
    for (let index = menu.items.length - 1; index >= nativeStartIndex; index -= 1) {
      const item = menu.items[index];
      const text = this.getMenuItemText(item);
      if (this.isNativeDuplicateMenuTitle(text)) {
        this.removeMenuItemDom(item);
        menu.items.splice(index, 1);
      }
    }
  }

  resolveCanvasLinkedFile(linkPath, sourcePath) {
    const raw = String(linkPath || "").trim();
    if (!raw) return null;

    const exact = this.app.vault.getAbstractFileByPath(raw);
    if (exact instanceof TFile) return exact;

    try {
      if (this.app.metadataCache && typeof this.app.metadataCache.getFirstLinkpathDest === "function") {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(raw.replace(/\.(md|canvas)$/i, ""), sourcePath || "");
        if (resolved instanceof TFile) return resolved;
      }
    } catch (error) {}

    return null;
  }

  async openCanvasLinkedFile(linkPath, sourcePath, newTab = false) {
    const resolved = this.resolveCanvasLinkedFile(linkPath, sourcePath);
    if (!(resolved instanceof TFile)) {
      new Notice(`找不到 Canvas 連結筆記：${basenameFromPath(linkPath)}`);
      return;
    }
    // Replacing an active Canvas leaf with Markdown may make Obsidian (or another
    // Canvas plugin) save the Canvas viewport during teardown. That save can
    // update its mtime and move the Canvas to the top of this recent-notes list.
    // Preserve a Canvas editor in place; other Markdown/empty leaves keep the
    // existing same-tab behavior. Ctrl/middle-click already requests a new tab.
    const reusable = !newTab ? this.getTargetLeaf(false) : null;
    let preservingCanvas = false;
    if (reusable && reusable.view) {
      try {
        preservingCanvas = reusable.view.getViewType?.() === "canvas"
          || reusable.view.file?.extension === "canvas";
      } catch (error) {}
    }
    await this.openFile(resolved.path, !!newTab || preservingCanvas);
  }

  async copyCanvasLinkedFiles(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);
    if (!(freshFile instanceof TFile) || freshFile.extension !== "canvas") {
      new Notice("這不是 Canvas 檔案");
      return;
    }

    try {
      const content = await this.app.vault.cachedRead(freshFile);
      const info = parseCanvasContent(content);
      const links = filterCanvasDocumentLinks(info.linkedFiles);
      if (links.length === 0) {
        new Notice("這個 Canvas 沒有連結筆記");
        return;
      }

      const lines = links.map((link) => {
        const resolved = this.resolveCanvasLinkedFile(link.path, freshFile.path);
        if (resolved instanceof TFile && this.app.metadataCache && typeof this.app.metadataCache.fileToLinktext === "function") {
          try {
            return `[[${this.app.metadataCache.fileToLinktext(resolved, freshFile.path)}]]`;
          } catch (error) {}
        }
        return `[[${link.path.replace(/\.md$/i, "")}]]`;
      });

      await navigator.clipboard.writeText(lines.join("\n"));
      new Notice(`已複製 ${lines.length} 個 Canvas 連結筆記`);
    } catch (error) {
      console.error("ReNotes: copy canvas links failed", error);
      new Notice("複製 Canvas 連結筆記失敗");
    }
  }

  showFileMenu(fileOrPath, mouseEvent) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);

    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到檔案：${path}`);
      this.refreshViews();
      return;
    }

    const menu = new Menu();
    if (["md", "canvas"].includes(freshFile.extension)) {
      const pinned = this.isPinned(freshFile.path);
      menu.addItem((item) => item
        .setTitle(pinned ? "取消釘選" : "釘選")
        .setIcon(pinned ? "pin-off" : "pin")
        .onClick(() => this.setPinned(freshFile.path, !pinned)));
    }

    menu.addItem((item) => item
      .setTitle("開啟")
      .setIcon("file")
      .onClick(() => this.openFile(freshFile.path, false)));

    menu.addItem((item) => item
      .setTitle("開新分頁")
      .setIcon("lucide-plus-square")
      .onClick(() => this.openFile(freshFile.path, true)));

    menu.addItem((item) => item
      .setTitle("在新視窗中開啟")
      .setIcon("panel-top-open")
      .onClick(() => this.openFileInNewWindow(freshFile.path)));

    menu.addItem((item) => item
      .setTitle("重新命名")
      .setIcon("pencil")
      .onClick(() => this.renameFileWithPrompt(freshFile.path)));

    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle("在資料夾中顯示")
      .setIcon("folder-open")
      .onClick(() => this.showInFolder(freshFile.path)));

    menu.addItem((item) => item
      .setTitle("複製 Obsidian 連結")
      .setIcon("link")
      .onClick(() => this.copyObsidianLink(freshFile.path)));

    if (freshFile.extension === "canvas") {
      menu.addItem((item) => item
        .setTitle("複製 Canvas 連結筆記清單")
        .setIcon("list")
        .onClick(() => this.copyCanvasLinkedFiles(freshFile.path)));
    }

    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle("刪除")
      .setIcon("trash")
      .onClick(() => this.deleteFileWithConfirm(freshFile.path)));

    menu.addSeparator();

    // Keep Obsidian/plugin-native file-menu items below our required actions,
    // but remove native duplicates of actions that this menu already provides.
    this.triggerNativeFileMenuWithDedupedItems(menu, freshFile);
    if (mouseEvent && typeof mouseEvent.preventDefault === "function" && typeof menu.showAtMouseEvent === "function") {
      menu.showAtMouseEvent(mouseEvent);
    } else if (mouseEvent && typeof mouseEvent.x === "number" && typeof mouseEvent.y === "number" && typeof menu.showAtPosition === "function") {
      menu.showAtPosition({ x: mouseEvent.x, y: mouseEvent.y });
    } else if (typeof menu.showAtPosition === "function") {
      menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    } else {
      new Notice("無法顯示選單");
    }
  }

  async openFileInLeaf(leaf, file) {
    if (!leaf) throw new Error("No workspace leaf available.");

    // Canvas must be opened explicitly as the Canvas view. Reusing a Markdown leaf with
    // leaf.openFile() can make some Obsidian versions treat the .canvas path like a
    // blank Markdown note, which changes the file mtime. setViewState avoids that write.
    if (file.extension === "canvas") {
      await leaf.setViewState({
        type: "canvas",
        state: { file: file.path },
        active: false
      }, { focus: false });
      return;
    }

    await leaf.openFile(file, { active: false });
  }

  enqueueFileOpen(open) {
    // Preserve click order even when an earlier file takes longer to load.
    const run = () => this.unloaded ? undefined : open();
    const pending = (this.fileOpenQueue || Promise.resolve()).then(run, run);
    this.fileOpenQueue = pending;
    return pending;
  }

  openFile(fileOrPath, newTab) {
    return this.enqueueFileOpen(() => this.openFileNow(fileOrPath, newTab));
  }

  async openFileNow(fileOrPath, newTab) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);

    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到筆記：${path}`);
      await this.refreshViews();
      return;
    }

    try {
      const leaf = this.getTargetLeaf(newTab);
      await this.openFileInLeaf(leaf, freshFile);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      this.lastMainLeaf = leaf;
      this.markFileOpened(freshFile);
      this.refreshActiveItemMarks();
    } catch (error) {
      console.error("ReNotes: open file failed", error);
      new Notice(`開啟失敗：${freshFile.basename}`);
    }
  }

  openFileInNewWindow(fileOrPath) {
    return this.enqueueFileOpen(() => this.openFileInNewWindowNow(fileOrPath));
  }

  async openFileInNewWindowNow(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);

    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到筆記：${path}`);
      await this.refreshViews();
      return;
    }

    try {
      const leaf = this.app.workspace.getLeaf("window");
      await this.openFileInLeaf(leaf, freshFile);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      // A floating window must not erase the last main editor, which is also the
      // fallback when getMostRecentLeaf is unavailable on an older host.
      if (this.isMainWorkspaceLeaf(leaf)) this.lastMainLeaf = leaf;
      this.markFileOpened(freshFile);
    } catch (error) {
      console.error("ReNotes: open in new window failed", error);
      new Notice("無法開啟新視窗，已改用新分頁開啟");
      // Already inside the shared queue; do not enqueue behind this request itself.
      await this.openFileNow(freshFile.path, true);
    }
  }

  async renameFileWithPrompt(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);

    if (!(freshFile instanceof TFile)) {
      new Notice(`找不到檔案：${path}`);
      await this.refreshViews();
      return;
    }

    const modal = new RenameFileModal(this.app, freshFile, async (newFileName) => {
      let targetName = String(newFileName || "").trim();
      if (!targetName) {
        new Notice("檔名不可空白");
        return false;
      }

      if (/[\\/]/.test(targetName)) {
        new Notice("重新命名只支援改檔名，不支援移動資料夾");
        return false;
      }

      const currentExtension = freshFile.extension ? `.${freshFile.extension}` : "";
      if (currentExtension && !targetName.toLowerCase().endsWith(currentExtension.toLowerCase())) {
        targetName += currentExtension;
      }

      if (targetName === freshFile.name) return true;

      const parentPath = freshFile.parent && freshFile.parent.path && freshFile.parent.path !== "/"
        ? freshFile.parent.path
        : "";
      const newPath = parentPath ? `${parentPath}/${targetName}` : targetName;

      if (this.app.vault.getAbstractFileByPath(newPath)) {
        new Notice(`已存在同名檔案：${targetName}`);
        return false;
      }

      try {
        if (this.app.fileManager && typeof this.app.fileManager.renameFile === "function") {
          await this.app.fileManager.renameFile(freshFile, newPath);
        } else {
          await this.app.vault.rename(freshFile, newPath);
        }

        this.migrateActivityPath(freshFile, path);

        new Notice(`已重新命名為：${basenameFromPath(newPath)}`);
        await this.refreshViews();
        return true;
      } catch (error) {
        console.error("ReNotes: rename failed", error);
        new Notice(`重新命名失敗：${freshFile.basename}`);
        return false;
      }
    });

    modal.open();
  }

  async deleteFileWithConfirm(fileOrPath) {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const freshFile = this.app.vault.getAbstractFileByPath(path);
    if (!(freshFile instanceof TFile)) {
      new Notice("找不到檔案：" + path);
      await this.refreshViews();
      return;
    }

    const modal = new ReNotesDeleteModal(this.app, freshFile, async () => {
      // Guard against deleting another note if this path changed while the dialog was open.
      const currentFile = this.app.vault.getAbstractFileByPath(path);
      if (!(currentFile instanceof TFile) || currentFile !== freshFile || currentFile.path !== path) {
        return { ok: false, error: "檔案已移動或不存在，請關閉視窗後重新整理列表。" };
      }
      try {
        if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") {
          await this.app.fileManager.trashFile(currentFile);
        } else if (typeof this.app.vault.trash === "function") {
          await this.app.vault.trash(currentFile, true);
        } else {
          throw new Error("No supported trash API found.");
        }
      } catch (error) {
        console.error("ReNotes: delete failed", error);
        new Notice("刪除失敗：" + freshFile.basename);
        return { ok: false, error: "無法刪除這個檔案，請確認權限或檢查 Obsidian 記錄。" };
      }
      new Notice("已刪除：" + freshFile.basename);
      try {
        await this.refreshViews();
      } catch (error) {
        console.warn("ReNotes: file deleted but view refresh failed", error);
      }
      return { ok: true };
    });
    modal.open();
  }
  shouldIncludeFile(file, settings = this.settings) {
    if (!isSupportedRecentFile(file, settings)) return false;

    const includedFolders = normalizeList(settings.includedFolders);
    if (includedFolders.length > 0 && !includedFolders.some((folder) => fileIsInFolder(file, folder))) {
      return false;
    }

    const excludedFolders = normalizeList(settings.excludedFolders);
    if (excludedFolders.some((folder) => fileIsInFolder(file, folder))) {
      return false;
    }

    return true;
  }

  async buildRecentNotes(settings = this.settings) {
    const startedAt = nowMs();
    const maxNotes = Math.max(1, Number(this.settings.maxNotes) || DEFAULT_SETTINGS.maxNotes);
    const snippetLines = getEffectiveSnippetLines(this.settings);
    const excludedTags = normalizeList(settings.excludedTags).map((tag) => tag.startsWith("#") ? tag : "#" + tag);

    const allFiles = this.app.vault.getFiles();
    const allRecentFiles = allFiles.filter((file) => isSupportedRecentFile(file, this.settings));
    const existingPaths = new Set(allFiles.map((file) => file.path));
    const prunedActivity = pruneActivity(this, existingPaths);
    if (prunedActivity) this.saveActivityDebounced();

    if (this.itemCache) {
      for (const path of Array.from(this.itemCache.keys())) {
        if (!existingPaths.has(path)) this.itemCache.delete(path);
      }
    }

    const folderFilteredFiles = allRecentFiles.filter((file) => this.shouldIncludeFile(file, settings));
    const filesWithSortInfo = folderFilteredFiles
      .map((file) => {
        const sortInfo = computeSortInfo(file, settings, this);
        const record = this.effectiveRecords[file.path];
        // 僅以 mtime 決定尚待確認的讀取候選；顯示前重新以有效時間排序。
        if (settings.sortMode === "effective" && record
          && (record.m !== getFileStatNumber(file, "mtime") || record.s !== getFileStatNumber(file, "size"))) {
          sortInfo.timestamp = getFileStatNumber(file, "mtime");
        }
        return { file, sortInfo };
      })
      .sort((a, b) => {
        const priorityDiff = (b.sortInfo.priority || 0) - (a.sortInfo.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        const diff = b.sortInfo.timestamp - a.sortInfo.timestamp;
        if (diff !== 0) return diff;
        return String(a.file.path).localeCompare(String(b.file.path));
      });

    const recentCandidates = new Set(filesWithSortInfo.filter((candidate) => !this.isPinned(candidate.file.path)).slice(0, maxNotes * 3).map((candidate) => candidate.file.path));
    const files = filesWithSortInfo.filter((candidate) => recentCandidates.has(candidate.file.path) || this.isPinned(candidate.file.path));

    const stats = {
      totalFiles: allRecentFiles.length,
      totalMarkdown: allRecentFiles.filter((file) => file.extension === "md").length,
      totalCanvas: allRecentFiles.filter((file) => file.extension === "canvas").length,
      afterFolderFilter: folderFilteredFiles.length,
      readCount: 0,
      skippedByTags: 0,
      readErrors: 0,
      sortMode: settings.sortMode || "mtime",
      activityCount: Object.keys(getActivityMap(this)).length,
      confirmContentChange: this.settings.confirmContentChange !== false,
      hashDebounceMs: this.getEffectiveHashDebounceMs(),
      maxHashFileSizeBytes: this.getMaxHashFileSizeBytes(),
      cacheEnabled: this.isCacheEnabled(),
      cacheSize: this.itemCache ? this.itemCache.size : 0,
      cacheLookups: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheWrites: 0,
      cacheInvalidations: this.cacheInvalidationCount || 0,
      cacheMaxEntries: this.getCacheMaxEntries(),
      cacheMaxFileSizeBytes: this.getCacheMaxFileSizeBytes(),
      parseCount: 0,
      parseDurationMs: 0,
      canvasParsed: 0,
      canvasInvalid: 0,
      canvasLinkedFileCount: 0,
      progressiveRender: this.settings.progressiveRender !== false,
      renderBatchSize: Math.max(5, Math.min(Number(this.settings.renderBatchSize) || 30, 100)),
      buildDurationMs: 0
    };
    const items = [];
    let regularCount = 0;

    for (const candidate of files) {
      const pinned = this.isPinned(candidate.file.path);
      // 有效時間確認後候選可能退回舊排名；可重用範圍內其他摘要快取補上較新卡片，
      // 仍維持既有讀取額度，不為補項目額外讀檔。
      if (!pinned && regularCount >= maxNotes
        && (settings.sortMode !== "effective" || !this.getValidCacheEntry(candidate.file))) continue;
      const file = candidate.file;
      const entry = await this.getParsedFileEntry(file, stats);
      if (!entry) continue;
      const sortInfo = computeSortInfo(file, settings, this);

      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      if (file.extension === "md" && excludedTags.length > 0) {
        if (tags.some((tag) => excludedTags.includes(tag))) {
          stats.skippedByTags += 1;
          continue;
        }
      }

      const isCanvas = file.extension === "canvas";
      const canvasInfo = isCanvas ? entry.canvasInfo : null;
      if (isCanvas && canvasInfo) {
        stats.canvasParsed += 1;
        if (canvasInfo.invalid) stats.canvasInvalid += 1;
        stats.canvasLinkedFileCount += filterCanvasDocumentLinks(canvasInfo.linkedFiles).length;
      }

      const h1 = entry.h1 || "";
      let title = file.basename;
      if (!isCanvas && this.settings.titleSource === "h1") title = h1 || file.basename;
      if (!isCanvas && this.settings.titleSource === "auto") title = h1 || file.basename;

      const snippetLinesArray = isCanvas
        ? getCanvasPreviewLinesFromInfo(canvasInfo, this.settings)
        : (Array.isArray(entry.markdownLines) ? entry.markdownLines : []);
      const snippet = snippetLinesArray.length > 0
        ? truncate(snippetLinesArray.slice(0, snippetLines).join(" "), isCanvas ? 220 : 160)
        : (isCanvas ? "Canvas 白板" : this.settings.emptySnippetText);

      if (!pinned) regularCount += 1;
      items.push({
        file,
        path: file.path,
        title,
        snippet,
        imagePath: entry.imagePath || "",
        hasSnippetContent: snippetLinesArray.length > 0,
        folder: file.parent ? file.parent.path : "",
        tags,
        mtime: sortInfo.timestamp,
        fileMtime: sortInfo.fileMtime || file.stat.mtime,
        lastOpened: sortInfo.opened || 0,
        lastLocalEdit: sortInfo.localEdit || 0,
        sortReason: sortInfo.reason || "檔案修改",
        type: isCanvas ? "canvas" : "markdown",
        canvas: canvasInfo ? {
          nodeCount: canvasInfo.nodeCount,
          fileNodes: canvasInfo.fileNodes,
          statsText: formatCanvasStatsText(canvasInfo),
          linkedFiles: filterCanvasDocumentLinks(canvasInfo.linkedFiles),
          groupLabels: canvasInfo.groupLabels,
          urlCount: canvasInfo.urls.length,
          invalid: canvasInfo.invalid,
          thumbnailNodes: canvasInfo.thumbnailNodes
        } : null,
        canvasSearchText: isCanvas ? getCanvasSearchText(canvasInfo) : ""
      });
    }

    if (settings.sortMode === "effective") {
      items.sort((a, b) => b.mtime - a.mtime || String(a.path).localeCompare(String(b.path)));
      let count = 0;
      for (let index = 0; index < items.length;) {
        if (!this.isPinned(items[index].path) && ++count > maxNotes) items.splice(index, 1);
        else index += 1;
      }
    }
    this.pruneItemCache();
    stats.cacheSize = this.itemCache ? this.itemCache.size : 0;
    stats.buildDurationMs = Math.round(nowMs() - startedAt);
    this.lastBuildStats = stats;
    return items;
  }

};

module.exports.__test = {
  EFFECTIVE_STORAGE_KEY, RENOTES_ICON, contentFingerprint, stableSerialize, normalizeEffectiveRecords, pruneEffectiveRecords, getEffectiveTime,
  DEFAULT_SETTINGS, ACTIVITY_STORAGE_KEY, RecentNotesFeedView, RecentNotesFeedSettingTab, ReNotesDeleteModal, getSortDeviceHint,
  mergeActivity, formatRelativeTime, getSecondLine, simpleContentHash, pruneActivity, computeSortInfo,
   getDateGroup, formatDateGroup, formatNoteTime, getRecentLocalDayKey, formatRecentDateLabel, getRecentDateIndex, truncateRecentCanvasLink, getWidthClass, scaleCanvasNodes, parseCanvasContent, normalizePinnedPaths,
   getLayoutDensity, getEffectiveSnippetLines, normalizeImageLink, findNoteImagePath, getImageFile
};
