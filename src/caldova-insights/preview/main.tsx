import { useState } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { ThemeContext } from "../src/hooks/theme.context";
import "./preview.css";

function PreviewRoot() {
    const [isDark, setIsDark] = useState(false);

    return (
        <ThemeContext.Provider
            value={{
                isDark,
                toggleTheme: () =>
                    setIsDark((current) => {
                        document.documentElement.classList.toggle("dark", !current);
                        return !current;
                    }),
            }}
        >
            <App />
        </ThemeContext.Provider>
    );
}

createRoot(document.getElementById("root")!).render(<PreviewRoot />);
