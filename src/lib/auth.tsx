import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { firebaseReady } from "./firebase";
import { randomThemeId, type ThemeMode } from "./themes";

// ============= Sensor catalog =============
// Every gauge/graph group in the app maps to one of these keys. Users pick
// their set on the Settings page; pages render only the enabled groups.
export type SensorKey = "mq2" | "mq7" | "mq135" | "dust" | "env" | "power";

export const SENSOR_KEYS: SensorKey[] = ["mq2", "mq7", "mq135", "dust", "env", "power"];

export const SENSOR_META: Record<SensorKey, { label: string; desc: string }> = {
  mq2: { label: "MQ-2 · Smoke / LPG", desc: "Combustible gas concentration in ppm" },
  mq7: { label: "MQ-7 · Carbon Monoxide", desc: "CO concentration in ppm" },
  mq135: { label: "MQ-135 · Air Quality", desc: "NH₃, benzene, alcohol and CO₂ equivalent in ppm" },
  dust: { label: "Dust · PM2.5 / PM10", desc: "Optical dust density and particulate matter" },
  env: { label: "DHT11 · Temperature & Humidity", desc: "Ambient climate readouts" },
  power: { label: "Power & System", desc: "Battery, TP4056 charging, Wi-Fi, heap and uptime" },
};

// ============= Profile =============
export type Profile = {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  /** The user's unique device node id — also its Firestore storage path: nodes/{nodeId}/readings */
  nodeId: string;
  sensors: SensorKey[];
  themeId: number;
  themeMode: ThemeMode;
  createdAt: number;
};

type AuthStatus = "loading" | "signed-out" | "provisioning" | "ready" | "error";

type AuthCtx = {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  setSensorEnabled: (key: SensorKey, on: boolean) => Promise<void>;
  setAppearance: (themeId: number, themeMode: ThemeMode) => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

// Unambiguous alphabet — no I/L/O/0/1 so node ids can be read off the device.
const NODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function genNodeId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "NODE-" + Array.from(bytes, (b) => NODE_ALPHABET[b % NODE_ALPHABET.length]).join("");
}

const friendlyAuthError = (code: string | undefined, fallback: string): string => {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/email-already-in-use":
      return "That email already has an account — try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak — use at least 6 characters.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't enabled yet. In Firebase Console → Authentication → Sign-in method, enable it first.";
    case "auth/unauthorized-domain":
      return "This preview domain isn't authorized. In Firebase Console → Authentication → Settings → Authorized domains, add the current domain.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in window closed before finishing.";
    case "auth/popup-blocked":
      return "The sign-in window was blocked. Allow popups for this site and try again.";
    case "auth/network-request-failed":
      return "Network problem reaching Firebase. Check your connection.";
    default:
      return fallback;
  }
};

async function ensureProfile(user: User): Promise<Profile> {
  const { firestore: db } = await firebaseReady();
  const { doc, getDoc, writeBatch, serverTimestamp } = await import("firebase/firestore");

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data() as any;
    return {
      uid: user.uid,
      email: d.email ?? user.email ?? "",
      displayName: d.displayName ?? user.displayName ?? user.email?.split("@")[0] ?? "Operator",
      photoURL: d.photoURL ?? user.photoURL ?? null,
      nodeId: d.nodeId,
      sensors: SENSOR_KEYS.filter((k) => (d.sensors ?? SENSOR_KEYS).includes(k)),
      themeId: Number.isInteger(d.themeId) && d.themeId >= 1 && d.themeId <= 10 ? d.themeId : 1,
      themeMode: d.themeMode === "light" ? "light" : "dark",
      createdAt: typeof d.createdAt?.toMillis === "function" ? d.createdAt.toMillis() : d.createdAt ?? Date.now(),
    };
  }

  // New account — allocate a unique node id and register it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const nodeId = genNodeId();
    const themeId = randomThemeId();
    const idxRef = doc(db, "node_index", nodeId);
    const taken = await getDoc(idxRef);
    if (taken.exists()) continue;
    try {
      const batch = writeBatch(db);
      batch.set(idxRef, { uid: user.uid, createdAt: serverTimestamp() });
      batch.set(ref, {
        email: user.email ?? "",
        displayName: user.displayName ?? user.email?.split("@")[0] ?? "Operator",
        photoURL: user.photoURL ?? null,
        nodeId,
        sensors: SENSOR_KEYS,
        themeId,
        themeMode: "dark",
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return {
        uid: user.uid,
        email: user.email ?? "",
        displayName: user.displayName ?? user.email?.split("@")[0] ?? "Operator",
        photoURL: user.photoURL ?? null,
        nodeId,
        sensors: [...SENSOR_KEYS],
        themeId,
        themeMode: "dark",
        createdAt: Date.now(),
      };
    } catch {
      // retry on race/collision
    }
  }
  // Fall back to reading back whatever got provisioned.
  const again = await getDoc(ref);
  const d = again.data() as any;
  if (d?.nodeId) {
    return {
      uid: user.uid,
      email: d.email ?? user.email ?? "",
      displayName: d.displayName ?? "Operator",
      photoURL: d.photoURL ?? null,
      nodeId: d.nodeId,
      sensors: SENSOR_KEYS.filter((k) => (d.sensors ?? SENSOR_KEYS).includes(k)),
      themeId: Number.isInteger(d.themeId) && d.themeId >= 1 && d.themeId <= 10 ? d.themeId : 1,
      themeMode: d.themeMode === "light" ? "light" : "dark",
      createdAt: Date.now(),
    };
  }
  throw new Error("Could not allocate a Node ID for this account. Try signing in again.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { auth } = await firebaseReady();
        const { onAuthStateChanged } = await import("firebase/auth");
        if (cancelled) return;
        unsub = onAuthStateChanged(auth, async (u) => {
          setUser(u);
          if (!u) {
            setProfile(null);
            setStatus("signed-out");
            return;
          }
          setStatus("provisioning");
          try {
            const p = await ensureProfile(u);
            if (cancelled) return;
            setProfile(p);
            setStatus("ready");
            setError(null);
          } catch (e: any) {
            if (cancelled) return;
            setError(e?.message ?? String(e));
            setStatus("error");
          }
        });
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  async function signIn(email: string, password: string) {
    try {
      const { auth } = await firebaseReady();
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      throw new Error(friendlyAuthError(e?.code, e?.message ?? "Sign-in failed."));
    }
  }

  async function signUp(name: string, email: string, password: string) {
    try {
      const { auth } = await firebaseReady();
      const { createUserWithEmailAndPassword, updateProfile } = await import("firebase/auth");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
    } catch (e: any) {
      throw new Error(friendlyAuthError(e?.code, e?.message ?? "Sign-up failed."));
    }
  }

  async function signInWithGoogle() {
    try {
      const { auth } = await firebaseReady();
      const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      throw new Error(friendlyAuthError(e?.code, e?.message ?? "Google sign-in failed."));
    }
  }

  async function doSignOut() {
    const { auth } = await firebaseReady();
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
  }

  async function setSensorEnabled(key: SensorKey, on: boolean) {
    if (!profile) return;
    const next = on ? Array.from(new Set([...profile.sensors, key])) : profile.sensors.filter((s) => s !== key);
    if (next.length === 0) throw new Error("At least one sensor group must stay on.");
    const prev = profile;
    setProfile({ ...profile, sensors: next });
    try {
      const { firestore: db } = await firebaseReady();
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "users", profile.uid), { sensors: next });
    } catch (e: any) {
      setProfile(prev);
      throw new Error(e?.message ?? "Could not save sensor selection.");
    }
  }

  async function setAppearance(themeId: number, themeMode: ThemeMode) {
    if (!profile || !Number.isInteger(themeId) || themeId < 1 || themeId > 10) return;
    const previous = profile;
    setProfile({ ...profile, themeId, themeMode });
    try {
      const { firestore: db } = await firebaseReady();
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "users", profile.uid), { themeId, themeMode });
    } catch (e: any) {
      setProfile(previous);
      throw new Error(e?.message ?? "Could not save dashboard appearance.");
    }
  }

  return (
    <AuthContext.Provider
      value={{ status, user, profile, error, signIn, signUp, signInWithGoogle, signOut: doSignOut, setSensorEnabled, setAppearance }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
