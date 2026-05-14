import React from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';

type Props = {
  address: string | undefined | null;
  style?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
  head?: number;
  tail?: number;
  selectable?: boolean;
  groupSize?: number;
  groupsPerLine?: number;
  padLastLine?: boolean;
};

export const AddressText = ({
  address,
  style,
  highlightStyle,
  head = 6,
  tail = 6,
  selectable,
  groupSize,
  groupsPerLine,
  padLastLine,
}: Props) => {
  const { theme, isDark } = useTheme();

  const str = address ?? '';
  const minLengthToHighlight = head + tail + 1;

  if (!str || str.length < minLengthToHighlight) {
    return (
      <Text style={style} selectable={selectable}>
        {str}
      </Text>
    );
  }

  const start = str.slice(0, head);
  const mid = str.slice(head, str.length - tail);
  const end = str.slice(str.length - tail);

  if (groupSize && groupSize > 0) {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += groupSize) {
      chunks.push(str.slice(i, i + groupSize));
    }

    const perLine = groupsPerLine ?? Math.ceil(chunks.length / 2);
    const totalChunks = chunks.length;
    const blankChunk = ' '.repeat(groupSize);

    const renderChunk = (chunk: string, idx: number) => {
      const isHighlight = idx === 0 || idx === totalChunks - 1;
      const display = chunk.length > 0 ? chunk : blankChunk;

      if (!isHighlight) {
        return display;
      }

      return (
        <Text key={`h-${idx}`} style={[{ color: theme.colors.bitcoin, fontWeight: 'bold' }, highlightStyle]}>
          {display}
        </Text>
      );
    };

    const line1 = chunks.slice(0, perLine);
    const line2Raw = chunks.slice(perLine);
    const line2 = padLastLine ? [...line2Raw, ...Array(Math.max(0, perLine - line2Raw.length)).fill('')] : line2Raw;

    const joinLine = (lineChunks: string[], lineOffset: number) => {
      const out: React.ReactNode[] = [];
      for (let i = 0; i < lineChunks.length; i++) {
        const globalIdx = lineOffset + i;
        out.push(renderChunk(lineChunks[i], globalIdx));
        if (i !== lineChunks.length - 1) out.push(' ');
      }
      return out;
    };

    return (
      <Text style={style} selectable={selectable}>
        {joinLine(line1, 0)}
        {'\n'}
        {joinLine(line2, perLine)}
      </Text>
    );
  }

  return (
    <Text style={style} selectable={selectable}>
      <Text style={[{ color: theme.colors.bitcoin, fontWeight: 'bold' }, highlightStyle]}>{start}</Text>
      {mid}
      <Text style={[{ color: theme.colors.bitcoin, fontWeight: 'bold' }, highlightStyle]}>{end}</Text>
    </Text>
  );
};
