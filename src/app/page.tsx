import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) redirect("/dashboard");

  return (
    <>
      <nav className="nav">
        <div className="container">
          <Link href="/" className="logo">
            Clip<span>nova</span>
          </Link>
          <div className="row">
            <Link href="/login" className="btn btn-ghost">Sign in</Link>
            <Link href="/register" className="btn btn-primary">Get started</Link>
          </div>
        </div>
      </nav>
      <main className="container">
        <section className="hero">
          <h1>
            Upload once.
            <br />
            <span className="grad">Get scroll-stopping shorts in minutes.</span>
          </h1>
          <p className="muted" style={{ maxWidth: 560, margin: "20px auto 28px", fontSize: "1.1rem" }}>
            Clipnova turns long podcasts, talks and tutorials into vertical clips with the best moments already picked
            out for YouTube Shorts, Instagram Reels and TikTok.
          </p>
          <Link href="/register" className="btn btn-primary" style={{ padding: "12px 24px", fontSize: "1rem" }}>
            Start for free
          </Link>
        </section>
        <section className="features">
          {[
            ["Accurate transcripts", "Word-timestamped transcription powered by Whisper on Groq, fully editable."],
            ["AI highlight detection", "3-8 clip candidates with titles, hooks and a reason each one should perform."],
            ["Your edit, your call", "Trim to the frame, rewrite hooks and review every suggestion before export."],
          ].map(([t, d]) => (
            <div className="card" key={t}>
              <h3 style={{ marginBottom: 8 }}>{t}</h3>
              <p className="muted" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
