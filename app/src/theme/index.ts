import { createContext, createElement, useContext, type ReactNode } from 'react';
import { tokens, type Tokens } from './tokens';

/**
 * Light theme only — see `tokens.ts`'s module doc: none of the 24 design
 * screens declare a dark variant, so there is nothing to build a second
 * theme from yet. `theme` is exported directly (for use outside React, e.g.
 * in a `StyleSheet.create` at module scope, or in tests) and also served
 * through `ThemeProvider`/`useTheme()` so screens can consume it the same
 * way once a second (dark) theme exists.
 */
export const theme: Tokens & { colorScheme: 'light' } = {
  ...tokens,
  colorScheme: 'light',
};

export type Theme = typeof theme;

const ThemeContext = createContext<Theme>(theme);

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Provides `theme` via context. A no-op today (there is only one theme to
 * provide), kept as a real component rather than skipped so screens can
 * `useTheme()` now and this can grow a `colorScheme`/system-appearance
 * switch later without every call site changing.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export * from './tokens';
