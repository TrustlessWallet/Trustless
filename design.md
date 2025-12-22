# Cypherpunk Wallet Design System v2 (Dark Mode Ready)

## Philosophy
Minimal. Raw. Data-first. High contrast.
**Rule of Thumb:** If it works in black and white, it works.

## The Palette

| Role | Light Mode Color | Dark Mode Color | Usage |
| :--- | :--- | :--- | :--- |
| **Background** | **Pure White** (`#FFFFFF`) | **Void Black** (`#000000`) | Main screen background. |
| **Primary** | **Void Black** (`#000000`) | **Pure White** (`#FFFFFF`) | Main text, Icons, Active Borders. |
| **Inverse** | **Pure White** (`#FFFFFF`) | **Void Black** (`#000000`) | Text inside Primary Buttons. |
| **Surface** | **Vapor** (`#F2F2F2`) | **Carbon** (`#1C1C1E`) | Inputs, Cards, Secondary Buttons. |
| **Border** | **Steel** (`#E5E5E5`) | **Obsidian** (`#2C2C2E`) | Dividers, Inactive Borders. |
| **Muted** | **Dust** (`#808080`) | **Ash** (`#AEAEB2`) | Subtitles, Derivation Paths. |
| **Accent** | **Bitcoin** (`#F7931A`) | **Bitcoin** (`#F7931A`) | Use sparingly (Symbols only). |

## Layout Constants
* **Radius:** 8px
* **Spacing:** 16px
* **Input Height:** 56px

## Implementation Rules

### 1. Text
Never hardcode colors. Use the theme object.
* **Main Text:** `theme.colors.primary`
* **Subtext:** `theme.colors.muted`
* **Font:** `SpaceMono` (via `<StyledText />`)

### 2. Inputs
* **Background:** `theme.colors.surface`
* **Text:** `theme.colors.primary`
* **Placeholder:** `theme.colors.muted`
* **Border:** 1px solid `theme.colors.border` (Optional in Dark Mode, but recommended for consistency).

### 3. Buttons
* **Primary Button:**
    * Background: `theme.colors.primary`
    * Text: `theme.colors.inversePrimary`
* **Secondary Button (e.g., Copy/Share):**
    * Background: `theme.colors.surface`
    * Text: `theme.colors.primary`

### 4. Icons
* Always tint icons with `theme.colors.primary` unless they are specific actions (like Delete -> `theme.colors.error`).