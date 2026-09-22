import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST ?? "localhost";
const port = Number(process.env.SMTP_PORT ?? 1025);
const from = process.env.SMTP_FROM ?? "noreply@ticket-grab.local";

export async function sendNotificationEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    return true;
  } catch (err) {
    console.error("SMTP send failed", err);
    return false;
  }
}
