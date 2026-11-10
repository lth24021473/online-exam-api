import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const service = this.config.get<string>('SMTP_SERVICE');
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const secure =
      this.config.get<string>('SMTP_SECURE') === 'true' || port === 465;

    this.from =
      this.config.get<string>('SMTP_FROM') ??
      (user ? `"Online Exam" <${user}>` : '"Online Exam" <noreply@online-exam.com>');
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';

    if ((service || host) && user && pass) {
      this.transporter = nodemailer.createTransport(
        service
          ? {
              service,
              auth: { user, pass },
            }
          : {
              host,
              port,
              secure,
              auth: { user, pass },
            },
      );
      this.logger.log(
        service
          ? `SMTP Mailer initialized using service '${service}' (user: ${user})`
          : `SMTP Mailer initialized with host ${host}:${port} (user: ${user})`,
      );
    } else {
      this.logger.warn(
        'SMTP credentials not fully configured in .env. Outgoing emails will be logged to console (Development Mode).',
      );
    }
  }

  async onModuleInit() {
    if (this.transporter) {
      try {
        await this.transporter.verify();
        this.logger.log('SMTP connection verified successfully. Ready to send real emails.');
      } catch (error) {
        this.logger.error(
          `SMTP verification failed: ${(error as Error).message}. Real emails may fail until credentials in .env are fixed.`,
        );
      }
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetLink = `${this.frontendUrl}/forgot-password?token=${token}&email=${encodeURIComponent(email)}`;
    const subject = 'Mã xác thực đặt lại mật khẩu - Online Exam';
    const text = `Xin chào,\n\nBạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản ${email}.\n\nMã xác thực 6 số của bạn là: ${token}\n\nHoặc bạn có thể truy cập liên kết sau để đặt lại mật khẩu (hiệu lực trong 15 phút):\n${resetLink}\n\nNếu bạn không yêu cầu hành động này, vui lòng bỏ qua email này.\n`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; color: #1e293b;">
        <h2 style="color: #2563eb; margin-top: 0;">Yêu cầu đặt lại mật khẩu</h2>
        <p>Xin chào,</p>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản <strong>${email}</strong> trên hệ thống thi trực tuyến <strong>Online Exam</strong>.</p>
        <p>Mã xác thực 6 số của bạn là:</p>
        <div style="background: #f1f5f9; padding: 16px 20px; font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; border-radius: 6px; margin: 20px 0; color: #1e40af; font-family: monospace;">
          ${token}
        </div>
        <p>Mã này có hiệu lực trong <strong>15 phút</strong>. Bạn có thể nhập trực tiếp 6 số trên vào trang web hoặc bấm vào nút bên dưới:</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${resetLink}" style="background: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Đặt lại mật khẩu</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">Nếu bạn không yêu cầu thay đổi mật khẩu, vui lòng bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ an toàn.</p>
      </div>
    `;

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: this.from,
          to: email,
          subject,
          text,
          html,
        });
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          this.logger.log(`📧 Xem trước email online tại: ${previewUrl}`);
        }
        this.logger.log(`Password reset email sent successfully to ${email}`);
        return;
      } catch (error) {
        this.logger.error(
          `Failed to send email to ${email}: ${(error as Error).message}`,
        );
      }
    }

    // Development fallback: display token and link prominently in console
    this.logger.log(
      `\n======================================================\n[DEV MAIL] Password reset email for: ${email}\nMã xác nhận (6 số): ${token}\nReset Link: ${resetLink}\n======================================================\n`,
    );
  }
}


