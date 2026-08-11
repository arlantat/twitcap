import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0b",
        panel: "#131316",
        edge: "#232329",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Hiragino Sans",
          "Noto Sans JP",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
