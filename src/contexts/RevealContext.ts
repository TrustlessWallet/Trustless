import { createContext } from 'react';

export const RevealContext = createContext<(() => void) | null>(null);
