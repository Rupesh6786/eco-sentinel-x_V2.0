import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, LogOut, Cpu, Mail, CalendarDays, SlidersHorizontal, FileDown, FlaskConical, Loader2 } from "lucide-react";
import type { Firestore, QueryDocumentSnapshot } from "firebase/firestore";
import { useAuth, SENSOR_META } from "@/lib/auth";
import { useTelemetry, fmtDateTime, normalize, type Reading } from "@/lib/telemetry";
import { PageHeader, Panel } from "@/components/eco/widgets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/profile")({
  head: () => meta("Operator Profile", "Your Eco-Sentinal-X account, your unique Node ID and ESP32 upload path."),
  component: ProfilePage,
});


const pad = (n: number) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d!); };

// Readings may store "timestamp" as a Firestore Timestamp, epoch milliseconds or epoch seconds.
// Try each form in turn and use the first one that returns data.
async function fetchDay(db: Firestore, nodeId: string, day: Date): Promise<Reading[]> {
  const fs = await import("firebase/firestore");
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = start + 86_400_000 - 1;
  const col = fs.collection(db, "nodes", nodeId, "readings");
  const ranges: [unknown, unknown][] = [
    [fs.Timestamp.fromMillis(start), fs.Timestamp.fromMillis(end)],
    [start, end],
    [Math.floor(start / 1000), Math.floor(end / 1000)],
  ];
  // Firestore rejects limit() above 10,000, so read the day in pages instead.
  const PAGE = 5000, MAX_ROWS = 100_000;
  for (const [a, b] of ranges) {
    const rows: Reading[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    while (rows.length < MAX_ROWS) {
      const q = fs.query(
        col,
        fs.where("timestamp", ">=", a), fs.where("timestamp", "<=", b),
        fs.orderBy("timestamp", "asc"),
        ...(cursor ? [fs.startAfter(cursor)] : []),
        fs.limit(PAGE),
      );
      const snap = await fs.getDocs(q);
      for (const d of snap.docs) rows.push(normalize(d.id, d.data()));
      if (snap.size < PAGE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    if (rows.length) return rows;
  }
  return [];
}

function ReportPanel() {
  const { db, nodeId, settings, status } = useTelemetry();
  const [dayStr, setDayStr] = useState(todayStr());
  const [busy, setBusy] = useState<"" | "day" | "today" | "sample">("");
  const [notice, setNotice] = useState<string | null>(null);
  const thresholds = { mq2: settings.mq2_threshold, mq7: settings.mq7_threshold, mq135: settings.mq135_threshold, pm25: settings.pm25_threshold };

  async function run(kind: "day" | "today", value: string) {
    if (!db || !nodeId) { toast.error("Firestore is not connected yet."); return; }
    const day = parseDay(value);
    const label = day.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    setBusy(kind); setNotice(null);
    try {
      const readings = await fetchDay(db, nodeId, day);
      if (!readings.length) {
        setNotice(`No data found for ${label}. Pick another date, or download the sample report to preview the layout.`);
        return;
      }
      const { buildReport } = await import("@/lib/report");
      await buildReport({ readings, day, nodeId, thresholds });
      toast.success(`Report for ${label} downloaded (${readings.length} readings)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the report.");
    } finally { setBusy(""); }
  }

  async function sample() {
    setBusy("sample");
    try {
      const { buildReport, makeSampleDay } = await import("@/lib/report");
      const day = new Date();
      await buildReport({ readings: makeSampleDay(day), day, nodeId: nodeId ?? "NODE-SAMPLE", thresholds, sample: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the sample report.");
    } finally { setBusy(""); }
  }

  const spin = <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <Panel title="Download Report" tag="PDF · 3 PAGES" className="lg:col-span-3">
      <p className="mb-4 text-sm text-muted-foreground">Pick a date to get a 3-page PDF with charts for every sensor, daily statistics and the event log.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Report date
          <Input
            type="date" max={todayStr()} value={dayStr}
            // Scroll the field to the middle of the screen so the native calendar popup has room below it.
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center" })}
            onChange={(e) => { setDayStr(e.target.value); setNotice(null); }}
          />
        </label>
        <Button className="font-semibold" disabled={!dayStr || !!busy || status === "connecting"} onClick={() => run("day", dayStr)}>
          {busy === "day" ? spin : <FileDown className="h-4 w-4" />}Download report
        </Button>
        <Button variant="outline" disabled={!!busy || status === "connecting"} onClick={() => { const t = todayStr(); setDayStr(t); run("today", t); }}>
          {busy === "today" ? spin : <CalendarDays className="h-4 w-4" />}Today
        </Button>
        <Button variant="ghost" disabled={!!busy} onClick={sample}>
          {busy === "sample" ? spin : <FlaskConical className="h-4 w-4" />}Sample report
        </Button>
      </div>
      {notice && <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{notice}</p>}
      {status !== "live" && status !== "connecting" && <p className="mt-4 text-xs text-muted-foreground">Your node has not sent live data yet, so real reports will say "no data found". The sample report shows the full layout.</p>}
    </Panel>
  );
}

function ProfilePage() {
  const { profile, signOut } = useAuth();
  const { status, readings } = useTelemetry();
  if (!profile) return null;
  const path = `nodes/${profile.nodeId}/readings`;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied"));

  return (
    // pb-80: extra space under the report panel so the page can scroll far enough for the calendar popup to fit.
    <div className="pb-80">
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
        <ReportPanel />
      </div>
    </div>
  );
}
