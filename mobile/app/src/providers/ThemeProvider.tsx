import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { JOURNEYS, track } from "../analytics/analytics";

const THEME_KEY = "user_theme_override";

type ThemeMode = "light" | "dark" | "system";

interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  subtext: string;
  border: string;
  primary: string;
}

const dark: ThemeColors = {
  background: "#0F172A",
  surface: "#1E293B",
  text: "#F1F5F9",
  subtext: "#94A3B8",
  border: "#334155",
  primary: "#2563EB",
};

const light: ThemeColors = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  subtext: "#64748B",
  border: "#E2E8F0",
  primary: "#2563EB",
};

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: dark,
  isDark: true,
  mode: "system",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setModeState(saved);
      }
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    // Recorded here rather than in `ThemeToggle` because this is the point the
    // preference actually changes, so it is captured however it was reached —
    // including the restored-on-launch path, and the currently unrendered
    // `ThemeToggle` component. Selecting the mode already in effect is not an
    // interaction worth recording.
    if (next !== mode) {
      track({
        name: "Theme Changed",
        params: { journey: JOURNEYS.shared, from: mode, to: next },
      });
    }
    setModeState(next);
    AsyncStorage.setItem(THEME_KEY, next);
  };

  const isDark =
    mode === "system" ? systemScheme === "dark" : mode === "dark";

  return (
    <ThemeContext.Provider value={{ colors: isDark ? dark : light, isDark, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
