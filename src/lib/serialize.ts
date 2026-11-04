import type { Clip, Project } from "@prisma/client";

export function serializeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    errorMessage: p.errorMessage,
    originalFilename: p.originalFilename,
    sizeBytes: p.sizeBytes === null ? null : Number(p.sizeBytes), // BigInt is not JSON-safe
    durationSec: p.durationSec,
    desiredClips: p.desiredClips,
    archived: p.archivedAt !== null,
    hasVideo: p.sourceExt !== null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeClip(c: Clip) {
  return {
    id: c.id,
    startSec: c.startSec,
    endSec: c.endSec,
    title: c.title,
    hook: c.hook,
    summary: c.summary,
    reason: c.reason,
    platform: c.platform,
    confidence: c.confidence,
    captionText: c.captionText,
    selected: c.selected,
    style: c.style,
  };
}

export type ProjectDTO = ReturnType<typeof serializeProject>;
export type ClipDTO = ReturnType<typeof serializeClip>;
