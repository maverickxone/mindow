/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--bg-primary)",
        secondary: "var(--bg-secondary)",
        tertiary: "var(--bg-tertiary)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        border: "var(--border-color)",
        "accent-safe": "var(--accent-safe)",
        "accent-warning": "var(--accent-warning)",
        "accent-danger": "var(--accent-danger)",
        "accent-info": "var(--accent-info)",
        "tab-active": "var(--tab-active)",
        "tab-inactive": "var(--tab-inactive)",
        "status-safe": "var(--status-safe)",
        "status-caution": "var(--status-caution)",
        "status-unknown": "var(--status-unknown)",
        "row-warning": "var(--row-warning)",
      },
      transitionDuration: {
        "data": "300ms",
      },
      transitionTimingFunction: {
        "data": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
