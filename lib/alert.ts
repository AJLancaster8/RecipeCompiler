import { Alert as NativeAlert, AlertButton, Platform } from "react-native";

// Drop-in replacement for React Native's Alert.alert that also works on web.
//
// react-native-web's Alert.alert does nothing at all, so on the website
// confirmation popups (Delete, Sign Out, "Saved!" → go back) never appeared
// and their buttons never ran. On web this falls back to the browser's own
// dialogs:
//   - no buttons, or one button  → window.alert, then that button's onPress
//   - a Cancel button + an action → window.confirm (OK runs the action)
// On iOS/Android it's the normal native alert.
function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== "web") {
    NativeAlert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];
  const cancel = list.find((b) => b.style === "cancel");
  const actions = list.filter((b) => b.style !== "cancel");

  if (!cancel && actions.length <= 1) {
    window.alert(text);
    actions[0]?.onPress?.();
    return;
  }

  // The browser's confirm dialog only has OK / Cancel, so OK runs the last
  // (main) action — every popup in this app has at most one besides Cancel.
  const main = actions[actions.length - 1];
  if (window.confirm(text)) main?.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = { alert };
