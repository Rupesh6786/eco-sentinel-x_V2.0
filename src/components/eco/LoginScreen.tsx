import { useState, type FormEvent } from "react";
import { Loader2, Radio, Wind, ShieldCheck, SlidersHorizontal, Database, LogOut, RefreshCw } from "lucide-react";
import { useAuth, SENSOR_META } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 5.04c1.62 0 3.06.56 4.2 1.64l3.12-3.12C17.46 1.8 14.96.75 12 .75 7.4.75 3.44 3.4 1.53 7.26l3.66 2.84C6.04 7.2 8.78 5.04 12 5.04z" />
      <path fill="#4285F4" d="M23.25 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.68 2.85c2.15-1.99 3.5-4.92 3.5-8.67z" />
      <path fill="#FBBC05" d="M5.19 14.28a7.06 7.06 0 0 1 0-4.56L1.53 6.88a11.26 11.26 0 0 0 0 10.24l3.66-2.84z" />
      <path fill="#34A853" d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.68-2.85c-1.02.69-2.33 1.1-3.78 1.1-3.22 0-5.96-2.16-6.81-5.06l-3.66 2.84c1.91 3.86 5.87 6.69 10.47 6.69z" />
    </svg>
  );
}

function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-sidebar p-10 lg:flex">
      <div className="hazard-stripe absolute inset-x-0 top-0 h-2" />
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-primary text-primary-foreground"><Radio className="h-5 w-5" /></div>
        <div>
          <div className="text-xl font-bold leading-none tracking-tight">Eco-Sentinal<span className="text-primary">-X</span></div>
          <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">IOT AIR MONITOR</div>
        </div>
      </div>
      <div className="max-w-md">
        <h1 className="text-4xl font-bold leading-tight tracking-tight">
          Your air. Your node.<br /><span className="text-primary">Your data only.</span>
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Every account gets its own ESP32 Node ID. Your device streams readings into
          <span className="font-mono text-primary"> nodes/your-node-id</span> — isolated from every other operator.
        </p>
        <ul className="mt-8 space-y-4 text-sm">
          <li className="flex items-center gap-3"><Wind className="h-4 w-4 text-primary" />Real-time gas, particulate and climate telemetry</li>
          <li className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 text-primary" />Node-level data isolation on Firestore</li>
          <li className="flex items-center gap-3"><SlidersHorizontal className="h-4 w-4 text-primary" />Pick exactly the sensors you deploy</li>
          <li className="flex items-center gap-3"><Database className="h-4 w-4 text-primary" />Searchable logs with PDF export</li>
        </ul>
      </div>
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground">FIRMWARE 1.0.0 · ESP32 · FIRESTORE LIVE</div>
    </div>
  );
}

export function LoginScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "google">("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("email");
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(name, email, password);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  async function google() {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message ?? "Google sign-in failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground"><Radio className="h-5 w-5" /></div>
            <div className="text-lg font-bold tracking-tight">Eco-Sentinal<span className="text-primary">-X</span></div>
          </div>

          <div className="panel glow p-6">
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-md border p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={`rounded-sm px-3 py-2 text-sm font-semibold transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <h2 className="text-xl font-bold tracking-tight">
              {mode === "signin" ? "Operator sign-in" : "Provision your node"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "signin"
                ? "Access your node's live telemetry dashboard."
                : "A new Node ID will be generated and linked to your account."}
            </p>

            <Button variant="outline" className="mt-5 w-full font-semibold" onClick={google} disabled={busy !== ""}>
              {busy === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3 text-[10px] font-mono tracking-widest text-muted-foreground">
              <span className="h-px flex-1 bg-border" />OR USE EMAIL<span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Operator name</Label>
                  <Input id="name" placeholder="Parth Nachane" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={6} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              </div>
              {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
              <Button type="submit" className="w-full font-bold" disabled={busy !== ""}>
                {busy === "email" && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signin" ? "Sign in" : "Create account & get Node ID"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center font-mono text-[10px] tracking-widest text-muted-foreground">
            ESP32 · FIRESTORE · SECURE PER-NODE ISOLATION
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthSplash({ label = "Connecting…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
      <div className="relative">
        <div className="grid h-16 w-16 place-items-center rounded-lg bg-primary text-primary-foreground"><Radio className="h-7 w-7" /></div>
        <span className="absolute inset-0 animate-ping rounded-lg border-2 border-primary/50" />
      </div>
      <div className="text-center">
        <div className="text-lg font-bold tracking-tight">Eco-Sentinal<span className="text-primary">-X</span></div>
        <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">{label.toUpperCase()}</div>
      </div>
    </div>
  );
}

export function AuthErrorScreen({ message }: { message: string | null }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-destructive/15 text-destructive"><ShieldCheck className="h-6 w-6" /></div>
        <h1 className="mt-4 text-xl font-bold">Connection problem</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message ?? "Could not reach Firebase."}</p>
        {message?.toLowerCase().includes("permission") && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-left text-xs text-warning">
            Your Firestore security rules don't allow this account to set up its node yet. Publish the latest <span className="font-mono">firebase.rules</span> in Firebase Console → Firestore Database → Rules, then press Retry.
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()} className="font-semibold"><RefreshCw className="h-4 w-4" />Retry</Button>
          <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
        </div>
      </div>
    </div>
  );
}

export function SensorChip({ k }: { k: keyof typeof SENSOR_META }) {
  return <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold">{SENSOR_META[k].label}</span>;
}
