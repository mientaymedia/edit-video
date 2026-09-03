// preview.mjs — dựng thử phần HÌNH khi chưa có TTS (ước thời lượng theo số chữ).
// Chỉ để xem bố cục/watermark. Bản thật luôn lấy mốc từ audio qua build.mjs.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const HERE = process.cwd();
const cfg = JSON.parse(readFileSync(join(HERE,'videos.json'),'utf8'));
const id = process.argv[2] || 'A-01';
const v = cfg.videos.find(x=>x.id===id);
const page = cfg.pages[v.page];
const FPS = 30, WPS = 15.5; // ~15,5 ký tự/giây cho giọng đọc tiếng Việt vừa phải
let t = 0;
const segments = v.segments.map(s => {
  const dur = Math.max(1.6, s.say.length / WPS);
  const start = t, end = t + dur + (s.gap ?? 0.35); t = end;
  return { ...s, start:+start.toFixed(3), end:+end.toFixed(3) };
});
const duration = +(t+0.4).toFixed(3);
const data = { theme:page.theme, watermark:page.watermark, brandLabel:page.brandLabel,
               disclaimer: v.disclaimer ? cfg.disclaimer : '', duration, segments };
const frames = join(HERE,'.pv'); if (existsSync(frames)) rmSync(frames,{recursive:true,force:true}); mkdirSync(frames);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--font-render-hinting=none','--force-device-scale-factor=1'] });
const p = await b.newPage({ viewport:{width:1080,height:1920}, deviceScaleFactor:1 });
await p.goto('file://'+join(HERE,'scene.html'), { waitUntil:'load' });
await p.evaluate(()=>document.fonts.ready);
await p.evaluate(d=>window.build(d), data);
await p.waitForTimeout(300);
const total = Math.round(duration*FPS);
console.log(`${id}: ${duration}s · ${total} khung`);
for (let f=0; f<total; f++){
  await p.evaluate(tt=>window.seek(tt), f/FPS);
  await p.screenshot({ path: join(frames,`f${String(f).padStart(5,'0')}.jpg`), type:'jpeg', quality:92, animations:'disabled' });
}
await b.close();
execFileSync(join(HERE,'node_modules','ffmpeg-static','ffmpeg'),
  ['-y','-framerate',String(FPS),'-i',join(frames,'f%05d.jpg'),'-c:v','libx264','-preset','medium','-crf','20',
   '-pix_fmt','yuv420p','-movflags','+faststart','-r',String(FPS), join(HERE,`preview-${id}.mp4`)],
  { stdio:['ignore','ignore','pipe'] });
rmSync(frames,{recursive:true,force:true});
console.log('XONG →', `preview-${id}.mp4`);
