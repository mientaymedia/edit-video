# Dây chuyền video giáo dục — hai page Amway

Dựng video dọc 1080×1920 có giọng đọc tiếng Việt, **không quay hình, không lộ mặt**.
Chữ và giọng khớp nhau vì mốc thời gian được **đo từ audio thật**, không phải đặt tay.

```
videos.json  →  VieNeu-TTS đọc từng đoạn  →  đo độ dài thật
             →  Chromium chụp từng khung của scene.html theo đúng mốc đó
             →  ffmpeg ghép hình + tiếng  →  out/<id>.mp4
```

## Cài một lần

```bash
pip install vieneu          # giọng tiếng Việt, chạy trên máy, miễn phí
cd scripts/amway
npm install                 # playwright-core + ffmpeg-static
```

Cần thêm: Node 22+, Chrome hoặc Chromium trên máy. Nếu Chrome nằm chỗ lạ thì đặt
`CHROME_PATH=/đường/dẫn/chrome`. Lần chạy đầu VieNeu tải model khoảng 1 GB, mất chừng 30 giây.

## Dùng

```bash
node build.mjs --voices     # xem giọng, ★ đánh dấu giọng khớp yêu cầu
node build.mjs A-01         # dựng một video
node build.mjs --all        # dựng tất cả video trong videos.json
node build.mjs A-01 --no-tts  # dựng lại phần hình, dùng lại audio đã sinh
```

Video ra nằm ở `out/<id>.mp4`. Các file trung gian (`out/<id>/`) giữ lại để dựng lại
phần hình mà không phải đọc lại giọng.

## Giọng đọc

Toàn bộ video dùng **giọng nam miền Tây (Nam Bộ)**, khai báo một lần ở đầu `videos.json`:

```json
"voicePref": { "gender": "male", "region": "nam" }
```

Không khai tên giọng cứng, vì tên trong gói VieNeu đổi theo bản còn yêu cầu "nam,
miền Tây" thì không. `build.mjs` đọc danh sách giọng lúc chạy, lọc theo tiêu chí này,
và trong số các giọng khớp thì ưu tiên giọng kể chuyện — hợp nội dung giáo dục hơn
giọng đọc tin tức.

Chạy `node build.mjs --voices` để xem giọng nào được chọn. Muốn ép một giọng cụ thể
thì thêm `"voice": "<tên>"` ở cấp cao nhất của `videos.json` — nó thắng `voicePref`.

## Watermark

Mỗi kênh đóng handle riêng ở **góc trái trên**, hiện suốt video:

| Kênh | Watermark |
|---|---|
| Page sản phẩm (`emdinh793`) | `@emdinh793` |
| Page kinh doanh (`henrydinhdaily`) | `@henrydinh.vn` |

Khai ở `pages.<kênh>.watermark` trong `videos.json`. Tên chuyên mục (`brandLabel`)
xuống chân trang để không tranh chỗ với watermark.

## Dựng bằng Remotion (tuỳ chọn)

`build.mjs` dựng thẳng bằng Chromium + ffmpeg — nhanh nhất cho video chữ thuần.
Nhưng cùng một `timeline.json` cũng chạy được trên engine Remotion của repo, khi bạn
muốn **xem trước và sửa bố cục bằng tay** thay vì sửa code rồi render lại.

```bash
cd ../../engines/remotion
npm run studio                      # mở Studio, chọn composition "AmwayText"
```

Trong Studio, dán nội dung `scripts/amway/out/<id>/timeline.json` vào ô props là thấy
video ngay, tua tới lui được, sửa thấy đổi liền.

Render từ dòng lệnh:

```bash
npx remotion render AmwayText \
  --props=../../scripts/amway/out/A-01/timeline.json \
  --output=../../scripts/amway/out/A-01-remotion.mp4
```

`build.mjs` tự chép giọng sang `engines/remotion/public/staging/` và ghi đường dẫn vào
`timeline.json`, nên Remotion ghép tiếng sẵn — không phải làm gì thêm.

**Dùng đường nào?** `build.mjs` cho sản xuất hàng loạt (nhanh hơn, một lệnh ra cả lô).
Remotion Studio khi cần soi kỹ một video hoặc thử một bố cục mới.

## Đặt lịch đăng

Sau khi có `out/<id>.mp4`, xem **[SCHEDULING.md](SCHEDULING.md)** — ba đường đưa video lên
page theo lịch đặt sẵn (API tự động / Meta Business Suite nạp tay / Claude in Chrome).

```bash
node schedule.mjs --plan     # xem lịch dự kiến, không gọi mạng
node schedule.mjs --check    # kiểm tra token trỏ đúng page chưa
node schedule.mjs --all      # đẩy video + đặt lịch cả lô
```

Lịch khai ở khối `schedule` trong `videos.json`: ngày bắt đầu, khung giờ cố định, bước ngày.
Mỗi video lùi một ngày theo đúng thứ tự trong mảng `videos`.

Video đã lên lịch được ghi vào `schedule-log.json` — chạy lại sẽ bỏ qua, **không đăng trùng**.

## Thêm video mới

Mỗi video là một phần tử trong `videos.json`. Mỗi đoạn có hai phần:

```json
{
  "say": "Câu này là lời đọc, TTS sẽ đọc nguyên văn.",
  "lines": [["Chữ hiện trên", "l-lg"], ["màn hình.", "l-lg hl"]],
  "kicker": "Nhãn nhỏ phía trên",
  "num": "2",
  "sub": "Dòng phụ nhỏ hơn",
  "box": "Khối nhấn có vạch màu bên trái",
  "gap": 0.4
}
```

Ở cấp video còn hai trường dùng lúc đăng, không hiện trong video: `caption` (nội dung
mô tả dưới bài) và `hashtags` (mảng chữ, không kèm dấu #).

- `say` là lời đọc — viết trọn câu, có dấu chấm phẩy để giọng ngắt đúng chỗ.
- `lines` là chữ hiện lên. **Ngắn hơn `say` nhiều** — chữ trên màn hình là điểm nhấn, không phải phụ đề.
- Lớp cỡ chữ: `l-xl` `l-lg` `l-md` `l-sm`. Thêm `hl` để tô màu nhấn: `["Dòng này", "l-lg hl"]`.
- `gap` là khoảng lặng sau đoạn, tính bằng giây. Mặc định 0,35.
- `num` hiện số lớn mờ phía sau — chỉ dùng khi nội dung thật sự là một danh sách có thứ tự.
- Đặt `"disclaimer": true` ở cấp video khi video có nhắc sản phẩm. Khuyến cáo sẽ hiện
  ở nửa sau video, đủ lâu để đọc hết.

Hai kênh dùng hai bảng màu, khai báo ở `pages`: `emdinh793` màu xanh lá, `henrydinhdaily`
màu xanh mực. Chỉ cần đổi trường `page` của video là đổi theo.

## Trước khi đăng — bắt buộc

Xem lại từng video một lượt với danh sách cấm. TTS và trình dựng **không biết luật quảng
cáo Việt Nam** và sẽ đọc trơn tru bất kỳ câu nào bạn đưa vào.

- Không nói sản phẩm chữa, khỏi, điều trị, thay thế thuốc.
- Không hình ảnh so sánh trước–sau.
- Không nêu hay ám chỉ con số thu nhập ở kênh kinh doanh.
- Video nhắc sản phẩm phải bật `disclaimer`.
- Bật nhãn nội dung AI của nền tảng khi đăng.

Gửi kịch bản cho tuyến trên hoặc bộ phận tuân thủ Amway Việt Nam duyệt trước khi dựng cả lô.

## Ghi chú kỹ thuật

- Một tiến trình VieNeu duy nhất phục vụ cả lô. Nạp model mất 15–30 giây nên spawn lại
  cho từng câu là lãng phí — `build.mjs` giữ worker sống suốt lô.
- Giọng nhân bản cần thêm `pip install torch torchaudio`. Chỉ nhân bản giọng của chính bạn.
- Nếu muốn đổi tốc độ khung hình: `FPS=25 node build.mjs --all`. 30 là mặc định.
- `preview.mjs <id>` dựng thử PHẦN HÌNH khi chưa cài TTS, ước thời lượng theo số chữ.
  Chỉ dùng để soi bố cục và watermark — bản thật luôn lấy mốc từ audio qua `build.mjs`.
- Muốn dùng giọng khác VieNeu (Gemini TTS, ElevenLabs…): sinh file WAV bên ngoài, đặt vào
  `out/<id>/segNN.wav` cùng `parts.json` ghi độ dài từng đoạn, rồi chạy với `--no-tts`.
