/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Every colour reads a CSS variable from src/index.css, so a dark theme
      // only has to redefine the variables.
      colors: {
        background: "var(--background)",
        sidebar: "var(--sidebar)",
        glass: "var(--glass)",
        surface: {
          DEFAULT: "var(--surface)",
          secondary: "var(--surface-secondary)",
          hover: "var(--surface-hover)",
          pressed: "var(--surface-pressed)",
          elevated: "var(--surface-elevated)",
        },
        line: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          active: "var(--accent-active)",
          soft: "var(--accent-soft)",
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        chart: { muted: "var(--chart-muted)" },
        hud: { DEFAULT: "var(--hud)", text: "var(--hud-text)" },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"SF Pro Text"',
          "Inter",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      // Hierarchy by size, weight and spacing — never past 600.
      fontSize: {
        display: ["2.75rem", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "600" }],
        title: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.022em", fontWeight: "600" }],
        heading: ["1.0625rem", { lineHeight: "1.5rem", letterSpacing: "-0.012em", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.375rem" }],
        label: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "500" }],
        meta: ["0.75rem", { lineHeight: "1rem" }],
      },
      borderRadius: { control: "10px", card: "16px" },
      boxShadow: {
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
        ring: "0 0 0 3px var(--accent-ring)",
      },
      transitionTimingFunction: { standard: "var(--ease)" },
      keyframes: {
        "view-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        // In, hold, out — the duration matches the 2.6s timer in App.tsx.
        toast: {
          "0%": { opacity: "0", transform: "translate(-50%, 8px) scale(0.98)" },
          "8%": { opacity: "1", transform: "translate(-50%, 0) scale(1)" },
          "88%": { opacity: "1", transform: "translate(-50%, 0) scale(1)" },
          "100%": { opacity: "0", transform: "translate(-50%, 4px) scale(0.99)" },
        },
      },
      animation: {
        // `backwards`, not `both`: a filled transform would trap position:fixed descendants (the transaction sheet) inside the view.
        "view-in": "view-in 220ms var(--ease) backwards",
        "fade-in": "fade-in 150ms var(--ease) backwards",
        toast: "toast 2600ms var(--ease) forwards",
      },
    },
  },
  plugins: [],
};
