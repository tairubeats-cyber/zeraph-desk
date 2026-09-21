/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#0B1A2E", 800: "#13263D", 700: "#1D3450", 600: "#2C4767" },
        gold: { DEFAULT: "#D9A441", deep: "#B9862C" },
        paper: { DEFAULT: "#F6F4EF", edge: "#E7E2D8" },
        ink: { DEFAULT: "#16202B", soft: "#5A6775" },
      },
      fontFamily: {
        display: ["Cormorant Garamond", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
