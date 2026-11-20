import React from 'react';
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import { ignoreSafeArea, interactiveDismissDisabled, presentationBackground, presentationBackgroundInteraction, presentationDetents, presentationDragIndicator } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../../contexts/ThemeContext';
import type { MerchantSheetProps } from './MerchantSheetFrame';

const detents = [{ fraction: 0.26 }, { fraction: 0.50 }, { fraction: 0.85 }];

export default function MerchantSheetFrame({ index, onIndexChange, closing, onClose, onDismiss, children }: MerchantSheetProps) {
  const { theme, isDark } = useTheme();
  return <Host colorScheme={isDark ? 'dark' : 'light'} style={{ position: 'absolute', width: 1, height: 1 }}>
    <BottomSheet isPresented={!closing} onIsPresentedChange={shown => { if (!shown) onClose(); }} onDismiss={onDismiss}>
      <Group modifiers={[
        presentationDetents(detents, { selection: detents[index], onSelectionChange: detent => {
          if (typeof detent !== 'object' || !('fraction' in detent)) return;
          const next = detents.findIndex(value => value.fraction === detent.fraction);
          if (next >= 0) onIndexChange(next);
        } }),
        presentationBackgroundInteraction('enabled'), interactiveDismissDisabled(),
        presentationDragIndicator('visible'), presentationBackground(theme.colors.background),
        // Let the scroll viewport reach the sheet edge instead of clipping at the safe area.
        ignoreSafeArea({ regions: 'container', edges: 'bottom' }),
      ]}>
        <RNHostView>{children}</RNHostView>
      </Group>
    </BottomSheet>
  </Host>;
}
