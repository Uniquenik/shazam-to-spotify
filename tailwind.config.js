export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                ink: "#16120f",
                sand: "#f4ecde",
                apricot: "#f0b36d",
                ember: "#b55233",
                teal: "#1f6f78",
                moss: "#5b6b43"
            },
            boxShadow: {
                panel: "0 24px 64px rgba(22, 18, 15, 0.12)"
            },
            borderRadius: {
                "4xl": "2rem"
            },
            fontFamily: {
                sans: ["'Segoe UI'", "system-ui", "sans-serif"]
            },
            backgroundImage: {
                "paper-grid": "linear-gradient(rgba(22,18,15,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(22,18,15,0.05) 1px, transparent 1px)"
            }
        }
    },
    plugins: []
};
