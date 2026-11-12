import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy, LogOut, Cpu, Mail, CalendarDays, SlidersHorizontal } from "lucide-react";
import { useAuth, SENSOR_META } from "@/lib/auth";
import { useTelemetry, fmtDateTime } from "@/lib/telemetry";
import { PageHeader, Panel } from "@/components/eco/widgets";
import { Button } from "@/components/ui/button";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/profile")({
  head: () => meta("Operator Profile", "Your Eco-Sentinal-X account, your unique Node ID and ESP32 upload path."),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, signOut } = useAuth();
  const { status, readings } = useTelemetry();
  if (!profile) return null;
  const path = `nodes/${profile.nodeId}/readings`;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied"));

  return (
    <div>
      <PageHeader code="08 / OPERATOR" title="Profile" subtitle="Your account and the ESP32 node linked to it. Only you can see this node's data." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Account" className="flex flex-col items-center text-center">
          {profile.photoURL
            ? <img src={profile.photoURL} alt="" className="h-20 w-20 rounded-full border-2 border-primary object-cover" />
            : <div className="grid h-20 w-20 place-items-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">{profile.displayName.slice(0, 2).toUpperCase()}</div>}
          <div className="mt-3 text-lg font-bold">{profile.displayName}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{profile.email}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" />Joined {fmtDateTime(profile.createdAt)}</div>
          <Button variant="outline" className="mt-5" onClick={() => signOut()}><LogOut className="h-4 w-4" />Sign out</Button>
        </Panel>
        <Panel title="My Node" tag={status === "live" ? "LIVE" : "WAITING FOR DATA"} className="glow lg:col-span-2">
          <div className="flex items-center gap-3">
            <Cpu className="h-8 w-8 text-primary" />
            <div className="font-mono text-3xl font-bold tracking-wider text-primary">{profile.nodeId}</div>
            <Button size="sm" variant="outline" onClick={() => copy(profile.nodeId)}><Copy className="h-3 w-3" />Copy</Button>
          </div>
          <div className="mt-5 space-y-2 text-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">ESP32 upload path</div>
            <div className="flex items-center gap-2 rounded-md border bg-secondary px-3 py-2 font-mono text-xs">
              <span className="flex-1 truncate">{path}</span>
              <button onClick={() => copy(path)} aria-label="Copy path" className="text-primary"><Copy className="h-3 w-3" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Flash this Node ID into your ESP32 firmware. It must sign in with your account and add one document per sample to this path. {status === "live" ? `${readings.length} readings received.` : "Until real data arrives, the dashboard shows sample data."}</p>
          </div>
        </Panel>
        <Panel title="Active Sensors" className="lg:col-span-3">
          <div className="flex flex-wrap gap-2">
            {profile.sensors.map((k) => <span key={k} className="rounded-full border border-primary/40 bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{SENSOR_META[k].label}</span>)}
          </div>
          <Link to="/settings" className="mt-4 inline-flex items-center gap-2 text-sm text-primary"><SlidersHorizontal className="h-4 w-4" />Change sensors</Link>
        </Panel>
      </div>
    </div>
  );
}
