import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_THEME, DARK_THEME, Theme } from '../constants/theme';

type ThemeContextType = {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const THEME_STORAGE_KEY = '@app_theme_preference';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState<boolean>(false);
  const isToggledRef = useRef(false);

  useEffect(() => {
    const loadTheme = async () => {
      const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (saved !== null && !isToggledRef.current) {
        setIsDark(saved === 'dark');
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = () => {
    isToggledRef.current = true;
    setIsDark((prevMode) => {
      const newMode = !prevMode;
      AsyncStorage.setItem(THEME_STORAGE_KEY, newMode ? 'dark' : 'light');
      return newMode;
    });
  };

  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};