"use client";
import { useSyncExternalStore } from "react";
import { emptyLibrary, getLibrary, subscribeLibrary } from "./library-store";
export function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrary, () => emptyLibrary);
}
