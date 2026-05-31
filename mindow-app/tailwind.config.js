/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Surface elevations */
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        "surface-4": "var(--surface-4)",

        /* Text */
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",

        /* Border */
        border: "var(--border-color)",

        /* Accent */
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",

        /* Resource colors */
        "color-cpu": "var(--color-cpu)",
        "color-memory": "var(--color-memory)",
        "color-disk": "var(--color-disk)",
        "color-disk-write": "var(--color-disk-write)",

        /* Heat scale */
        "heat-safe": "var(--heat-safe)",
        "heat-moderate": "var(--heat-moderate)",
        "heat-high": "var(--heat-high)",
        "heat-extreme": "var(--heat-extreme)",

        /* Semantic states */
        "state-success": "var(--state-success)",
        "state-warning": "var(--state-warning)",
        "state-danger": "var(--state-danger)",
        "state-info": "var(--state-info)",

        /* Legacy aliases (backward compat) */
        primary: "var(--surface-0)",
        secondary: "var(--surface-1)",
        tertiary: "var(--surface-2)",
        "accent-safe": "var(--state-success)",
        "accent-warning": "var(--state-warning)",
        "accent-danger": "var(--state-danger)",
        "accent-info": "var(--accent)",
        "tab-active": "var(--tab-active)",
        "tab-inactive": "var(--tab-inactive)",
        "status-safe": "var(--status-safe)",
        "status-caution": "var(--status-caution)",
        "status-unknown": "var(--status-unknown)",
        "row-warning": "var(--row-warning)",
      },
      spacing: {
        "token-1": "var(--space-1)",
        "token-2": "var(--space-2)",
        "token-3": "var(--space-3)",
        "token-4": "var(--space-4)",
        "token-5": "var(--space-5)",
        "token-6": "var(--space-6)",
        "token-8": "var(--space-8)",
        "token-10": "var(--space-10)",
        "token-12": "var(--space-12)",
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
        data: "300ms",
      },
      fontSize: {
        "token-xs": "var(--text-xs)",
        "token-sm": "var(--text-sm)",
        "token-base": "var(--text-base)",
        "token-md": "var(--text-md)",
        "token-lg": "var(--text-lg)",
        "token-xl": "var(--text-xl)",
      },
      transitionTimingFunction: {
        data: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
