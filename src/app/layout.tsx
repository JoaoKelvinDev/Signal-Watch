import type { ReactNode } from "react";
import "../frontend/styles/globals.css";

export const metadata = {
  title: "Radar de IA e Tecnologia",
  description:
    "Notícias, lançamentos e discussões de inteligência artificial, com fontes identificadas.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
