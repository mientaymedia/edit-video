import { z } from "zod";

/**
 * Timeline cho video chữ động hai page Amway — do `scripts/amway/build.mjs`
 * sinh ra sau khi TTS đọc xong (file `out/<id>/timeline.json`).
 *
 * Điểm quan trọng: `start`/`end` của mỗi đoạn ĐƯỢC ĐO TỪ ĐỘ DÀI AUDIO THẬT,
 * không phải đặt tay. Nên composition này chỉ việc đọc mốc, không tự chia
 * thời gian — sửa lời đọc thì mốc tự đổi theo, chữ vẫn khớp giọng.
 */

/** Một dòng chữ: [nội dung, lớp cỡ chữ]. `hl` = tô màu nhấn. */
export const lineSchema = z.tuple([z.string(), z.string()]);

export const segmentSchema = z.object({
  /** Lời đọc — giữ lại để đối chiếu, composition không hiển thị trường này. */
  say: z.string().default(""),
  start: z.number(),
  end: z.number(),
  kicker: z.string().optional(),
  /** Số lớn mờ phía sau — chỉ dùng khi nội dung thật sự là danh sách có thứ tự. */
  num: z.string().optional(),
  lines: z.array(lineSchema).default([]),
  sub: z.string().optional(),
  box: z.string().optional(),
  gap: z.number().optional(),
});

export const amwayTimelineSchema = z.object({
  /** a = kênh sản phẩm (xanh lá), b = kênh kinh doanh (xanh mực). */
  theme: z.enum(["a", "b"]).default("a"),
  /** Handle đóng góc trái trên, hiện suốt video. */
  watermark: z.string().default(""),
  /** Tên chuyên mục, hiện ở chân trang. */
  brandLabel: z.string().default(""),
  /** Khuyến cáo bắt buộc khi video nhắc sản phẩm; chuỗi rỗng = không hiện. */
  disclaimer: z.string().default(""),
  duration: z.number(),
  segments: z.array(segmentSchema),
  /**
   * Đường dẫn giọng đọc TƯƠNG ĐỐI so với `public/` của engine.
   * `jobs/assemble.ts` stage file vào `public/staging/`, nên giá trị thường là
   * "staging/amway-A-01.wav". null = render câm (xem trước bố cục).
   */
  audioSrc: z.string().nullable().default(null),
});

export type AmwayTimeline = z.infer<typeof amwayTimelineSchema>;
export type AmwaySegment = z.infer<typeof segmentSchema>;

export const FPS = 30;

/** Tổng số khung — lấy từ `duration` đã tính sẵn, làm tròn lên cho khỏi cụt đuôi. */
export const totalFrames = (t: AmwayTimeline) => Math.ceil(t.duration * FPS);

/** Bảng màu theo kênh. Chỉ hai giá trị, khai ở một chỗ để không lệch nhau. */
export const THEMES = {
  a: {
    accent: "#57c98a",
    accentDim: "rgba(87,201,138,.10)",
    accentBg: "rgba(87,201,138,.09)",
    background:
      "radial-gradient(900px 700px at 50% 18%, rgba(87,201,138,.16), transparent 70%)," +
      "radial-gradient(700px 600px at 78% 88%, rgba(31,78,107,.20), transparent 72%)," +
      "linear-gradient(175deg,#0d1714 0%,#0a1210 55%,#0b1512 100%)",
  },
  b: {
    accent: "#67aed6",
    accentDim: "rgba(103,174,214,.10)",
    accentBg: "rgba(103,174,214,.09)",
    background:
      "radial-gradient(900px 700px at 50% 18%, rgba(96,165,214,.16), transparent 70%)," +
      "radial-gradient(700px 600px at 78% 88%, rgba(30,60,80,.24), transparent 72%)," +
      "linear-gradient(175deg,#0c1620 0%,#091119 55%,#0a141c 100%)",
  },
} as const;

/** Cỡ chữ theo lớp, khớp với `scene.html` để hai đường dựng ra cùng một hình. */
export const LINE_SIZES: Record<string, number> = {
  "l-xl": 104,
  "l-lg": 88,
  "l-md": 74,
  "l-sm": 62,
};
