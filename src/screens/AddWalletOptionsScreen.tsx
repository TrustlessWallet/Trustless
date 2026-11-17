import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddWalletOptions'>;
const AddWalletOptionsScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    return (
        <View style={styles.container}>
            {([
                ['plus-circle', 'Create wallet', 'BackupIntro'],
                ['download', 'Import wallet', 'RecoverWallet'],
                ['eye', 'Watch-only wallet', 'ImportWatchOnly'],
            ] as const).map(([icon, label, screen]) => (
                <TouchableOpacity key={screen} accessibilityRole="button" style={styles.row}
                    onPress={() => navigation.navigate(screen)}>
                    <Feather name={icon} size={22} color={theme.colors.primary} />
                    <Text style={styles.label}>{label}</Text>
                    <Feather name="chevron-right" size={20} color={theme.colors.muted} />
                </TouchableOpacity>
            ))}
        </View>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: { backgroundColor: theme.colors.background, paddingHorizontal: 24, paddingBottom: 24 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    label: { flex: 1, fontSize: 16, color: theme.colors.primary },
});
export default AddWalletOptionsScreen;
