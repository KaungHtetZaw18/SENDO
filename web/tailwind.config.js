export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#E5E7EB", // slate-200
          dim: "#9CA3AF", // slate-400
        },
        paper: {
          DEFAULT: "#0B0F19", // deep soft navy/slate
          raised: "#121829", // slightly lighter for cards
          hover: "#1A2240", // hover state
          border: "#1F2937", // slate-800-ish
        },
      },
      borderRadius: {
        xl2: "1rem",
      },
      boxShadow: {
        soft: "0 1px 0 0 rgba(255,255,255,0.03), 0 10px 30px -15px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
