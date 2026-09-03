#!/usr/bin/env node
/**
 * build.mjs — dây chuyền video giáo dục cho hai page Amway.
 *
 *   kịch bản (videos.json)
 *     → VieNeu-TTS đọc TỪNG ĐOẠN (giọng tiếng Việt, chạy trên máy, miễn phí)
 *     → đo độ dài thật của mỗi đoạn, tự tính mốc thời gian
 *     → Chromium chụp từng khung của scene.html theo đúng mốc đó
 *     → ffmpeg ghép hình + tiếng thành MP4 dọc 1080×1920
 *
 * Chữ và giọng khớp nhau vì mốc thời gian LẤY TỪ audio, không phải đoán trước.
 *
 * Dùng:
 *   node build.mjs --voices              # xem giọng tiếng Việt, đánh dấu giọng khớp yêu cầu
 *   node build.mjs A-01                  # dựng một video
 *   node build.mjs --all                 # dựng tất cả video trong videos.json
 *   node build.mjs A-01 --no-tts         # dựng lại phần hình, dùng lại audio cũ
 *
 * Yêu cầu trên máy: Node 22+, `pip install vieneu`, Chrome/Chromium, ffmpeg.
 */
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT  = resolve(HERE, 'out');
const WORKER = resolve(REPO, 'apps', 'server', 'python', 'vieneu_worker.py');

const FPS = Number(process.env.FPS || 30);
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

// ---------------------------------------------------------------------------
// Tìm ffmpeg và Chromium: ưu tiên biến môi trường, rồi các chỗ hay có sẵn
// ---------------------------------------------------------------------------
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const local = resolve(HERE, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (existsSync(local)) return local;
  const rootLocal = resolve(REPO, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (existsSync(rootLocal)) return rootLocal;
  return 'ffmpeg'; // trên PATH
}
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const guesses = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return guesses.find(p => existsSync(p)) || undefined;
}
const FFMPEG = findFfmpeg();

// ---------------------------------------------------------------------------
// Worker VieNeu-TTS: một tiến trình sống lâu, giao thức JSON theo dòng
// (nạp model mất 15–30 giây nên tuyệt đối không spawn lại cho từng câu)
// ---------------------------------------------------------------------------
class Tts {
  constructor() {
    this.proc = spawn(PYTHON, [WORKER], { cwd: REPO, stdio: ['pipe', 'pipe', 'inherit'] });
    this.rl = createInterface({ input: this.proc.stdout });
    this.queue = [];
    this.rl.on('line', (line) => {
      const t = line.trim(); if (!t) return;
      const job = this.queue.shift(); if (!job) return;
      try { job.resolve(JSON.parse(t)); } catch (e) { job.reject(new Error('JSON hỏng: ' + t.slice(0, 200))); }
    });
    this.proc.on('exit', (code) => {
      while (this.queue.length) this.queue.shift().reject(new Error('worker TTS thoát, mã ' + code));
    });
  }
  send(req) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }
  close() { try { this.proc.stdin.end(); this.proc.kill(); } catch {} }
}

// ---------------------------------------------------------------------------
// Chọn giọng: ưu tiên tên cứng, không có thì lọc theo tiêu chí (giới tính + vùng miền)
//
// Cố ý KHÔNG bắt người dùng nhớ tên giọng: tên trong gói VieNeu đổi theo bản, còn
// yêu cầu "giọng nam miền Tây" thì không đổi. Khai báo tiêu chí bền hơn khai báo tên.
// ---------------------------------------------------------------------------
function pickVoice(voices, pref, explicit) {
  if (explicit) {
    const hit = voices.find(v => v.name === explicit);
    if (!hit) throw new Error(`không có giọng tên "${explicit}". Chạy \`node build.mjs --voices\` để xem danh sách.`);
    return hit.name;
  }
  const want = (k, v) => !pref?.[k] || String(v || '').toLowerCase() === String(pref[k]).toLowerCase();
  const matched = voices.filter(v => want('gender', v.gender) && want('region', v.region));
  if (!matched.length) {
    const seen = voices.map(v => `${v.name} (${v.gender}/${v.region})`).join(', ');
    throw new Error(`không có giọng nào khớp ${JSON.stringify(pref)}. Đang có: ${seen}`);
  }
  // cùng tiêu chí thì ưu tiên giọng kể chuyện — hợp nội dung giáo dục hơn giọng tin tức
  const byStyle = matched.find(v => v.style === 'ke-chuyen') || matched.find(v => v.style === 'tu-nhien') || matched[0];
  return byStyle.name;
}

// ---------------------------------------------------------------------------
// Dựng một video
// ---------------------------------------------------------------------------
async function buildVideo(video, cfg, tts, opts) {
  const dir = join(OUT, video.id);
  mkdirSync(dir, { recursive: true });
  const parts = [];

  // 1) đọc từng đoạn, đo độ dài thật
  if (opts.tts) {
    console.log(`\n[${video.id}] đọc ${video.segments.length} đoạn bằng giọng "${opts.voice}"`);
    for (let i = 0; i < video.segments.length; i++) {
      const s = video.segments[i];
      const wav = join(dir, `seg${String(i).padStart(2, '0')}.wav`);
      const r = await tts.send({ cmd: 'synth', text: s.say, voice: opts.voice, out: wav });
      if (!r.ok) throw new Error(`đoạn ${i}: ${r.code} — ${r.message}`);
      parts.push({ wav, dur: r.durationSec, gap: s.gap ?? 0.35 });
      process.stdout.write(`  ${i + 1}/${video.segments.length} · ${r.durationSec.toFixed(2)}s\n`);
    }
    writeFileSync(join(dir, 'parts.json'), JSON.stringify(parts, null, 2));
  } else {
    parts.push(...JSON.parse(readFileSync(join(dir, 'parts.json'), 'utf8')));
  }

  // 2) nối các đoạn, chèn khoảng lặng giữa các đoạn cho người nghe kịp thở
  const voiceWav = join(dir, 'voice.wav');
  if (opts.tts) {
    const inputs = [], filters = [];
    parts.forEach((p, i) => {
      inputs.push('-i', p.wav);
      filters.push(`[${i}:a]apad=pad_dur=${p.gap}[a${i}]`);
    });
    const concat = parts.map((_, i) => `[a${i}]`).join('') + `concat=n=${parts.length}:v=0:a=1[out]`;
    execFileSync(FFMPEG, ['-y', ...inputs, '-filter_complex', filters.join(';') + ';' + concat,
      // 48 kHz: VieNeu v3turbo xuất thẳng 48 kHz mono và OUT_SAMPLE_RATE của
      // pipeline cũng là 48 kHz — hạ xuống 44.1 rồi encode lại là mất chất vô ích.
      '-map', '[out]', '-ar', '48000', voiceWav], { stdio: ['ignore', 'ignore', 'pipe'] });
  }

  // 3) mốc thời gian lấy từ độ dài audio thật
  let t = 0;
  const segments = video.segments.map((s, i) => {
    const start = t;
    const end = t + parts[i].dur + parts[i].gap;
    t = end;
    return { ...s, start: +start.toFixed(3), end: +end.toFixed(3) };
  });
  const duration = +(t + 0.4).toFixed(3); // thêm 0,4s đuôi cho khung cuối không cụt
  const page = cfg.pages[video.page];

  // Stage giọng sang engine Remotion: Remotion chỉ đọc được file nằm trong
  // public/ của nó (staticFile), nên chép sang đó và ghi đường dẫn tương đối.
  // Nhờ vậy cùng một timeline.json chạy được cả hai đường dựng.
  let audioSrc = null;
  const staging = resolve(REPO, 'engines', 'remotion', 'public', 'staging');
  if (existsSync(voiceWav) && existsSync(dirname(staging))) {
    mkdirSync(staging, { recursive: true });
    const staged = join(staging, `amway-${video.id}.wav`);
    copyFileSync(voiceWav, staged);
    audioSrc = `staging/amway-${video.id}.wav`;
  }

  const data = {
    theme: page.theme, watermark: page.watermark, brandLabel: page.brandLabel,
    disclaimer: video.disclaimer ? cfg.disclaimer : '', duration, segments, audioSrc,
  };
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(data, null, 2));
  console.log(`[${video.id}] tổng ${duration}s · ${Math.round(duration * FPS)} khung hình`);

  // 4) chụp từng khung
  const frames = join(dir, '.frames');
  if (existsSync(frames)) rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findChrome(),
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none', '--no-sandbox'],
  });
  const page_ = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page_.goto('file://' + resolve(HERE, 'scene.html'), { waitUntil: 'load' });
  await page_.evaluate(() => document.fonts.ready);
  await page_.evaluate((d) => window.build(d), data);
  await page_.waitForTimeout(300);

  const total = Math.round(duration * FPS);
  for (let f = 0; f < total; f++) {
    await page_.evaluate((tt) => window.seek(tt), f / FPS);
    await page_.screenshot({ path: join(frames, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92, animations: 'disabled' });
    if (f % 200 === 0) process.stdout.write(`  khung ${f}/${total}\n`);
  }
  await browser.close();

  // 5) ghép hình + tiếng
  const mp4 = join(OUT, `${video.id}.mp4`);
  execFileSync(FFMPEG, [
    '-y', '-framerate', String(FPS), '-i', join(frames, 'f%05d.jpg'), '-i', voiceWav,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  rmSync(frames, { recursive: true, force: true });
  console.log(`[${video.id}] XONG → ${mp4}`);
  return mp4;
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(resolve(HERE, 'videos.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });

  if (args.includes('--voices')) {
    const tts = new Tts();
    const r = await tts.send({ cmd: 'voices' });
    tts.close();
    if (!r.ok) { console.error('lỗi:', r.message); process.exit(1); }
    const pref = cfg.voicePref || {};
    const want = (k, v) => !pref[k] || String(v || '').toLowerCase() === String(pref[k]).toLowerCase();
    console.log(`Giọng tiếng Việt có sẵn (★ = khớp yêu cầu ${JSON.stringify(pref)}):\n`);
    for (const v of r.voices) {
      const star = want('gender', v.gender) && want('region', v.region) ? '★' : ' ';
      console.log(`  ${star} ${String(v.name).padEnd(22)} ${String(v.gender).padEnd(8)} ${String(v.region).padEnd(8)} ${v.style || ''}`);
    }
    try { console.log(`\nHệ thống sẽ tự chọn: ${pickVoice(r.voices, pref, cfg.voice)}`); }
    catch (e) { console.log(`\n${e.message}`); }
    console.log('Muốn ép một giọng cụ thể: đặt "voice": "<tên>" ở cấp cao nhất trong videos.json.');
    return;
  }

  const wantTts = !args.includes('--no-tts');
  const ids = args.includes('--all')
    ? cfg.videos.map(v => v.id)
    : args.filter(a => !a.startsWith('--'));
  if (!ids.length) {
    console.log('Dùng: node build.mjs A-01 | --all | --voices | --no-tts');
    console.log('Có sẵn:', cfg.videos.map(v => v.id).join(', '));
    return;
  }

  const tts = wantTts ? new Tts() : null;
  let voice = null;
  if (tts) {
    const p = await tts.send({ cmd: 'ping' });
    if (!p.ok) throw new Error('không khởi động được VieNeu-TTS — chạy `pip install vieneu` trước');
    const vs = await tts.send({ cmd: 'voices' });
    if (!vs.ok) throw new Error('không đọc được danh sách giọng: ' + vs.message);
    voice = pickVoice(vs.voices, cfg.voicePref || {}, cfg.voice);
    console.log(`VieNeu-TTS sẵn sàng (bản ${p.version}) · giọng: ${voice}`);
  }
  try {
    for (const id of ids) {
      const v = cfg.videos.find(x => x.id === id);
      if (!v) { console.error(`bỏ qua ${id}: không có trong videos.json`); continue; }
      await buildVideo(v, cfg, tts, { tts: wantTts, voice: v.voice || voice });
    }
  } finally { tts?.close(); }

  console.log(`\nTất cả video nằm ở: ${OUT}`);
  console.log('Muốn sửa bố cục bằng tay: cd ../../engines/remotion && npm run studio → chọn AmwayText,');
  console.log(`kéo thả file out/<id>/timeline.json vào ô props.`);
  console.log('Bước tiếp theo: xem lại từng video với danh sách cấm, rồi nạp vào Meta Business Suite.');
}

main().catch(e => { console.error('\nLỖI:', e.message); process.exit(1); });
