import { createContext } from 'react';

// Nested merchant sheets must also respect their enclosing Terminal route.
export const TerminalOwnerFocusContext = createContext(true);
