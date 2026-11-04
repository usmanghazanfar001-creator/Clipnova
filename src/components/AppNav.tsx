"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export function AppNav({ name, workspace, credits }: { name: string; workspace: string; credits: number }) {
  return (
    <nav className="nav">
      <div className="container">
        <Link href="/dashboard" className="logo">
          Clip<span>nova</span>
        </Link>
        <div className="row">
          <span className="badge" title="Each uploaded video uses one credit">{credits} credit{credits === 1 ? "" : "s"}</span>
          <span className="muted small" style={{ whiteSpace: "nowrap" }}>{name} · {workspace}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>
        </div>
      </div>
    </nav>
  );
}
