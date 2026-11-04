import { getEnv } from "./env";

type Mail = { to: string; subject: string; text: string };

/** Sends via Resend when RESEND_API_KEY is set; otherwise prints to the server console (dev). */
export async function sendEmail(mail: Mail): Promise<void> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    console.log(`\n[email:dev] To: ${mail.to}\nSubject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text }),
  });
  if (!res.ok) console.error("[email] send failed", res.status);
}

export function appUrl(path: string) {
  return `${getEnv().NEXTAUTH_URL.replace(/\/$/, "")}${path}`;
}
