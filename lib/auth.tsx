import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { clearToken, loadToken, saveToken } from "./auth-storage";
import {
  ApiError,
  authApi,
  setSessionToken,
  setUnauthorizedHandler,
  User,
} from "./recipe-api";

type AuthContextType = {
  user: User | null;
  // true while checking for a saved sign-in at launch
  initializing: boolean;
  // `login` is a username or an email address.
  signIn: (login: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Sets or removes (null) the profile picture. `base64` is JPEG/PNG/WebP data.
  setAvatar: (base64: string | null) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  const forgetSession = useCallback(async () => {
    setSessionToken(null);
    setUser(null);
    await clearToken();
  }, []);

  // If any request comes back 401, the session has expired — sign out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      forgetSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [forgetSession]);

  // On launch, restore a saved session if the server still accepts it.
  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (token) {
        setSessionToken(token);
        try {
          const { user } = await authApi.me();
          setUser(user);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            await forgetSession();
          } else {
            // Server unreachable: we can't confirm the session, so show the
            // sign-in screen (which will surface the connection error).
            setSessionToken(null);
          }
        }
      }
      setInitializing(false);
    })();
  }, [forgetSession]);

  const startSession = async (token: string, user: User) => {
    setSessionToken(token);
    await saveToken(token);
    setUser(user);
  };

  const signIn = async (login: string, password: string) => {
    const { token, user } = await authApi.login(login, password);
    await startSession(token, user);
  };

  const register = async (username: string, email: string, password: string) => {
    const { token, user } = await authApi.register(username, email, password);
    await startSession(token, user);
  };

  const signOut = async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the server can't be reached, forget the session locally.
    }
    await forgetSession();
  };

  const setAvatar = async (base64: string | null) => {
    const { user } = base64 === null ? await authApi.removeAvatar() : await authApi.setAvatar(base64);
    setUser(user);
  };

  return (
    <AuthContext.Provider value={{ user, initializing, signIn, register, signOut, setAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
