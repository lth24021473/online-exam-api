import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';

dotenv.config();

async function main() {
  const service = process.env.SMTP_SERVICE;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM || (user ? `"Online Exam" <${user}>` : '"Online Exam" <noreply@online-exam.com>');

  console.log('--- KIỂM TRA CẤU HÌNH GỬI EMAIL ---');
  console.log(`- Service:   ${service || '(none)'}`);
  console.log(`- Host:      ${host}`);
  console.log(`- Port:      ${port}`);
  console.log(`- User:      ${user ? user : '(Chưa điền SMTP_USER trong .env)'}`);
  console.log(`- Password:  ${pass ? '****** (Đã điền)' : '(Chưa điền SMTP_PASS trong .env)'}`);
  console.log(`- From:      ${from}`);

  if (!user || !pass) {
    console.error('\n❌ LỖI: Bạn chưa điền SMTP_USER hoặc SMTP_PASS trong file .env!');
    console.error('Vui lòng mở file .env và điền thông tin tài khoản email để gửi.');
    process.exit(1);
  }

  const recipient = process.argv[2] || user;
  console.log(`\nĐang kết nối tới máy chủ SMTP để gửi thư thử nghiệm tới: ${recipient}...`);

  const transporter = nodemailer.createTransport(
    service
      ? { service, auth: { user, pass } }
      : { host, port, secure: port === 465, auth: { user, pass } }
  );

  try {
    await transporter.verify();
    console.log('✅ Xác thực máy chủ SMTP thành công!');

    const info = await transporter.sendMail({
      from,
      to: recipient,
      subject: 'Thử nghiệm gửi email từ hệ thống Online Exam',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #2563eb;">Kiểm tra gửi email thành công! 🎉</h2>
          <p>Xin chào,</p>
          <p>Nếu bạn nhận được email này, tính năng gửi email thật của hệ thống <strong>Online Exam</strong> đã hoạt động chính xác.</p>
          <p>Thời gian gửi: <strong>${new Date().toLocaleString('vi-VN')}</strong></p>
        </div>
      `,
    });

    console.log(`✅ Email đã được gửi thành công! Message ID: ${info.messageId}`);
    console.log(`👉 Vui lòng kiểm tra hộp thư đến (hoặc hòm thư Spam/Junk) của: ${recipient}`);
  } catch (error) {
    console.error('\n❌ GỬI EMAIL THẤT BẠI:');
    console.error((error as Error).message);
    console.log('\n💡 Hướng dẫn khắc phục lỗi thường gặp:');
    console.log('1. Nếu dùng Gmail: Không dùng mật khẩu đăng nhập Gmail thông thường!');
    console.log('   -> Hãy bật Xác minh 2 bước và tạo "Mật khẩu ứng dụng" (App Password) 16 ký tự tại:');
    console.log('   https://myaccount.google.com/apppasswords');
    console.log('2. Kiểm tra xem email người gửi (SMTP_USER) và mật khẩu (SMTP_PASS) có bị thừa dấu cách không.');
    process.exit(1);
  }
}

main();

