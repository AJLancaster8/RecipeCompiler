import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// As of Expo SDK 53, expo-notifications was removed from Expo Go on
// Android entirely — even just importing it throws there. iOS Expo Go
// still supports local (non-push) notifications fine, and any real
// development build (on either platform) supports the full module.
// So: only attempt to load the native module when we're NOT on
// Android-inside-Expo-Go. Everywhere else, these functions become
// harmless no-ops instead of crashing the app.
// isRunningInExpoGo() checks for Expo Go's native module directly, which is
// the most reliable signal; the Constants check is a backup.
const isExpoGo =
  isRunningInExpoGo() || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const notificationsBlocked = Platform.OS === 'android' && isExpoGo;

let NotificationsModule: typeof import('expo-notifications') | null = null;

if (!notificationsBlocked) {
  try {
    NotificationsModule = require('expo-notifications');
    NotificationsModule?.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // Android requires every notification to belong to a "channel" (since
    // Android 8) or it can be silently dropped even when scheduling
    // succeeds without error. iOS has no concept of channels, so this is
    // a no-op there.
    if (Platform.OS === 'android' && NotificationsModule) {
      NotificationsModule.setNotificationChannelAsync('default', {
        name: 'Step timers',
        importance: NotificationsModule.AndroidImportance.HIGH,
        // No `sound` key: on Android it names a custom sound file, and
        // leaving it out uses the system default notification sound.
        vibrationPattern: [0, 250, 250, 250],
      }).catch((err) => console.warn('Failed to set up notification channel:', err));
    }
  } catch (err) {
    console.warn('expo-notifications unavailable in this environment:', err);
    NotificationsModule = null;
  }
}

// Lets the UI show a helpful message instead of just silently not notifying
export const notificationsSupported = !!NotificationsModule;

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (!NotificationsModule) return false;
  try {
    const settings = await NotificationsModule.getPermissionsAsync();
    if (settings.granted) return true;
    const request = await NotificationsModule.requestPermissionsAsync();
    return request.granted;
  } catch (err) {
    console.warn('Failed to get notification permissions:', err);
    return false;
  }
}

// Schedules a local notification to fire when a step's timer finishes.
// Returns the notification's id (needed to cancel it later), or null if
// notifications aren't available, permission was denied, or scheduling
// failed for any reason.
export async function scheduleStepNotification(
  recipeName: string,
  stepText: string,
  durationSeconds: number
): Promise<string | null> {
  if (!NotificationsModule) return null;
  try {
    const granted = await ensureNotificationPermissions();
    if (!granted) return null;

    const id = await NotificationsModule.scheduleNotificationAsync({
      content: {
        title: `${recipeName}: step ready`,
        body: stepText,
        sound: true,
      },
      trigger: {
        seconds: Math.max(1, Math.round(durationSeconds)),
        channelId: Platform.OS === 'android' ? 'default' : undefined,
      } as any,
    });
    return id;
  } catch (err) {
    console.warn('Failed to schedule step notification:', err);
    return null;
  }
}

export async function cancelStepNotification(notificationId: string | null): Promise<void> {
  if (!NotificationsModule || !notificationId) return;
  try {
    await NotificationsModule.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Already fired or already cancelled — safe to ignore
  }
}