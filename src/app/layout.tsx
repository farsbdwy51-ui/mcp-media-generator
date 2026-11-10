import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "مولّد الوسائط MCP — لوحة الإدارة",
  description: "خادم MCP لتوليد الصور والفيديو بالذكاء الاصطناعي مع تبديل تلقائي للمفاتيح ودمج المقاطع.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground" style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
