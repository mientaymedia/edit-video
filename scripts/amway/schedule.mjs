#!/usr/bin/env node
/**
 * schedule.mjs — đẩy video lên Facebook Page và ĐẶT LỊCH ĐĂNG TRƯỚC.
 *
 * Mỗi video lên lịch một ngày, theo đúng thứ tự trong videos.json, vào khung giờ
 * cố định khai ở `schedule`. Chạy một lần là cả tháng tự đăng.
 *
 * Dùng:
 *   node schedule.mjs --plan          # xem lịch dự kiến, KHÔNG gọi mạng
 *   node schedule.mjs --check         # kiểm tra token còn sống và quyền đủ chưa
 *   node schedule.mjs --all           # đẩy + đặt lịch mọi video chưa lên lịch
 *   node schedule.mjs A-01            # chỉ một video
 *   node schedule.mjs --all --dry-run # chạy thử, in ra request mà không gửi
 *
 * Token đặt trong `.env.local` (xem `.env.example`). File đó KHÔNG được commit.
 *
 * An toàn: mọi video đã lên lịch thành công được ghi vào `schedule-log.json`.
 * Chạy lại sẽ BỎ QUA những video đó — không bao giờ đăng trùng. Muốn lên lịch
 * lại một video thì xoá dòng của nó trong log.
 */
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT  = join(HERE, 'out');
const LOG  = join(HERE, 'schedule-log.json');
const API  = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Cấu hình: .env.local dạng KEY=value, mỗi dòng một cặp
// ---------------------------------------------------------------------------
function loadEnv() {
  const f = join(HERE, '.env.local');
  if (!existsSync(f)) return {};
  const env = {};
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const ENV = { ...loadEnv(), ...process.env };

/** Khoá env cho một kênh: emdinh793 -> FB_EMDINH793_PAGE_ID / _TOKEN */
function envKeys(pageKey) {
  const k = pageKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return { id: `FB_${k}_PAGE_ID`, token: `FB_${k}_TOKEN` };
}

// ---------------------------------------------------------------------------
// Lịch: ngày bắt đầu + giờ cố định + bước ngày, tính ra Unix timestamp
// ---------------------------------------------------------------------------
function slotFor(sched, index) {
  const [Y, M, D] = sched.startDate.split('-').map(Number);
  const [h, m] = sched.postTime.split(':').map(Number);
  const off = sched.timezoneOffset || '+07:00';
  const day = new Date(Date.UTC(Y, M - 1, D));
  day.setUTCDate(day.getUTCDate() + index * (sched.everyNDays ?? 1));
  const iso = `${day.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${off}`;
  const at = new Date(iso);
  return { iso, unix: Math.floor(at.getTime() / 1000), at };
}

/** Facebook chỉ nhận lịch từ 20 phút tới 75 ngày kể từ lúc gọi. */
function validateSlot(unix) {
  const now = Math.floor(Date.now() / 1000);
  const min = now + 20 * 60, max = now + 75 * 24 * 3600;
  if (unix < min) return 'quá gần hiện tại (Facebook cần ít nhất 20 phút)';
  if (unix > max) return 'quá xa (Facebook chỉ cho đặt trước tối đa 75 ngày)';
  return null;
}

const fmt = (d) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });

// ---------------------------------------------------------------------------
// Facebook Reels API: 3 chặng — start (xin chỗ) → upload (đẩy file) → finish (đặt lịch)
// ---------------------------------------------------------------------------
async function fbJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok || body.error) {
    const e = body.error || {};
    throw new Error(`Facebook ${r.status}: ${e.message || text.slice(0, 300)}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return body;
}

async function scheduleReel({ pageId, token, file, description, publishAt, dryRun }) {
  const size = statSync(file).size;
  if (dryRun) {
    console.log(`    [thử] start → upload ${(size / 1048576).toFixed(1)} MB → finish, đặt lịch ${publishAt}`);
    return { video_id: 'DRY-RUN' };
  }

  // 1) start — Facebook trả video_id và upload_url riêng cho lần đẩy này
  const start = await fbJson(`${API}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: token }),
  });

  // 2) upload — đẩy nguyên file lên upload_url. Token đi ở header, không ở query.
  const up = await fetch(start.upload_url, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${token}`,
      'offset': '0',
      'file_size': String(size),
      'Content-Type': 'application/octet-stream',
    },
    body: createReadStream(file),
    duplex: 'half', // bắt buộc khi body là stream
  });
  const upText = await up.text();
  if (!up.ok) throw new Error(`upload thất bại ${up.status}: ${upText.slice(0, 300)}`);

  // 3) finish — chốt và ĐẶT LỊCH. video_state=SCHEDULED là chỗ tạo lịch đăng trước.
  const params = new URLSearchParams({
    access_token: token,
    upload_phase: 'finish',
    video_id: start.video_id,
    video_state: 'SCHEDULED',
    scheduled_publish_time: String(publishAt),
    description,
  });
  await fbJson(`${API}/${pageId}/video_reels?${params}`, { method: 'POST' });
  return { video_id: start.video_id };
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cfg = JSON.parse(readFileSync(join(HERE, 'videos.json'), 'utf8'));
  const sched = cfg.schedule;
  if (!sched) throw new Error('videos.json thiếu khối "schedule"');

  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : {};

  // --check: token còn sống và trỏ đúng page chưa
  if (args.includes('--check')) {
    for (const [key, page] of Object.entries(cfg.pages)) {
      const k = envKeys(key);
      const id = ENV[k.id], token = ENV[k.token];
      if (!id || !token) { console.log(`  ✗ ${key}: thiếu ${k.id} hoặc ${k.token} trong .env.local`); continue; }
      try {
        const me = await fbJson(`${API}/${id}?fields=name,id&access_token=${token}`);
        console.log(`  ✓ ${key} → ${me.name} (${me.id})  watermark ${page.watermark}`);
      } catch (e) { console.log(`  ✗ ${key}: ${e.message}`); }
    }
    return;
  }

  // Chọn video: --all hoặc liệt kê id
  const wanted = args.includes('--all')
    ? cfg.videos.map(v => v.id)
    : args.filter(a => !a.startsWith('--'));
  if (!wanted.length && !args.includes('--plan')) {
    console.log('Dùng: node schedule.mjs --plan | --check | --all | <id> [--dry-run]');
    return;
  }

  const rows = cfg.videos.map((v, i) => ({ v, i, slot: slotFor(sched, i) }));

  // --plan: chỉ in lịch, không gọi mạng
  if (args.includes('--plan')) {
    console.log(`Lịch đăng — bắt đầu ${sched.startDate}, ${sched.postTime} (giờ VN), mỗi ${sched.everyNDays ?? 1} ngày một video\n`);
    for (const { v, slot } of rows) {
      const done = log[v.id] ? ' [đã lên lịch]' : '';
      const bad = validateSlot(slot.unix);
      console.log(`  ${v.id.padEnd(6)} ${fmt(slot.at).padEnd(20)} ${cfg.pages[v.page].watermark.padEnd(16)}${done}${bad ? `  ⚠ ${bad}` : ''}`);
    }
    return;
  }

  let ok = 0, skip = 0;
  for (const { v, slot } of rows) {
    if (!wanted.includes(v.id)) continue;
    if (log[v.id]) { console.log(`  – ${v.id}: đã lên lịch ${fmt(new Date(log[v.id].publishAt * 1000))}, bỏ qua`); skip++; continue; }

    const file = join(OUT, `${v.id}.mp4`);
    if (!existsSync(file)) { console.log(`  ✗ ${v.id}: chưa có ${file} — chạy build.mjs trước`); continue; }

    const bad = validateSlot(slot.unix);
    if (bad) { console.log(`  ✗ ${v.id}: ${bad} (${fmt(slot.at)}) — sửa startDate trong videos.json`); continue; }

    const page = cfg.pages[v.page];
    const k = envKeys(v.page);
    const pageId = ENV[k.id], token = ENV[k.token];
    if (!pageId || !token) { console.log(`  ✗ ${v.id}: thiếu ${k.id}/${k.token}`); continue; }

    const tags = (v.hashtags || []).map(t => '#' + t).join(' ');
    const description = [v.caption, tags].filter(Boolean).join('\n\n');

    console.log(`\n  ${v.id} → ${page.watermark}, đăng lúc ${fmt(slot.at)}`);
    try {
      const r = await scheduleReel({ pageId, token, file, description, publishAt: slot.unix, dryRun });
      if (!dryRun) {
        log[v.id] = { videoId: r.video_id, page: v.page, publishAt: slot.unix, scheduledAt: new Date().toISOString() };
        writeFileSync(LOG, JSON.stringify(log, null, 2));
      }
      console.log(`    ✓ xong${dryRun ? ' (chạy thử)' : ` · video ${r.video_id}`}`);
      ok++;
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
  }

  console.log(`\n${ok} video đã đặt lịch, ${skip} bỏ qua vì đã có lịch.`);
  if (ok && !dryRun) console.log('Kiểm tra lại trong Meta Business Suite → Planner trước khi yên tâm.');
}

main().catch(e => { console.error('\nLỖI:', e.message); process.exit(1); });
