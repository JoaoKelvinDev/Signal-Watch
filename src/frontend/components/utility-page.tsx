"use client";
import type { ReactNode } from "react";
import { useLibrary } from "../use-library";
export function UtilityPage({ children }: { children: ReactNode }) {
  const library = useLibrary();
  return (
    <main className={`utility-page${library.theme === "light" ? " utility-light" : ""}`}>
      {children}
    </main>
  );
}
