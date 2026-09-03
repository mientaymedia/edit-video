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
node build.mjs --voices     # xem danh sách giọng tiếng Việt và tên chính xác
node build.mjs A-01         # dựng một video
node build.mjs --all        # dựng tất cả video trong videos.json
node build.mjs A-01 --no-tts  # dựng lại phần hình, dùng lại audio đã sinh
```

Video ra nằm ở `out/<id>.mp4`. Các file trung gian (`out/<id>/`) giữ lại để dựng lại
phần hình mà không phải đọc lại giọng.

**Việc đầu tiên nên làm:** chạy `node build.mjs --voices`, chọn giọng nam ưng ý, rồi
điền tên chính xác vào trường `voice` của từng video trong `videos.json`. Tên mặc định
đang để sẵn có thể không trùng với tên trong bản VieNeu trên máy bạn.

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
- Muốn dùng giọng khác VieNeu (Gemini TTS, ElevenLabs…): sinh file WAV bên ngoài, đặt vào
  `out/<id>/segNN.wav` cùng `parts.json` ghi độ dài từng đoạn, rồi chạy với `--no-tts`.
