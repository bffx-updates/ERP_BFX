import type { SVGProps } from "react";

// Um pedal visto de cima: chassi, tela e dois footswitches. Mesmo traço dos ícones Lucide.
export function IconePedal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <rect x="7.5" y="5.5" width="9" height="5" rx="1" />
      <circle cx="8.75" cy="16" r="1.75" />
      <circle cx="15.25" cy="16" r="1.75" />
    </svg>
  );
}
