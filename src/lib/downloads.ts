import { getEnv } from "./env";
import { signedPath } from "./signing";

export const DOWNLOAD_TTL_SEC = 10 * 60;

// Derived so the download-signing key is distinct from the session secret.
export function downloadSecret() {
  return `dl:${getEnv().NEXTAUTH_SECRET}`;
}

export const renderDownloadPath = (renderId: string) => `/api/download/render/${renderId}`;
export const zipDownloadPath = (projectId: string) => `/api/download/zip/${projectId}`;

export function signDownload(path: string) {
  return signedPath(path, DOWNLOAD_TTL_SEC, downloadSecret());
}
