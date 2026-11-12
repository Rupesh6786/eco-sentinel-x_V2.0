// Lazily initializes the user's Firebase app (auth + firestore) from the
// server-provided web config. Safe to call from any client code; the dynamic
// imports keep firebase modules out of the SSR graph.
import { getFirebaseConfig } from "./firebase-config.functions";

export type FirebaseBundle = {
  app: import("firebase/app").FirebaseApp;
  auth: import("firebase/auth").Auth;
  firestore: import("firebase/firestore").Firestore;
};

let bundle: Promise<FirebaseBundle> | null = null;

export function firebaseReady(): Promise<FirebaseBundle> {
  if (!bundle) {
    bundle = (async () => {
      const cfg = await getFirebaseConfig();
      if (!cfg.apiKey) throw new Error("Firebase API key missing");
      const { initializeApp, getApps } = await import("firebase/app");
      const authMod = await import("firebase/auth");
      const fsMod = await import("firebase/firestore");
      const app = getApps()[0] ?? initializeApp(cfg);
      return {
        app,
        auth: authMod.getAuth(app),
        firestore: fsMod.getFirestore(app),
      };
    })();
  }
  return bundle;
}
