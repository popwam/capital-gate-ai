import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14211f",
        forest: "#173f3b",
        sand: "#f5f2eb",
        coral: "#b08c52"
      },
      boxShadow: {
        soft: "0 18px 55px rgba(20, 41, 39, .10)",
        premium: "0 26px 80px rgba(20, 41, 39, .14)"
      }
    }
  },
  plugins: []
} satisfies Config;
