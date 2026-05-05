import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, ScrollView, UIManager } from 'react-native';

type Options = {
  basePaddingBottom: number;
  keyboardExtraHeight?: number;
  keyboardOpenPaddingExtra?: number;
  focusDelayIosMs?: number;
  focusDelayAndroidMs?: number;
  animateLayoutChanges?: boolean;
};

export const useKeyboardScroll = ({
  basePaddingBottom,
  keyboardExtraHeight = 50,
  keyboardOpenPaddingExtra = 32,
  focusDelayIosMs = 50,
  focusDelayAndroidMs = 100,
  animateLayoutChanges = false,
}: Options) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!animateLayoutChanges) return;
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, [animateLayoutChanges]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onKeyboardShow = (e: any) => {
      if (animateLayoutChanges) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(e.endCoordinates.height + keyboardExtraHeight);
    };

    const onKeyboardHide = () => {
      if (animateLayoutChanges) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [animateLayoutChanges, keyboardExtraHeight]);

  const paddingBottom = useMemo(() => {
    return keyboardHeight > 0 ? keyboardHeight + keyboardOpenPaddingExtra : basePaddingBottom;
  }, [basePaddingBottom, keyboardHeight, keyboardOpenPaddingExtra]);

  const handleInputFocus = useCallback(() => {
    const delayMs = Platform.OS === 'ios' ? focusDelayIosMs : focusDelayAndroidMs;
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, delayMs);
  }, [focusDelayAndroidMs, focusDelayIosMs]);

  return {
    scrollViewRef,
    keyboardHeight,
    paddingBottom,
    handleInputFocus,
  };
};
