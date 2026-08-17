import "@fontsource-variable/cairo";
import "@fontsource-variable/noto-sans-arabic";
import "./globals.css";

export const metadata = {
  title: "Cg Ai — Real Estate Intelligence",
  description: "Cg Ai helps customers explore verified real-estate inventory through a premium conversational experience.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
