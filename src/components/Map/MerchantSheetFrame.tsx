import React, { useEffect, useRef } from 'react';
import BottomSheet from '@gorhom/bottom-sheet';
import { useTheme } from '../../contexts/ThemeContext';

export interface MerchantSheetProps {
  children: React.ReactElement;
  index: number;
  onIndexChange: (index: number) => void;
  closing: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

const snapPoints = ['26%', '50%', '85%'];

export default function MerchantSheetFrame({ index, onIndexChange, closing, onDismiss, children }: MerchantSheetProps) {
  const { theme } = useTheme();
  const sheet = useRef<BottomSheet>(null);
  useEffect(() => { if (closing) sheet.current?.close(); }, [closing]);
  return <BottomSheet ref={sheet} index={index} snapPoints={snapPoints} enableDynamicSizing={false}
    enablePanDownToClose={false} onChange={position => { if (position >= 0) onIndexChange(position); }}
    onClose={onDismiss} handleIndicatorStyle={{ backgroundColor: theme.colors.border, width: 40 }}
    backgroundStyle={{ backgroundColor: theme.colors.background, borderRadius: 36 }}>
    {children}
  </BottomSheet>;
}
