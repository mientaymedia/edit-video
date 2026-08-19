import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { ensureDir, nowIso } from "./util.js";

/**
 * Style Design - nhiều bộ nhận diện (thay thế Design System cũ).
 * Nguồn sự thật: assets/styles/styles.json = { defaultId, styles: StyleDesign[] }.
 * Migration tự động: lần đọc đầu nếu styles.json chưa có mà assets/brand/design-system.json
 * có → chuyển thành style id "noti-vn" (tags ["brand"]) và làm default.
 * Xem docs/API.md mục "Style Design".
 */

export interface StyleDesign {
  id: string;
  name: string;
  tags: string[];
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent: string;
  };
  fonts: { heading: string; body: string };
  /** File font của style (tính từ repo root, vd "assets/styles/files/x.woff2") - Poster nạp để chữ đúng font */
  fontFiles: { heading: string | null; body: string | null };
  /** Hiệu ứng thẩm mỹ của style - áp vào cả prompt Gemini lẫn Poster Remotion */
  effects: { gradient: boolean; liquidGlass: boolean };
  /** Đường dẫn logo tính từ repo root (vd "assets/styles/files/logo.png") - null = chưa có */
  logoPath: string | null;
  tone: string;
  guidelines: string;
  createdAt: string;
  updatedAt: string;
}

export interface StylesFile {
  defaultId: string | null;
  styles: StyleDesign[];
}

export const COLOR_KEYS = ["primary", "secondary", "background", "text", "accent"] as const;
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Chuẩn hóa hex: lowercase + nở 3 ký tự thành 6 (web chỉ render dạng 6 ký tự);
 * 8 ký tự (có alpha) giữ nguyên. Input phải đã qua HEX_RE.
 */
export function normHexColor(hex: string): string {
  const v = hex.toLowerCase();
  if (v.length === 4) {
    return "#" + v.slice(1).split("").map((ch) => ch + ch).join("");
  }
  return v;
}

const stylesFilePath = () => path.join(paths.stylesDir, "styles.json");
const legacyFilePath = () => path.join(paths.brandDir, "design-system.json");

export const BUILTIN_STYLE_SEEDS: Omit<StyleDesign, "createdAt" | "updatedAt">[] = [
  {
    id: "default",
    name: "Mặc định (Modern Red)",
    tags: ["brand", "general"],
    colors: {
      primary: "#ed3c47",
      secondary: "#ff7849",
      background: "#101113",
      text: "#ffffff",
      accent: "#37bdf8",
    },
    fonts: { heading: "Inter", body: "Inter" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Chuyên nghiệp, hiện đại, năng động.",
    guidelines: "Sử dụng tông màu đỏ cam làm điểm nhấn chính trên nền tối, chữ trắng tương phản sắc nét.",
  },
  {
    id: "cinematic-luxury",
    name: "Điện ảnh Sang trọng (Dark Gold Luxury)",
    tags: ["luxury", "finance", "premium"],
    colors: {
      primary: "#d4af37",
      secondary: "#f3e5ab",
      background: "#0b0c10",
      text: "#f8fafc",
      accent: "#e5a93c",
    },
    fonts: { heading: "Cinzel", body: "Montserrat" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Đẳng cấp, quyền lực, tinh tế, đắt giá.",
    guidelines: "Ánh sáng vàng kim loại và hổ phách nổi bật trên nền đen huyền bí; bố cục tinh giản, sang trọng.",
  },
  {
    id: "cyber-futuristic",
    name: "Công nghệ Tương lai (Cyberpunk Neon)",
    tags: ["tech", "ai", "crypto", "future"],
    colors: {
      primary: "#00f0ff",
      secondary: "#7000ff",
      background: "#070913",
      text: "#ffffff",
      accent: "#ff0055",
    },
    fonts: { heading: "Space Grotesk", body: "JetBrains Mono" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Tiên phong, sắc bén, tốc độ, công nghệ cao.",
    guidelines: "Sử dụng viền phát sáng Cyan/Violet, hiệu ứng kính mờ công nghệ cao trên nền không gian sâu thẳm.",
  },
  {
    id: "nature-organic",
    name: "Tự nhiên Xanh (Botanical Emerald)",
    tags: ["nature", "health", "eco", "wellness"],
    colors: {
      primary: "#10b981",
      secondary: "#34d399",
      background: "#061c14",
      text: "#f0fdf4",
      accent: "#fbbf24",
    },
    fonts: { heading: "Plus Jakarta Sans", body: "Inter" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Tươi mới, chữa lành, tự nhiên, sinh thái, an lành.",
    guidelines: "Tông màu xanh ngọc lục bảo kết hợp ánh vàng dịu ngọt trên nền xanh rừng sâu, cảm giác thư thái và thuần khiết.",
  },
  {
    id: "vibrant-creator",
    name: "Sáng tạo Bùng nổ (Electric Sunset)",
    tags: ["social", "entertainment", "tiktok", "vibrant"],
    colors: {
      primary: "#ff3366",
      secondary: "#ff9900",
      background: "#120e16",
      text: "#ffffff",
      accent: "#00e5ff",
    },
    fonts: { heading: "Outfit", body: "Inter" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Năng động, nhiệt huyết, lôi cuốn, đậm chất sáng tạo.",
    guidelines: "Gradient hoàng hôn rực rỡ kết hợp chi tiết điểm nhấn Aqua nổi bật, tối ưu thị giác cho video ngắn viral.",
  },
  {
    id: "minimal-nordic",
    name: "Tối giản Bắc Âu (Slate Minimalist)",
    tags: ["minimal", "editorial", "clean", "news"],
    colors: {
      primary: "#38bdf8",
      secondary: "#94a3b8",
      background: "#0f172a",
      text: "#f1f5f9",
      accent: "#3b82f6",
    },
    fonts: { heading: "Inter", body: "Inter" },
    fontFiles: { heading: null, body: null },
    effects: { gradient: true, liquidGlass: true },
    logoPath: null,
    tone: "Khúc chiết, thanh lịch, trang nhã, chuyên nghiệp chuẩn quốc tế.",
    guidelines: "Bố cục căn lưới chặt chẽ, khoảng thở rộng rãi, sắc xanh đá bảng thanh lịch và độ tương phản cao.",
  },
];

/**
 * Style khởi điểm - dùng làm template cho style mới và làm fallback khi chưa
 * có style nào trên đĩa.
 */
export function defaultStyle(): StyleDesign {
  const now = nowIso();
  const seed = BUILTIN_STYLE_SEEDS[0];
  return {
    ...seed,
    createdAt: now,
    updatedAt: now,
  };
}

/** Chuẩn hóa tags: string, trim, bỏ rỗng, dedupe */
export function normStyleTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)),
  ];
}

/**
 * Chuẩn hóa một style đọc từ đĩa về đúng shape (dữ liệu đĩa không tin kiểu).
 * Thiếu id/name hợp lệ → null (bỏ khỏi danh sách).
 */
function normStyle(raw: unknown): StyleDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id.trim()) return null;
  const base = defaultStyle();
  base.id = s.id.trim();
  base.name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : base.id;
  base.tags = normStyleTags(s.tags);
  if (s.colors && typeof s.colors === "object" && !Array.isArray(s.colors)) {
    const c = s.colors as Record<string, unknown>;
    for (const key of COLOR_KEYS) {
      if (typeof c[key] === "string" && HEX_RE.test(c[key] as string)) {
        base.colors[key] = normHexColor(c[key] as string);
      }
    }
  }
  if (s.fonts && typeof s.fonts === "object" && !Array.isArray(s.fonts)) {
    const f = s.fonts as Record<string, unknown>;
    if (typeof f.heading === "string" && f.heading.trim()) base.fonts.heading = f.heading.trim();
    if (typeof f.body === "string" && f.body.trim()) base.fonts.body = f.body.trim();
  }
  if (s.fontFiles && typeof s.fontFiles === "object" && !Array.isArray(s.fontFiles)) {
    const ff = s.fontFiles as Record<string, unknown>;
    if (typeof ff.heading === "string" && ff.heading) base.fontFiles.heading = ff.heading;
    if (typeof ff.body === "string" && ff.body) base.fontFiles.body = ff.body;
  }
  if (s.effects && typeof s.effects === "object" && !Array.isArray(s.effects)) {
    const e = s.effects as Record<string, unknown>;
    if (typeof e.gradient === "boolean") base.effects.gradient = e.gradient;
    if (typeof e.liquidGlass === "boolean") base.effects.liquidGlass = e.liquidGlass;
  }
  if (typeof s.logoPath === "string" && s.logoPath) base.logoPath = s.logoPath;
  if (typeof s.tone === "string") base.tone = s.tone;
  if (typeof s.guidelines === "string") base.guidelines = s.guidelines;
  if (typeof s.createdAt === "string" && s.createdAt) base.createdAt = s.createdAt;
  if (typeof s.updatedAt === "string" && s.updatedAt) base.updatedAt = s.updatedAt;
  return base;
}

/**
 * Migration: assets/brand/design-system.json (shape DesignSystem cũ có brandName)
 * → style id "noti-vn", name = brandName, tags ["brand"], làm default. File cũ giữ nguyên.
 */
function migrateFromLegacy(): StylesFile | null {
  const legacy = legacyFilePath();
  if (!fs.existsSync(legacy)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(legacy, "utf8"));
  } catch {
    return null; // file cũ hỏng → coi như không có gì để migrate
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const style = normStyle({ ...d, id: "noti-vn", name: d.brandName }) ?? defaultStyle();
  style.tags = ["brand"];
  const now = nowIso();
  style.createdAt = now;
  style.updatedAt = now;
  const data: StylesFile = { defaultId: style.id, styles: [style] };
  writeStyles(data);
  return data;
}

/** Đọc styles.json (migration lần đầu nếu cần) - file thiếu/hỏng đọc phòng thủ */
export function readStyles(): StylesFile {
  const file = stylesFilePath();
  if (!fs.existsSync(file)) {
    const migrated = migrateFromLegacy();
    if (migrated) return migrated;
    const now = nowIso();
    const seededStyles: StyleDesign[] = BUILTIN_STYLE_SEEDS.map((s) => ({
      ...s,
      createdAt: now,
      updatedAt: now,
    }));
    const initialData: StylesFile = { defaultId: seededStyles[0]?.id ?? null, styles: seededStyles };
    writeStyles(initialData);
    return initialData;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { defaultId: null, styles: [] };
    }
    const r = raw as Record<string, unknown>;
    const styles: StyleDesign[] = [];
    const seen = new Set<string>();
    if (Array.isArray(r.styles)) {
      for (const item of r.styles) {
        const s = normStyle(item);
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          styles.push(s);
        }
      }
    }
    let defaultId =
      typeof r.defaultId === "string" && styles.some((s) => s.id === r.defaultId)
        ? r.defaultId
        : null;
    if (!defaultId && styles.length > 0) defaultId = styles[0].id;
    return { defaultId, styles };
  } catch {
    return { defaultId: null, styles: [] };
  }
}

export function writeStyles(data: StylesFile): void {
  ensureDir(paths.stylesDir);
  fs.writeFileSync(stylesFilePath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function styleExists(id: string): boolean {
  return readStyles().styles.some((s) => s.id === id);
}

/**
 * Lấy style theo id, không có/không tìm thấy → style default.
 * Chưa có style nào → style mặc định noti.vn on-the-fly (không ghi đĩa).
 */
export function getStyle(id?: string | null): StyleDesign {
  const data = readStyles();
  if (id) {
    const found = data.styles.find((s) => s.id === id);
    if (found) return found;
  }
  if (data.defaultId) {
    const def = data.styles.find((s) => s.id === data.defaultId);
    if (def) return def;
  }
  if (data.styles.length > 0) return data.styles[0];
  return defaultStyle();
}
