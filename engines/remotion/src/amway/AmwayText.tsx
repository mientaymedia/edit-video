import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import {
  VIETNAMESE_FONT_FAMILY,
  vietnameseFontFaceCss,
} from "../components/vietnameseFont";
import {
  FPS,
  LINE_SIZES,
  THEMES,
  type AmwaySegment,
  type AmwayTimeline,
} from "./timeline";

/**
 * Video chữ động cho hai page Amway.
 *
 * Không tự chia thời gian: mọi mốc lấy từ `segments[].start/end`, mà những mốc
 * đó do build.mjs đo từ độ dài audio thật. Đổi lời đọc → mốc đổi → chữ vẫn khớp
 * giọng, không phải căn lại tay.
 *
 * Font dùng lại Inter subset tiếng Việt đã có trong `public/fonts` (khai
 * unicode-range thủ công, xem vietnameseFont.ts) — không thêm asset mới.
 */

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Hiện dần + trượt lên. `delay`/`dur` tính bằng giây kể từ đầu đoạn. */
const rise = (local: number, delay: number, dur: number, dy: number) => {
  const e = easeOut(clamp01((local - delay) / dur));
  return { opacity: e, transform: `translateY(${((1 - e) * dy).toFixed(2)}px)` };
};

const Segment: React.FC<{
  seg: AmwaySegment;
  t: number;
  accent: string;
  accentDim: string;
  accentBg: string;
}> = ({ seg, t, accent, accentDim, accentBg }) => {
  const local = t - seg.start;

  // Vào 0,45s, ra 0,35s — cùng con số với scene.html để hai đường dựng khớp nhau
  const enter = easeInOut(clamp01((local + 0.35) / 0.45));
  const exit = easeInOut(clamp01((seg.end - t) / 0.35));

  // Các dòng hiện lần lượt; đoạn ngắn thì nén bước lại cho khỏi hụt
  const span = Math.max(0.6, seg.end - seg.start);
  const step = Math.min(0.2, (span * 0.45) / Math.max(1, seg.lines.length));
  const after = 0.1 + seg.lines.length * step;

  const numP = easeOut(clamp01(local / 0.9));
  const boxP = easeOut(clamp01((local - after - 0.18) / 0.5));

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        padding: "320px 96px 330px",
        opacity: enter * exit,
      }}
    >
      {seg.num ? (
        <div
          style={{
            position: "absolute",
            right: 86,
            top: 140,
            fontSize: 420,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: accentDim,
            opacity: numP,
            transform: `translateX(${((1 - numP) * 70).toFixed(1)}px)`,
          }}
        >
          {seg.num}
        </div>
      ) : null}

      {seg.kicker ? (
        <div
          style={{
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: accent,
            marginBottom: 34,
            ...rise(local, 0.02, 0.4, 22),
          }}
        >
          {seg.kicker}
        </div>
      ) : null}

      {seg.lines.map(([text, cls], i) => (
        <div
          key={i}
          style={{
            fontSize: LINE_SIZES[cls.split(" ")[0]] ?? 88,
            fontWeight: 800,
            lineHeight: 1.14,
            letterSpacing: "-0.015em",
            color: cls.includes("hl") ? accent : "#f3f8f5",
            ...rise(local, 0.1 + i * step, 0.48, 34),
          }}
        >
          {text}
        </div>
      ))}

      {seg.sub ? (
        <div
          style={{
            fontSize: 46,
            fontWeight: 600,
            color: "#9db3aa",
            lineHeight: 1.42,
            marginTop: 36,
            ...rise(local, after + 0.15, 0.5, 26),
          }}
        >
          {seg.sub}
        </div>
      ) : null}

      {seg.box ? (
        <div
          style={{
            marginTop: 40,
            padding: "30px 36px",
            borderLeft: `6px solid ${accent}`,
            background: accentBg,
            borderRadius: 4,
            opacity: boxP,
            transform: `translateY(${((1 - boxP) * 24).toFixed(1)}px)`,
          }}
        >
          <div style={{ fontSize: 46, fontWeight: 600, color: "#dcebe3", lineHeight: 1.34 }}>
            {seg.box}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const AmwayText: React.FC<AmwayTimeline> = (props) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const theme = THEMES[props.theme];

  // Khuyến cáo hiện suốt nửa sau video — đủ lâu để đọc hết, đúng quy định quảng cáo
  const showDisclaimer = props.disclaimer !== "" && t > props.duration * 0.45;

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        fontFamily: `'${VIETNAMESE_FONT_FAMILY}', sans-serif`,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{vietnameseFontFaceCss}</style>

      {props.audioSrc ? <Audio src={staticFile(props.audioSrc)} /> : null}

      {/* Watermark handle — góc trái trên, hiện suốt video */}
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 150,
          display: "flex",
          alignItems: "center",
          gap: 18,
          opacity: 0.92,
        }}
      >
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: theme.accent }} />
        <div
          style={{
            fontSize: 38,
            fontWeight: 700,
            color: "#e6efea",
            textShadow: "0 2px 14px rgba(0,0,0,.55)",
          }}
        >
          {props.watermark}
        </div>
      </div>

      {props.segments
        .filter((s) => t >= s.start - 0.35 && t <= s.end + 0.05)
        .map((seg, i) => (
          <Segment
            key={`${seg.start}-${i}`}
            seg={seg}
            t={t}
            accent={theme.accent}
            accentDim={theme.accentDim}
            accentBg={theme.accentBg}
          />
        ))}

      {showDisclaimer ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            right: 96,
            bottom: 214,
            fontSize: 26,
            fontWeight: 600,
            lineHeight: 1.35,
            color: "#7f948c",
          }}
        >
          {props.disclaimer}
        </div>
      ) : null}

      {/* Chân trang: tên chuyên mục + đếm ngược */}
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 150,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 30,
          fontWeight: 600,
          color: "#6f8880",
          letterSpacing: "0.05em",
        }}
      >
        <span>{props.brandLabel}</span>
        <span>{Math.max(0, Math.ceil(props.duration - t))}s</span>
      </div>

      {/* Thanh tiến trình */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: "rgba(255,255,255,.07)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 10,
          background: theme.accent,
          width: `${interpolate(t, [0, props.duration], [0, 100], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }).toFixed(3)}%`,
        }}
      />
    </AbsoluteFill>
  );
};
