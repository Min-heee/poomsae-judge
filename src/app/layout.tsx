import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "품새 판정기",
  description:
    "브라우저에서 관절 좌표를 읽어 태권도 기본 동작을 공개된 규칙으로 채점하고, 근거를 그대로 보여 주는 웹 데모.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0e13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
