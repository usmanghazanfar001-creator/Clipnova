export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  UPLOADING: "Uploading",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  TRANSCRIBING: "Transcribing",
  ANALYZING: "Analyzing",
  READY_FOR_REVIEW: "Ready for review",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
  EXPIRED: "Expired",
};

export const ACTIVE_STATUSES = new Set(["UPLOADING", "QUEUED", "PROCESSING", "TRANSCRIBING", "ANALYZING", "RENDERING"]);

export function statusTone(status: string): "ok" | "busy" | "fail" | "" {
  if (status === "FAILED" || status === "EXPIRED") return "fail";
  if (ACTIVE_STATUSES.has(status)) return "busy";
  if (status === "READY_FOR_REVIEW" || status === "COMPLETED") return "ok";
  return "";
}

export const PIPELINE = ["QUEUED", "PROCESSING", "TRANSCRIBING", "ANALYZING", "READY_FOR_REVIEW"] as const;

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
