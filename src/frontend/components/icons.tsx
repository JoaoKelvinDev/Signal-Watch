import type { ReactNode } from "react";

type IconName =
  | "radar"
  | "grid"
  | "community"
  | "arrow"
  | "search"
  | "refresh"
  | "sun"
  | "moon"
  | "source"
  | "chevron";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<Exclude<IconName, "radar">, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    community: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4Z" />
        <path d="M8 11h8M8 15h5" />
      </>
    ),
    arrow: <path d="M7 17 17 7M7 7h10v10" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
      </>
    ),
    moon: <path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z" />,
    source: (
      <path d="M4 21V7l8-4 8 4v14H4ZM8 9v2M12 9v2M16 9v2M8 14v2M12 14v2M16 14v2M10 21v-3h4v3" />
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "radar" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <path d="M12 12 19 5M12 3v2M3 12h2M12 19v2M19 12h2" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </>
      ) : (
        paths[name]
      )}
    </svg>
  );
}
