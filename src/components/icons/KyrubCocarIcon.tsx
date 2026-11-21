import type { SVGProps } from 'react';

/** Small, symmetrical feather headdress: distinct from the XP trophy icon. */
export function KyrubCocarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 15c-.6-2.8-1.5-6.9 0-12.5 1.5 5.6.6 9.7 0 12.5Z" />
      <path d="M9 15C7.1 12.6 4.5 8.8 4 4.4c3.6 2.2 5 6.4 5 10.6Z" />
      <path d="M15 15c1.9-2.4 4.5-6.2 5-10.6-3.6 2.2-5 6.4-5 10.6Z" />
      <path d="M6.5 15C4.6 13.2 2.7 10 2.3 7.8c3.1 1.7 5 4.1 5.3 7.2Z" />
      <path d="M17.5 15c1.9-1.8 3.8-5 4.2-7.2-3.1 1.7-5 4.1-5.3 7.2Z" />
      <path d="M4.3 15.3c4.8-1.2 10.6-1.2 15.4 0v4.1c-4.8-1.4-10.6-1.4-15.4 0v-4.1Z" />
      <path d="M8 15.3v3.2M12 14.8v4M16 15.3v3.2M5.5 21c3.8-1 9.2-1 13 0" />
    </svg>
  );
}
