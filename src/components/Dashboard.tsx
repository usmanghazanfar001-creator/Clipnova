"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ProjectDTO } from "@/lib/serialize";
import { ACTIVE_STATUSES, STATUS_LABEL, statusTone } from "@/lib/status";

const EXTS = [".mp4", ".mov", ".webm", ".mkv"];
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska" };

function fmtSize(bytes: number | null) {
  if (bytes === null) return "";
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function fmtDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("Network error during upload. Please try again."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.send(file);
  });
}

export function Dashboard({
  initialProjects,
  canEdit,
  canDelete,
  maxUploadMb,
  blobUploads,
  maxMinutes,
}: {
  initialProjects: ProjectDTO[];
  canEdit: boolean;
  canDelete: boolean;
  maxUploadMb: number;
  blobUploads: boolean;
  maxMinutes: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [projects, setProjects] = useState(initialProjects);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (which: "active" | "archived") => {
    const res = await fetch(`/api/projects${which === "archived" ? "?archived=1" : ""}`);
    if (res.ok) setProjects(((await res.json()) as { projects: ProjectDTO[] }).projects);
  }, []);

  useEffect(() => {
    if (tab === "archived") void load("archived");
  }, [tab, load]);

  // Poll while anything is processing.
  const anyActive = projects.some((p) => ACTIVE_STATUSES.has(p.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void load(tab), 4000);
    return () => clearInterval(t);
  }, [anyActive, tab, load]);

  async function act(p: ProjectDTO, action: "rename" | "archive" | "unarchive" | "duplicate" | "delete") {
    setError("");
    let res: Response | undefined;
    if (action === "rename") {
      const name = window.prompt("Rename project", p.name)?.trim();
      if (!name || name === p.name) return;
      res = await fetch(`/api/projects/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    } else if (action === "archive" || action === "unarchive") {
      res = await fetch(`/api/projects/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: action === "archive" }) });
    } else if (action === "duplicate") {
      res = await fetch(`/api/projects/${p.id}/duplicate`, { method: "POST" });
    } else {
      if (!window.confirm(`Delete "${p.name}" and its video, transcript and clips? This can't be undone.`)) return;
      res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    }
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `That didn't work (server error ${res.status}).`);
      return;
    }
    await load(tab);
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between wrap">
        <div>
          <h1 style={{ fontSize: "1.8rem" }}>Projects</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            MP4, MOV, WEBM or MKV · up to {maxUploadMb} MB and {maxMinutes} minutes
          </p>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New project</button>}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>Active</button>
        <button className={`tab ${tab === "archived" ? "active" : ""}`} onClick={() => setTab("archived")}>Archived</button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      {projects.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <h3>{tab === "active" ? "No projects yet" : "Nothing archived"}</h3>
          {tab === "active" && canEdit && (
            <p className="muted">Upload a long video and get your first clips in minutes.</p>
          )}
        </div>
      ) : (
        <div className="projects">
          {projects.map((p) => (
            <div className="card hover stack" key={p.id} style={{ gap: 10 }}>
              <Link href={`/projects/${p.id}`} className="stack" style={{ gap: 8 }}>
                <div className="row between">
                  <h3 style={{ fontSize: "1.05rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</h3>
                  <span className={`badge ${statusTone(p.status)}`}><span className="dot" />{STATUS_LABEL[p.status]}</span>
                </div>
                <div className="muted small">
                  {[p.originalFilename, fmtDuration(p.durationSec), fmtSize(p.sizeBytes)].filter(Boolean).join(" · ") || "No video yet"}
                </div>
                {p.status === "FAILED" && p.errorMessage && <div className="small" style={{ color: "var(--danger)" }}>{p.errorMessage}</div>}
              </Link>
              {canEdit && (
                <div className="row wrap">
                  <button className="btn btn-sm" onClick={() => act(p, "rename")}>Rename</button>
                  <button className="btn btn-sm" onClick={() => act(p, "duplicate")}>Duplicate</button>
                  <button className="btn btn-sm" onClick={() => act(p, p.archived ? "unarchive" : "archive")}>{p.archived ? "Restore" : "Archive"}</button>
                  {canDelete && <button className="btn btn-sm btn-danger" onClick={() => act(p, "delete")}>Delete</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && <NewProject maxUploadMb={maxUploadMb} blobUploads={blobUploads} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewProject({ maxUploadMb, blobUploads, onClose }: { maxUploadMb: number; blobUploads: boolean; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pct, setPct] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a video file.");
    if (!EXTS.some((x) => file.name.toLowerCase().endsWith(x))) return setError("Unsupported file type. Use MP4, MOV, WEBM or MKV.");
    if (file.size > maxUploadMb * 1024 * 1024) return setError(`That file is larger than ${maxUploadMb} MB.`);

    setPct(0);
    try {
      let id = createdId;
      if (!id) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: String(f.get("name")), desiredClips: Number(f.get("clips")) }),
        });
        const data = (await res.json()) as { project?: { id: string }; error?: string };
        if (!res.ok || !data.project) throw new Error(data.error ?? "Couldn't create the project.");
        id = data.project.id;
        setCreatedId(id);
      }
      if (blobUploads) {
        // Direct browser-to-Blob upload (bypasses Vercel's 4.5 MB request limit), then finalize.
        const ext = EXTS.find((x) => file.name.toLowerCase().endsWith(x))!;
        await upload(`projects/${id}/source${ext}`, file, {
          access: "private",
          handleUploadUrl: `/api/projects/${id}/upload/blob`,
          contentType: MIME[ext],
          multipart: true,
          onUploadProgress: ({ percentage }) => setPct(Math.min(99, Math.round(percentage))),
        });
        const done = await fetch(`/api/projects/${id}/upload/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name }),
        });
        if (!done.ok) {
          throw new Error(((await done.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't finish the upload.");
        }
        setPct(100);
      } else {
        await uploadWithProgress(`/api/projects/${id}/upload`, file, setPct);
      }
      router.push(`/projects/${id}`);
    } catch (err) {
      setPct(null);
      setError((err as Error).message);
    }
  }

  const uploading = pct !== null;
  return (
    <div className="modal-bg" onClick={() => !uploading && onClose()}>
      <form className="card modal stack" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} style={{ gap: 14 }}>
        <h2>New project</h2>
        {error && <div className="alert error" role="alert">{error}</div>}
        <label className="field">Project name<input className="input" name="name" required maxLength={120} placeholder="Episode 42 - Founder story" disabled={uploading || !!createdId} /></label>
        <label className="field">Video file<input ref={fileRef} className="input" type="file" accept=".mp4,.mov,.webm,.mkv,video/*" required disabled={uploading} /></label>
        <label className="field">Clips to suggest
          <select className="input" name="clips" defaultValue="5" disabled={uploading || !!createdId}>
            {[3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        {uploading && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <div className="muted small">{pct === 100 ? "Finishing up..." : `Uploading ${pct}%`}</div>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn btn-primary" disabled={uploading}>{createdId ? "Retry upload" : "Upload & process"}</button>
        </div>
      </form>
    </div>
  );
}
