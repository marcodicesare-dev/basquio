import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./global.css";

export const metadata: Metadata = {
  title: "Basquio",
  description: "Intelligence-first presentation generation scaffold",
  icons: {
    icon: "/brand/svg/favicon/basquio-favicon.svg",
    shortcut: "/brand/png/favicon/basquio-favicon-32.png",
    apple: "/brand/png/favicon/basquio-favicon-192.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site-wrap">{children}</div>
      </body>
    </html>
  );
}
