import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-arabic";
import "./globals.css";

export const metadata = {
  title: "Maqar — Your property advisor",
  description: "A conversation-first real estate advisor for Egypt."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
