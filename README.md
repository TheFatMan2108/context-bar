# context-bar

Thanh mức dùng context ngay dưới ô nhắn tin Claude Code. Terminal thêm thanh 10 ô vào dòng gợi ý; desktop hiển thị thanh 20 ô, phần trăm, token đã dùng/tổng và token còn lại trong một hàng, giữ gợi ý gốc.

Màu theo mức dùng: xanh dưới 60%, vàng từ 60% đến dưới 80%, đỏ từ 80%. Trước phản hồi đầu, hiển thị “chưa có dữ liệu” cùng kích thước cửa sổ. Nếu nền màu không hiển thị, các ký tự ▰/▱ vẫn biểu diễn thanh.

Đọc số liệu một lần khi bắt đầu phiên, sau đó nhận sự kiện `session.measure`; không poll, gọi model, truy cập mạng, đọc file hay ghi `$.store`. VS Code/mobile giữ nguyên giao diện engine.

Cài đặt trong Claude Code:

```text
/plugin marketplace add TheFatMan2108/context-bar
/plugin install context-bar --marketplace TheFatMan2108/context-bar
```

Desktop: **Plugins → Add marketplace**, nhập `TheFatMan2108/context-bar`, rồi cài `context-bar`.

Kiểm tra tại thư mục repo:

```text
claude plugin validate .
claude plugin test .
```
