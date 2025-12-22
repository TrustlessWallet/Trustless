export const PALETTE = {
  white: '#FFFFFF',
  black: '#000000',
  bitcoin: '#F7931A',
  error: '#CC0000',
  vapor: '#F2F2F2',   
  steel: '#E5E5E5',   
  dust: '#808080',    
  carbon: '#1C1C1E',  
  obsidian: '#2C2C2E',
  ash: '#AEAEB2',     
};
export const LAYOUT = {
  radius: 8,
  spacing: 16,
  inputHeight: 56,
};
export const LIGHT_THEME = {
  dark: false,
  colors: {
    background: PALETTE.white,
    primary: PALETTE.black,      
    inversePrimary: PALETTE.white, 
    surface: PALETTE.vapor,      
    border: PALETTE.steel,
    muted: PALETTE.dust,
    bitcoin: PALETTE.bitcoin,
    error: PALETTE.error,
  },
  LAYOUT: LAYOUT,
};
export const DARK_THEME = {
  dark: true,
  colors: {
    background: PALETTE.black,
    primary: PALETTE.white,      
    inversePrimary: PALETTE.black, 
    surface: PALETTE.carbon,     
    border: PALETTE.obsidian,
    muted: PALETTE.ash,
    bitcoin: PALETTE.bitcoin,
    error: PALETTE.error,
  },
  LAYOUT: LAYOUT,
};
export type Theme = typeof LIGHT_THEME;