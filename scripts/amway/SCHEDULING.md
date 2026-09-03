# Đặt lịch đăng trước — ba đường

Ba cách đưa video lên hai page theo lịch đặt sẵn. Chọn một, không cần làm cả ba.

| | Setup ban đầu | Sức bền | Rủi ro |
|---|---|---|---|
| **A · API** (`schedule.mjs`) | ~15 phút, một lần | Cao — chạy một lệnh là xong cả tháng | Token có thể hết hạn, phải lấy lại |
| **B · Meta Business Suite** (tay) | 0 | Cao — công cụ chính chủ | Không có; chỉ tốn công nạp |
| **C · Claude in Chrome** | 0 nếu đã cài | Trung bình | Giao diện Meta đổi thì thao tác lệch |

**Khuyến nghị: bắt đầu bằng B cho tháng đầu, chuyển sang A khi đã chắc nội dung chạy được.**
Lý do: tháng đầu bạn còn sửa nội dung liên tục, nạp tay lại linh hoạt hơn. Tự động hoá một
quy trình chưa ổn định chỉ làm nó sai nhanh hơn.

---

## Đường A — API, tự động hoàn toàn

Một lệnh đặt lịch cả tháng. Sau đó không đụng gì nữa.

```bash
node schedule.mjs --plan     # xem lịch dự kiến, không gọi mạng
node schedule.mjs --check    # kiểm tra token còn sống, trỏ đúng page chưa
node schedule.mjs --all      # đẩy video + đặt lịch
```

Video nào đã lên lịch được ghi vào `schedule-log.json`. Chạy lại sẽ bỏ qua chúng —
**không bao giờ đăng trùng**. Muốn lên lịch lại một video thì xoá dòng của nó trong log.

### Lấy Page ID và Token — làm một lần

**1. Tạo app.** Vào [developers.facebook.com/apps](https://developers.facebook.com/apps) →
**Create App** → loại **Business** → đặt tên bất kỳ (ví dụ "Amway Scheduler"). Không cần
submit review, không cần điền gì thêm — app chỉ để lấy token cho page của chính bạn.

**2. Lấy token ngắn hạn.** Mở [Graph API Explorer](https://developers.facebook.com/tools/explorer/):

- Góc phải chọn đúng app vừa tạo.
- Bấm **Get Token → Get Page Access Token**, chọn cả hai page.
- Ở ô **Permissions** thêm đủ ba quyền: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
- Bấm **Generate Access Token** và duyệt.

Token này sống khoảng 1 giờ. Đừng dùng nó cho `.env.local` — đổi sang loại dài hạn ở bước sau.

**3. Đổi sang token dài hạn.** Lấy **App ID** và **App Secret** ở
*App → Settings → Basic*, rồi mở URL này trên trình duyệt (thay ba giá trị trong ngoặc):

```
https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=<APP_ID>
  &client_secret=<APP_SECRET>
  &fb_exchange_token=<TOKEN_NGẮN_HẠN_Ở_BƯỚC_2>
```

Kết quả trả về `access_token` — đây là **user token dài hạn**, sống 60 ngày.

**4. Lấy Page ID + Page token.** Mở tiếp:

```
https://graph.facebook.com/v21.0/me/accounts?access_token=<USER_TOKEN_DÀI_HẠN>
```

Kết quả liệt kê từng page kèm `id` và `access_token`. **Page token lấy theo đường này
không hết hạn** (trừ khi bạn đổi mật khẩu Facebook hoặc gỡ app).

**5. Điền vào `.env.local`.** Chép `.env.example` thành `.env.local` rồi điền:

```
FB_EMDINH793_PAGE_ID=<id của page emdinh793>
FB_EMDINH793_TOKEN=<page token của page đó>
FB_HENRYDINHDAILY_PAGE_ID=<id của page henrydinhdaily.vn>
FB_HENRYDINHDAILY_TOKEN=<page token của page đó>
```

Xong thì `node schedule.mjs --check`. Thấy dấu ✓ kèm đúng tên page là chạy được.

### Giới hạn cần biết

- Facebook chỉ nhận lịch **từ 20 phút đến 75 ngày** kể từ lúc gọi. `schedule.mjs` tự chặn
  trước và báo rõ nếu `startDate` nằm ngoài khoảng đó.
- Token thu hồi khi bạn đổi mật khẩu Facebook hoặc gỡ app. Lúc đó `--check` báo lỗi,
  làm lại từ bước 2.
- **`.env.local` chứa khoá thật — không commit, không gửi cho ai, không dán vào chat.**

---

## Đường B — Meta Business Suite, nạp tay

Không setup gì, dùng công cụ chính chủ của Meta. Nạp một lần cho cả tháng.

1. Mở [business.facebook.com](https://business.facebook.com) → chọn page → **Planner**.
2. **Create post → Reel** (video dọc 9:16 nên đăng dạng Reels, không phải video thường).
3. Tải `out/<id>.mp4` lên, dán caption từ trường `caption` trong `videos.json`.
4. Bấm mũi tên cạnh nút **Publish** → **Schedule** → chọn ngày giờ theo `node schedule.mjs --plan`.
5. Lặp lại cho từng video. Khoảng 2 phút một cái.

Meta Business Suite quản lý được cả hai page trong một chỗ và đặt lịch xa được nhiều tuần.
Đây là đường **không bao giờ hỏng** — đáng dùng cho tháng đầu.

---

## Đường C — Claude in Chrome

Nếu bạn đã cài [Claude in Chrome](https://claude.ai/chrome), Claude thao tác Business Suite
thay bạn. Cần bạn ngồi cạnh xem, không bỏ đi được.

Mở Business Suite ở tab đang đăng nhập, rồi dán prompt này:

> Mình cần đặt lịch đăng Reels cho page Facebook đang mở trong Meta Business Suite.
>
> Với mỗi video mình đưa, làm đúng các bước sau:
> 1. Vào Planner, tạo bài mới dạng **Reel** (không phải video thường — video của mình là dọc 9:16).
> 2. Tải lên file video mình chỉ định.
> 3. Dán nguyên văn caption mình đưa, giữ đúng xuống dòng và hashtag.
> 4. Đặt lịch vào đúng ngày giờ mình ghi, giờ Việt Nam.
> 5. Bấm Schedule, rồi **chụp màn hình xác nhận** cho mình xem trước khi làm video tiếp theo.
>
> Ba quy tắc bắt buộc:
> - Không tự sửa, rút gọn hay viết lại caption của mình, kể cả khi thấy dài.
> - Không tự bấm Publish ngay. Chỉ Schedule.
> - Nếu giao diện khác mô tả trên, dừng lại hỏi mình chứ đừng đoán.
>
> Video đầu tiên: [đường dẫn file] · đăng lúc [ngày giờ] · caption: [dán caption]

Chạy `node schedule.mjs --plan` để lấy danh sách ngày giờ, và lấy caption trong `videos.json`.

**Lưu ý:** đây là thao tác trên giao diện, mà Meta đổi giao diện khá thường xuyên. Luôn xem
ảnh chụp xác nhận trước khi tin là đã lên lịch xong.

---

## Sau khi lên lịch — bằng đường nào cũng vậy

Mở **Business Suite → Planner** xem lịch tháng. Cả 30 video phải hiện đúng ngày đúng giờ.
Đây là bước kiểm tra cuối, đừng bỏ: đặt lịch xong mà không mở ra nhìn thì đến ngày mới biết
là hụt bài.
