import "@fontsource-variable/cairo";
import "@fontsource-variable/noto-sans-arabic";
import "./globals.css";

export const metadata = {
  title: "مقار — مستشارك العقاري",
  description: "مستشار عقاري محادثي للسوق المصري.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
