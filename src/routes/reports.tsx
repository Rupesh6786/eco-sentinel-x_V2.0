import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, FileDown, FlaskConical, Loader2 } from "lucide-react";
import type { Firestore } from "firebase/firestore";
import { useTelemetry, normalize, type Reading } from "@/lib/telemetry";
import { PageHeader, Panel } from "@/components/eco/widgets";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/reports")({
  head: () => meta("Daily Report", "Pick a date and download a 3-page PDF report with charts for every sensor, statistics and the event log."),
  component: Reports,
});

const pad = (n: number) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d!); };

// Readings may be stored with a Firestore Timestamp, epoch milliseconds or epoch seconds in "timestamp".
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
  for (const [a, b] of ranges) {
    const q = fs.query(col, fs.where("timestamp", ">=", a), fs.where("timestamp", "<=", b), fs.orderBy("timestamp", "asc"), fs.limit(12000));
    const snap = await fs.getDocs(q);
    if (!snap.empty) return snap.docs.map((d) => normalize(d.id, d.data()));
  }
  return [];
}

function Reports() {
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
    <div>
      <PageHeader code="12 / REPORT" title="Daily Report" subtitle="Choose a date and download a 3-page PDF with charts for every sensor, daily statistics and the event log." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Download report" tag="PDF · 3 PAGES" className="lg:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              Report date
              <Input type="date" max={todayStr()} value={dayStr} onChange={(e) => { setDayStr(e.target.value); setNotice(null); }} />
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
        <Panel title="What is inside">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Page 1: weather-expert summary, AQI, key figures, PM2.5/PM10, temperature and humidity</li>
            <li>Page 2: MQ-2, MQ-7, MQ-135, pressure, light, hourly AQI and PM2.5 distribution</li>
            <li>Page 3: battery and Wi-Fi charts, statistics table, event log and data quality</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
