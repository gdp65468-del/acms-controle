const paths = {
  dashboard: (
    <>
      <rect x="3" y="11" width="4" height="8" rx="1.2" />
      <rect x="10" y="7" width="4" height="12" rx="1.2" />
      <rect x="17" y="4" width="4" height="15" rx="1.2" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M16 10h5v4h-5a2 2 0 1 1 0-4Z" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l1.8 2H18.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V6" />
      <path d="m8 10 4-4 4 4" />
      <path d="M5 18h14" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m6 16 4-4 3 3 2-2 3 3" />
    </>
  ),
  fileText: (
    <>
      <path d="M8 4h6l4 4v12H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M14 4v4h4" />
      <path d="M10 12h6M10 15h6" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.4-2h7.2L17 8h3a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 18H4A1.5 1.5 0 0 1 2.5 16.5v-7A1.5 1.5 0 0 1 4 8Z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 20 19H4Z" />
      <path d="M12 9v4.5" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.3 2.4 4.8-5.1" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.7v6.6l5.4-3.3Z" fill="currentColor" stroke="none" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <rect x="9" y="8.4" width="2.4" height="7.2" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="12.6" y="8.4" width="2.4" height="7.2" rx="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  acms: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.2" />
      <path d="M5.5 18a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </>
  ),
  list: (
    <>
      <path d="M8 7h12" />
      <path d="M8 12h12" />
      <path d="M8 17h12" />
      <circle cx="4.5" cy="7" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  edit: (
    <>
      <path d="m4 20 4.5-1 9-9-3.5-3.5-9 9Z" />
      <path d="m13.5 6.5 3.5 3.5" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7l.8 12h6.4L16 7" />
    </>
  ),
  restore: (
    <>
      <path d="M7 11a5 5 0 1 1 1.6 3.7" />
      <path d="M4.5 12h4v-4" />
    </>
  ),
  move: (
    <>
      <path d="M4 12h16" />
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M8 11h6" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 5v5h-5" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="M14.5 5.5 8 12l6.5 6.5M9 12h10" />,
  bell: (
    <>
      <path d="M12 4a4 4 0 0 0-4 4v2.5c0 .7-.2 1.4-.6 2L6 15h12l-1.4-2.5c-.4-.6-.6-1.3-.6-2V8a4 4 0 0 0-4-4Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V4h10v4" />
      <rect x="6" y="13" width="12" height="7" rx="1.5" />
      <rect x="4" y="8" width="16" height="7" rx="2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M7 11a5 5 0 0 0 10 0M12 16v4M9 20h6" />
    </>
  ),
  lock: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M8.5 11V8.8a3.5 3.5 0 0 1 7 0V11" />
    </>
  )
};

export function Icon({ name, size = 20, className = "" }) {
  const glyph = paths[name];
  if (!glyph) return null;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
