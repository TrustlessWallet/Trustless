import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_THEME, DARK_THEME, Theme } from '../constants/theme';

type ThemeContextType = {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const THEME_STORAGE_KEY = '@app_theme_preference';

interface ThemeProviderProps {
  children: ReactNode;
  initialIsDark: boolean;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, initialIsDark }) => {
  const [isDark, setIsDark] = useState<boolean>(initialIsDark);


  const toggleTheme = useCallback(() => {
    setIsDark((prevMode) => {
      const newMode = !prevMode;
      AsyncStorage.setItem(THEME_STORAGE_KEY, newMode ? 'dark' : 'light');
      return newMode;
    });
  }, []);

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