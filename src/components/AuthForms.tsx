"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent, type ReactNode } from "react";

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card stack" style={{ gap: 16 }}>
        <Link href="/" className="logo">
          Clip<span>nova</span>
        </Link>
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small" style={{ margin: "6px 0 0" }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Msg({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (ok) return <div className="alert success" role="status">{ok}</div>;
  return null;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; details?: Record<string, string[]> };
  if (!res.ok) {
    const detail = data.details ? Object.values(data.details).flat()[0] : undefined;
    throw new Error(detail || data.error || "Something went wrong.");
  }
  return data;
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const params = useSearchParams();
  const [error, setError] = useState(params.get("error") === "invalid_link" ? "That verification link is invalid or has expired." : "");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    let res: Awaited<ReturnType<typeof signIn>>;
    try {
      res = await signIn("credentials", {
        email: String(f.get("email")),
        password: String(f.get("password")),
        redirect: false,
      });
    } catch {
      setBusy(false);
      setError("Sign-in service is misconfigured (check NEXTAUTH_URL and NEXTAUTH_SECRET on the server).");
      return;
    }
    setBusy(false);
    if (!res) {
      setError("Sign-in service did not respond. Check NEXTAUTH_URL (must start with https://) and NEXTAUTH_SECRET.");
      return;
    }
    if (res.error || !res.ok) {
      setError(
        res.error === "EMAIL_NOT_VERIFIED"
          ? "Please verify your email first. Check your inbox for the link."
          : res.error === "CredentialsSignin"
            ? "Incorrect email or password."
            : `Sign-in failed (${res.error ?? "unknown"}). Check NEXTAUTH_URL and NEXTAUTH_SECRET on the server.`,
      );
      return;
    }
    // Full page load so the new session cookie is sent to the middleware.
    window.location.assign("/dashboard");
  }

  return (
    <Shell title="Welcome back" subtitle="Sign in to your workspace">
      <Msg error={error} ok={params.get("verified") ? "Email verified. You can sign in now." : undefined} />
      {googleEnabled && (
        <>
          <button className="btn" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
            Continue with Google
          </button>
          <div className="muted small" style={{ textAlign: "center" }}>or</div>
        </>
      )}
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">Email<input className="input" name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password<input className="input" name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
      <div className="row between small">
        <Link href="/forgot-password" className="muted">Forgot password?</Link>
        <Link href="/register" className="muted">Create account</Link>
      </div>
    </Shell>
  );
}

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    // React clears e.currentTarget after the handler's first await, so grab the form now.
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const data = await postJson("/api/auth/register", {
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
      });
      setOk(data.message ?? "Account created.");
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Create your account" subtitle="Upload once. Get scroll-stopping shorts in minutes.">
      <Msg error={error} ok={ok} />
      {googleEnabled && (
        <>
          <button className="btn" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
            Sign up with Google
          </button>
          <div className="muted small" style={{ textAlign: "center" }}>or</div>
        </>
      )}
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">Name<input className="input" name="name" required maxLength={80} autoComplete="name" /></label>
        <label className="field">Email<input className="input" name="email" type="email" required autoComplete="email" /></label>
        <label className="field">Password<input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating..." : "Create account"}</button>
      </form>
      <div className="small muted">Already have an account? <Link href="/login" style={{ color: "var(--text)" }}>Sign in</Link></div>
    </Shell>
  );
}

export function ForgotForm() {
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await postJson("/api/auth/forgot", { email: new FormData(e.currentTarget).get("email") });
      setOk(data.message ?? "Check your inbox.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Reset your password" subtitle="We'll email you a link that expires in one hour.">
      <Msg error={error} ok={ok} />
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">Email<input className="input" name="email" type="email" required /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending..." : "Send reset link"}</button>
      </form>
      <Link href="/login" className="small muted">Back to sign in</Link>
    </Shell>
  );
}

export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson("/api/auth/reset", { token, password: new FormData(e.currentTarget).get("password") });
      router.push("/login?verified=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Choose a new password">
      <Msg error={error || (token ? "" : "This reset link is missing its token.")} />
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">New password<input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <button className="btn btn-primary" disabled={busy || !token}>{busy ? "Saving..." : "Update password"}</button>
      </form>
    </Shell>
  );
}
