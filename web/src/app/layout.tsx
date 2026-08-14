import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import localFont from "next/font/local";
import { AuthProvider } from "@/components/Auth";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const myanmar = localFont({
  src: "./fonts/A16_ThuNgalTan-Regular.ttf",
  variable: "--font-my",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AirVPN",
  description: "AirVPN plans for WathanPay and web checkout",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102A43",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.className} ${sans.variable} ${myanmar.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
