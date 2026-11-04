"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipDTO, ProjectDTO } from "@/lib/serialize";
import { ACTIVE_STATUSES, PIPELINE, STATUS_LABEL, formatTime, statusTone } from "@/lib/status";

type Segment = { id: number; start: number; end: number; text: string };
type Data = {
  project: ProjectDTO;
  clips: ClipDTO[];
  transcript: { language: string | null; segments: Segment[] } | null;
  canEdit: boolean;
};

type Style = {
  captionPosition: "top" | "middle" | "bottom";
  fontSize: number;
  fontColor: string;
  highlightColor: string;
  background: "none" | "box" | "shadow";
  cropMode: "center" | "manual" | "blur-pillarbox";
  cropPosition: number;
  aspect: "9:16" | "4:5" | "1:1";
};

const DEFAULT_STYLE: Style = {
  captionPosition: "bottom",
  fontSize: 56,
  fontColor: "#ffffff",
  highlightColor: "#fbbf24",
  background: "box",
  cropMode: "center",
  cropPosition: 50,
  aspect: "9:16",
};

const PLATFORM_LABEL: Record<string, string> = {
  YOUTUBE_SHORTS: "YouTube Shorts",
  INSTAGRAM_REELS: "Instagram Reels",
  TIKTOK: "TikTok",
  ALL: "All platforms",
};

type Preview = { id: string; start: number; end: number; text: string; style: Style };

type RenderDTO = {
  id: string;
  clipId: string;
  status: "QUEUED" | "RENDERING" | "DONE" | "FAILED" | "EXPIRED";
  error: string | null;
  aspect: string;
  sizeBytes: number | null;
  downloadUrl: string | null;
};
type RendersResponse = { renders: RenderDTO[]; zipUrl: string | null };

const RENDER_LABEL: Record<RenderDTO["status"], string> = {
  QUEUED: "Queued",
  RENDERING: "Rendering",
  DONE: "Ready",
  FAILED: "Render failed",
  EXPIRED: "Expired",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function ProjectView({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"clips" | "transcript">("clips");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState("");
  const [regenCount, setRegenCount] = useState(5);
  const [renders, setRenders] = useState<RendersResponse>({ renders: [], zipUrl: null });
  const [startingRender, setStartingRender] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

  const load = useCallback(async () => {
    try {
      const d = await api<Data>(`/api/projects/${projectId}`);
      setData(d);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = data?.project.status;
  useEffect(() => {
    if (!status || !ACTIVE_STATUSES.has(status)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [status, load]);

  const loadRenders = useCallback(async () => {
    try {
      setRenders(await api<RendersResponse>(`/api/projects/${projectId}/renders`));
    } catch {
      /* keep the last known state; the next poll will retry */
    }
  }, [projectId]);

  const canShowRenders = status === "READY_FOR_REVIEW" || status === "RENDERING" || status === "COMPLETED";
  useEffect(() => {
    if (canShowRenders) void loadRenders();
  }, [canShowRenders, loadRenders]);

  // Poll quickly while anything is rendering; otherwise refresh slowly so the short-lived
  // signed download links never go stale while the page stays open.
  const rendering = renders.renders.some((r) => r.status === "QUEUED" || r.status === "RENDERING");
  useEffect(() => {
    if (!canShowRenders) return;
    const t = setInterval(() => void loadRenders(), rendering ? 3000 : 4 * 60 * 1000);
    return () => clearInterval(t);
  }, [canShowRenders, rendering, loadRenders]);

  useEffect(() => {
    if (data) setRegenCount(data.project.desiredClips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.project.desiredClips]);

  function startPreview(p: Preview) {
    const v = videoRef.current;
    if (!v) return;
    setPreview(p);
    v.currentTime = p.start;
    void v.play();
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    const p = previewRef.current;
    if (v && p && v.currentTime >= p.end) {
      v.pause();
      setPreview(null);
    }
  }

  async function runProcess(mode: "retry" | "reanalyze") {
    if (mode === "reanalyze" && !window.confirm("Regenerate suggestions? This replaces the current clips, including any edits.")) return;
    setNotice("");
    try {
      await api(`/api/projects/${projectId}/process`, json("POST", { mode, clipCount: regenCount }));
      setPreview(null);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function startRender() {
    setNotice("");
    setStartingRender(true);
    try {
      await api(`/api/projects/${projectId}/renders`, json("POST", {}));
      await Promise.all([load(), loadRenders()]);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setStartingRender(false);
    }
  }

  const clipRanges = useMemo(() => data?.clips ?? [], [data?.clips]);

  if (loadError && !data) return <div className="alert error">{loadError}</div>;
  if (!data) return <div className="muted">Loading...</div>;

  const { project, clips, transcript, canEdit } = data;
  const busy = ACTIVE_STATUSES.has(project.status);
  const ready = project.status === "READY_FOR_REVIEW" || project.status === "COMPLETED" || project.status === "RENDERING";
  const pipelineBusy = busy && project.status !== "RENDERING";
  const renderByClip = new Map(renders.renders.map((r) => [r.clipId, r]));
  const duration = project.durationSec ?? 0;
  const stepIndex = PIPELINE.indexOf(project.status as (typeof PIPELINE)[number]);
  const selectedCount = clips.filter((c) => c.selected).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between wrap">
        <div className="stack" style={{ gap: 6 }}>
          <Link href="/dashboard" className="muted small">&larr; All projects</Link>
          <div className="row wrap">
            <h1 style={{ fontSize: "1.7rem" }}>{project.name}</h1>
            <span className={`badge ${statusTone(project.status)}`}><span className="dot" />{STATUS_LABEL[project.status]}</span>
          </div>
        </div>
        {ready && (
          <div className="row wrap">
            {renders.zipUrl && <a className="btn" href={renders.zipUrl}>Download all (ZIP)</a>}
            {canEdit && (
              <button
                className="btn btn-primary"
                disabled={startingRender || rendering || selectedCount === 0}
                onClick={startRender}
                title="Saved edits are used. Unsaved changes in the editor are not included."
              >
                {rendering ? "Rendering..." : startingRender ? "Starting..." : `Render ${selectedCount} selected`}
              </button>
            )}
          </div>
        )}
      </div>

      {notice && <div className="alert error" role="alert">{notice}</div>}

      {pipelineBusy && (
        <div className="card stack">
          <div className="steps">
            {PIPELINE.slice(0, -1).map((s, i) => (
              <span key={s} className={`step ${i < stepIndex ? "done" : i === stepIndex ? "now" : ""}`}>{STATUS_LABEL[s]}</span>
            ))}
          </div>
          <div className="muted small">
            {project.status === "UPLOADING"
              ? "Your video is uploading..."
              : "Working on your video. You can leave this page - it keeps going and this updates automatically."}
          </div>
          {project.status === "QUEUED" && canEdit && project.hasVideo && (
            <div className="row wrap small">
              <span className="muted">Waiting for a long time? The worker may have been offline.</span>
              <button className="btn btn-sm" onClick={() => runProcess("retry")}>Queue again</button>
            </div>
          )}
        </div>
      )}

      {project.status === "FAILED" && (
        <div className="alert error stack" role="alert">
          <strong>Processing failed</strong>
          <span>{project.errorMessage ?? "Something went wrong."}</span>
          {canEdit && project.hasVideo && <div><button className="btn btn-sm" onClick={() => runProcess("retry")}>Retry</button></div>}
          {canEdit && !project.hasVideo && <span className="small">Go back to the dashboard and start a new upload.</span>}
        </div>
      )}

      {project.status === "DRAFT" && (
        <div className="card">This project has no video yet. <Link href="/dashboard" style={{ textDecoration: "underline" }}>Upload one from the dashboard.</Link></div>
      )}

      {ready && (
        <div className="editor">
          <div className="sticky stack" style={{ gap: 0 }}>
            <div className="player">
              <video ref={videoRef} src={`/api/projects/${projectId}/video`} controls preload="metadata" onTimeUpdate={onTimeUpdate} />
              {preview && (
                <div
                  className={`caption-overlay ${preview.style.background === "box" ? "box" : ""}`}
                  style={{
                    ...(preview.style.captionPosition === "bottom"
                      ? { bottom: "14%" }
                      : { top: preview.style.captionPosition === "middle" ? "45%" : "14%" }),
                    color: preview.style.fontColor,
                    fontSize: Math.max(12, preview.style.fontSize / 3.2),
                    textShadow: preview.style.background === "none" ? "none" : undefined,
                  }}
                >
                  <span>{preview.text}</span>
                </div>
              )}
            </div>
            {duration > 0 && clipRanges.length > 0 && (
              <div className="timeline" aria-label="Clip timeline">
                {clipRanges.map((c) => (
                  <button
                    key={c.id}
                    title={c.title}
                    className={`${c.selected ? "" : "off"} ${preview?.id === c.id ? "active" : ""}`}
                    style={{ left: `${(c.startSec / duration) * 100}%`, width: `${((c.endSec - c.startSec) / duration) * 100}%` }}
                    onClick={() =>
                      startPreview({ id: c.id, start: c.startSec, end: c.endSec, text: c.captionText || c.hook, style: { ...DEFAULT_STYLE, ...((c.style as Partial<Style> | null) ?? {}) } })
                    }
                  />
                ))}
              </div>
            )}
            <div className="muted small" style={{ marginTop: 8 }}>
              Caption preview is approximate; the final render burns captions in with FFmpeg.
            </div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div className="tabs">
              <button className={`tab ${tab === "clips" ? "active" : ""}`} onClick={() => setTab("clips")}>Suggested clips ({clips.length})</button>
              <button className={`tab ${tab === "transcript" ? "active" : ""}`} onClick={() => setTab("transcript")}>Transcript</button>
            </div>

            {tab === "clips" && (
              <>
                {canEdit && (
                  <div className="row wrap">
                    <label className="row small muted">Clips
                      <select className="input" style={{ width: 70 }} value={regenCount} onChange={(e) => setRegenCount(Number(e.target.value))}>
                        {[3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}
                      </select>
                    </label>
                    <button className="btn btn-sm" onClick={() => runProcess("reanalyze")}>Regenerate suggestions</button>
                  </div>
                )}
                {clips.map((c) => (
                  <ClipCard
                    key={c.id}
                    projectId={projectId}
                    clip={c}
                    duration={duration}
                    canEdit={canEdit}
                    active={preview?.id === c.id}
                    render={renderByClip.get(c.id)}
                    onPreview={startPreview}
                    onSaved={(saved) => setData((d) => d && { ...d, clips: d.clips.map((x) => (x.id === saved.id ? saved : x)) })}
                  />
                ))}
              </>
            )}

            {tab === "transcript" && transcript && (
              <TranscriptEditor
                projectId={projectId}
                segments={transcript.segments}
                language={transcript.language}
                canEdit={canEdit}
                onSaved={(segments) => setData((d) => d && d.transcript && { ...d, transcript: { ...d.transcript, segments } })}
                onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t; }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClipCard({
  projectId,
  clip,
  duration,
  canEdit,
  active,
  render,
  onPreview,
  onSaved,
}: {
  projectId: string;
  clip: ClipDTO;
  duration: number;
  canEdit: boolean;
  active: boolean;
  render?: RenderDTO;
  onPreview: (p: Preview) => void;
  onSaved: (c: ClipDTO) => void;
}) {
  const initial = useMemo(
    () => ({
      title: clip.title,
      hook: clip.hook,
      captionText: clip.captionText ?? "",
      start: String(clip.startSec),
      end: String(clip.endSec),
      style: { ...DEFAULT_STYLE, ...((clip.style as Partial<Style> | null) ?? {}) } as Style,
    }),
    [clip],
  );
  const [d, setD] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setD(initial), [initial]);

  const start = parseFloat(d.start);
  const end = parseFloat(d.end);
  const len = end - start;
  const lenOk = Number.isFinite(len) && len >= 10 && len <= 90 && start >= 0 && end <= duration + 1e-6;
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const setStyle = (patch: Partial<Style>) => setD((x) => ({ ...x, style: { ...x.style, ...patch } }));

  function preset(p: number) {
    let s = Number.isFinite(start) ? start : 0;
    let e = s + p;
    if (e > duration) {
      e = duration;
      s = Math.max(0, duration - p);
    }
    set({ start: s.toFixed(1), end: e.toFixed(1) });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await api<{ clip: ClipDTO }>(`/api/projects/${projectId}/clips/${clip.id}`, json("PATCH", {
        title: d.title,
        hook: d.hook,
        captionText: d.captionText.trim() ? d.captionText : null,
        startSec: start,
        endSec: end,
        style: d.style,
      }));
      onSaved(r.clip);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(selected: boolean) {
    setError("");
    try {
      const r = await api<{ clip: ClipDTO }>(`/api/projects/${projectId}/clips/${clip.id}`, json("PATCH", { selected }));
      onSaved(r.clip);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card stack" style={{ gap: 12, borderColor: active ? "var(--accent)" : undefined, opacity: clip.selected ? 1 : 0.65 }}>
      <div className="row between wrap">
        <label className="row" style={{ cursor: canEdit ? "pointer" : "default" }}>
          <input type="checkbox" checked={clip.selected} disabled={!canEdit} onChange={(e) => toggle(e.target.checked)} />
          <strong>{clip.title}</strong>
        </label>
        <div className="row small muted">
          <span>{PLATFORM_LABEL[clip.platform]}</span>
          <span className="badge ok">{Math.round(clip.confidence * 100)}% confidence</span>
        </div>
      </div>
      <p style={{ margin: 0 }}><span className="muted small">Hook:</span> {clip.hook}</p>
      {clip.summary && <p className="muted small" style={{ margin: 0 }}>{clip.summary}</p>}
      {clip.reason && <p className="small" style={{ margin: 0 }}><span className="muted">Why it may perform:</span> {clip.reason}</p>}

      <div className="row wrap">
        <button className="btn btn-sm" onClick={() => onPreview({ id: clip.id, start: Number.isFinite(start) ? start : clip.startSec, end: Number.isFinite(end) ? end : clip.endSec, text: d.captionText || d.hook, style: d.style })}>
          &#9654; Preview {formatTime(clip.startSec)} - {formatTime(clip.endSec)}
        </button>
        <span className={`dur ${lenOk ? "" : "bad"}`}>{Number.isFinite(len) ? `${len.toFixed(1)}s` : "-"}</span>
        {!lenOk && <span className="small" style={{ color: "var(--danger)" }}>Clips must be 10-90s and inside the video.</span>}
        {canEdit && <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide editor" : "Edit clip"}</button>}
      </div>

      {render && (
        <div className="row wrap small">
          <span className={`badge ${render.status === "DONE" ? "ok" : render.status === "FAILED" || render.status === "EXPIRED" ? "fail" : "busy"}`}>
            <span className="dot" />{RENDER_LABEL[render.status]}{render.status === "DONE" ? ` · ${render.aspect}` : ""}
          </span>
          {render.downloadUrl && (
            <a className="btn btn-sm" href={render.downloadUrl}>
              Download MP4{render.sizeBytes ? ` (${(render.sizeBytes / 1024 ** 2).toFixed(1)} MB)` : ""}
            </a>
          )}
          {render.status === "FAILED" && render.error && <span style={{ color: "var(--danger)" }}>{render.error}</span>}
          {render.status === "EXPIRED" && <span className="muted">Download expired. Render again to get a new file.</span>}
        </div>
      )}

      {open && canEdit && (
        <div className="stack" style={{ gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="form-grid">
            <label className="field">Start (s)<input className="input" type="number" step="0.1" min="0" value={d.start} onChange={(e) => set({ start: e.target.value })} /></label>
            <label className="field">End (s)<input className="input" type="number" step="0.1" min="0" value={d.end} onChange={(e) => set({ end: e.target.value })} /></label>
          </div>
          <div className="row wrap">
            <span className="muted small">Target length</span>
            {[15, 30, 45, 60].map((p) => <button key={p} className="chip" onClick={() => preset(p)}>{p}s</button>)}
          </div>
          <label className="field">Title<input className="input" value={d.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field">Hook text<input className="input" value={d.hook} maxLength={200} onChange={(e) => set({ hook: e.target.value })} /></label>
          <label className="field">Caption text (leave empty to use the transcript)<textarea className="input" value={d.captionText} maxLength={2000} onChange={(e) => set({ captionText: e.target.value })} /></label>
          <div className="form-grid">
            <label className="field">Caption position
              <select className="input" value={d.style.captionPosition} onChange={(e) => setStyle({ captionPosition: e.target.value as Style["captionPosition"] })}>
                <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
              </select>
            </label>
            <label className="field">Font size<input className="input" type="number" min={16} max={120} value={d.style.fontSize} onChange={(e) => setStyle({ fontSize: Math.min(120, Math.max(16, Number(e.target.value) || 56)) })} /></label>
            <label className="field">Font color<input className="input" type="color" value={d.style.fontColor} onChange={(e) => setStyle({ fontColor: e.target.value })} /></label>
            <label className="field">Highlight color<input className="input" type="color" value={d.style.highlightColor} onChange={(e) => setStyle({ highlightColor: e.target.value })} /></label>
            <label className="field">Background
              <select className="input" value={d.style.background} onChange={(e) => setStyle({ background: e.target.value as Style["background"] })}>
                <option value="none">None</option><option value="box">Box</option><option value="shadow">Shadow</option>
              </select>
            </label>
            <label className="field">Aspect ratio
              <select className="input" value={d.style.aspect} onChange={(e) => setStyle({ aspect: e.target.value as Style["aspect"] })}>
                <option value="9:16">9:16 (1080x1920)</option><option value="4:5">4:5 (1080x1350)</option><option value="1:1">1:1 (1080x1080)</option>
              </select>
            </label>
            <label className="field">Reframing
              <select className="input" value={d.style.cropMode} onChange={(e) => setStyle({ cropMode: e.target.value as Style["cropMode"] })}>
                <option value="center">Center crop</option><option value="manual">Manual crop</option><option value="blur-pillarbox">Blurred background</option>
              </select>
            </label>
            {d.style.cropMode === "manual" && (
              <label className="field">Crop position ({d.style.cropPosition}%)
                <input type="range" min={0} max={100} value={d.style.cropPosition} onChange={(e) => setStyle({ cropPosition: Number(e.target.value) })} />
              </label>
            )}
          </div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setD(initial)}>Reset</button>
            <button className="btn btn-primary" disabled={!dirty || saving || !lenOk} onClick={save}>{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </div>
      )}
      {!open && error && <div className="alert error" role="alert">{error}</div>}
    </div>
  );
}

function TranscriptEditor({
  projectId,
  segments,
  language,
  canEdit,
  onSaved,
  onSeek,
}: {
  projectId: string;
  segments: Segment[];
  language: string | null;
  canEdit: boolean;
  onSaved: (s: Segment[]) => void;
  onSeek: (t: number) => void;
}) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const count = Object.keys(edits).length;

  async function save() {
    setSaving(true);
    setMsg({});
    try {
      const r = await api<{ segments: Segment[] }>(`/api/projects/${projectId}/transcript`, json("PATCH", {
        segments: Object.entries(edits).map(([id, text]) => ({ id: Number(id), text })),
      }));
      onSaved(r.segments);
      setEdits({});
      setMsg({ ok: "Transcript saved. Use \"Regenerate suggestions\" to re-run clip detection on your edits." });
    } catch (e) {
      setMsg({ error: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <span className="muted small">{language ? `Language: ${language} · ` : ""}{segments.length} segments</span>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={!count || saving} onClick={save}>{saving ? "Saving..." : `Save ${count || ""} change${count === 1 ? "" : "s"}`}</button>}
      </div>
      {msg.error && <div className="alert error" role="alert">{msg.error}</div>}
      {msg.ok && <div className="alert success" role="status">{msg.ok}</div>}
      <div className="stack" style={{ gap: 8 }}>
        {segments.map((s) => (
          <div className="seg" key={s.id}>
            <button className="t" style={{ background: "none", border: 0, cursor: "pointer", textAlign: "left" }} onClick={() => onSeek(s.start)}>{formatTime(s.start)}</button>
            {canEdit ? (
              <textarea className="input" rows={2} value={edits[s.id] ?? s.text} onChange={(e) => setEdits((x) => ({ ...x, [s.id]: e.target.value }))} />
            ) : (
              <p style={{ margin: 0 }}>{s.text}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
