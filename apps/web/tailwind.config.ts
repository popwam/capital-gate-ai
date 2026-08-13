import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211e",
        forest: "#153e35",
        sand: "#f3efe7",
        coral: "#e86f51"
      },
      boxShadow: { soft: "0 14px 45px rgba(20, 42, 34, .10)" }
    }
  },
  plugins: []
} satisfies Config;
