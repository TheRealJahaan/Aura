import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { HealthResponse } from '@aura/shared';
import { fetchHealth } from './src/api';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Aura</Text>
      <Text style={styles.subtitle}>Your Google account, by voice.</Text>
      {!health && !error && <ActivityIndicator />}
      {health && (
        <Text style={styles.status}>
          API {health.status} · database {health.database} · v{health.version}
        </Text>
      )}
      {error && <Text style={[styles.status, styles.error]}>API unreachable: {error}</Text>}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 16, opacity: 0.7 },
  status: { fontSize: 14 },
  error: { color: '#c62828' },
});
