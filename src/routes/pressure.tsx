import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Gauge as GaugeIcon, Mountain, TrendingUp, TrendingDown, Minus, ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { useTelemetry, fmtTime, fmtDateTime, type Reading } from "@/lib/telemetry";
import { PageHeader, Panel, StatCard, Gauge, StatusBadge, DisabledNotice, chartTooltip, axis } from "@/components/eco/widgets";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/pressure")({
  head: () => meta("Barometric Pressure", "BMP280 barometric pressure (hPa) with trend, estimated altitude and pressure distribution."),
  component: Pressure,
});

const SEA_LEVEL = 1013.25;

// Standard-atmosphere altitude estimate from pressure (metres).
const altitudeOf = (hpa: number) => 44330 * (1 - Math.pow(hpa / SEA_LEVEL, 0.1903));

const band = (hpa: number) =>
  hpa < 1000 ? { label: "Low", tone: "warning" as const }
  : hpa < 1020 ? { label: "Normal", tone: "success" as const }
  : { label: "High", tone: "success" as const };

type PReading = Reading & { pressure: number };

function Pressure() {
  const { readings, latest, enabled } = useTelemetry();
  if (!latest) return null;
  if (!enabled("pressure")) return <DisabledNotice what="The BMP280 barometric pressure sensor" />;

  // Only readings that actually carry a BMP280 value
  const rs = readings.filter((r): r is PReading => typeof r.pressure === "number" && r.pressure > 300);
  const cur = latest.pressure;

  if (!rs.length || cur === undefined || cur <= 300) {
    return (
      <div>
        <PageHeader code="11 / PRESSURE" title="Barometric Pressure" subtitle="Atmospheric pressure (hPa) reported by the BMP280 sensor." />
        <Panel title="Waiting for BMP280 data">
          <p className="text-sm text-muted-foreground">
            No pressure readings found yet. Make sure the BMP280 is wired over I²C and that your firmware uploads
            <span className="font-mono"> environment.pressure_hpa </span>
            (or <span className="font-mono">barometric_pressure</span>) with each reading.
          </p>
        </Panel>
      </div>
    );
  }

  const all = rs.map((r) => r.pressure);
  const max = Math.max(...all);
  const min = Math.min(...all);
  const avg = all.reduce((s, v) => s + v, 0) / all.length;
  const peak = rs.reduce((a, b) => (b.pressure > a.pressure ? b : a), rs[0]!);
  const low = rs.reduce((a, b) => (b.pressure < a.pressure ? b : a), rs[0]!);
  const alt = altitudeOf(cur);
  const b = band(cur);

  // Trend: change over roughly the last 3 hours (or whatever window we have)
  const target = latest.ts - 3 * 3_600_000;
  const ref = rs.find((r) => r.ts >= target) ?? rs[0]!;
  const hours = (latest.ts - ref.ts) / 3_600_000;
  const delta3h = hours > 0.25 ? ((cur - ref.pressure) / hours) * 3 : 0;
  const trend =
    delta3h > 1 ? { label: "Rising", icon: <TrendingUp className="h-4 w-4" />, tone: "success" as const }
    : delta3h < -1 ? { label: "Falling", icon: <TrendingDown className="h-4 w-4" />, tone: "warning" as const }
    : { label: "Steady", icon: <Minus className="h-4 w-4" />, tone: "success" as const };
  const outlook =
    delta3h <= -3 ? "Rapid drop: stormy or unsettled weather likely"
    : delta3h < -1 ? "Falling pressure: weather may turn cloudy or wet"
    : delta3h >= 3 ? "Rapid rise: clearing and windy conditions likely"
    : delta3h > 1 ? "Rising pressure: conditions improving"
    : "Stable pressure: no major change expected";

  const data = rs.slice(-120).map((r) => ({
    t: fmtTime(r.ts),
    hpa: +r.pressure.toFixed(1),
    alt: +altitudeOf(r.pressure).toFixed(1),
    hum: +r.humidity.toFixed(1),
  }));

  // Distribution bins (hPa)
  const bins = ([[0, 1000, "Low <1000"], [1000, 1010, "1000-1010"], [1010, 1020, "1010-1020"], [1020, 1030, "1020-1030"], [1030, 2000, "High 1030+"]] as [number, number, string][]).map(([lo, hi, label]) => ({
    range: label, count: all.filter((v) => v >= lo && v < hi).length,
  }));

  // Sample-to-sample change, last 30 samples
  const deltas = rs.slice(-31).slice(1).map((r, i, arr) => {
    const prev = i === 0 ? rs[rs.length - 31] ?? r : arr[i - 1]!;
    return { t: fmtTime(r.ts), d: +(r.pressure - prev.pressure).toFixed(2) };
  });

  const pad = Math.max(1, (max - min) * 0.2);
  const domain: [number, number] = [Math.floor(min - pad), Math.ceil(max + pad)];

  return (
    <div>
      <PageHeader code="11 / PRESSURE" title="Barometric Pressure" subtitle="Atmospheric pressure (hPa) reported by the BMP280 sensor." />
      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Pressure" tag="hPa" className="flex flex-col items-center md:row-span-2">
          <Gauge value={cur} max={1100} label="Barometric" unit="hPa" warn={1e9} danger={1e9} size={220} />
          <div className="mt-2 flex items-center gap-2"><StatusBadge {...b} /><StatusBadge label={trend.label} tone={trend.tone} /></div>
        </Panel>
        <StatCard accent label="Current" value={cur.toFixed(1)} unit="hPa" icon={<GaugeIcon className="h-4 w-4" />} />
        <StatCard label="Average" value={avg.toFixed(1)} unit="hPa" icon={<GaugeIcon className="h-4 w-4" />} />
        <StatCard label="Highest" value={max.toFixed(1)} unit="hPa" icon={<ArrowUpToLine className="h-4 w-4" />} sub={fmtDateTime(peak.ts)} />
        <StatCard label="Lowest" value={min.toFixed(1)} unit="hPa" icon={<ArrowDownToLine className="h-4 w-4" />} sub={fmtDateTime(low.ts)} />
        <StatCard label="3h Change" value={`${delta3h > 0 ? "+" : ""}${delta3h.toFixed(1)}`} unit="hPa" icon={trend.icon} sub={outlook} />
        <StatCard label="Est. Altitude" value={alt.toFixed(0)} unit="m" icon={<Mountain className="h-4 w-4" />} sub="vs 1013.25 hPa sea level" />
      </div>

      <Panel title="Pressure Trend" tag="LIVE · 120 SAMPLES" className="mt-4">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs><linearGradient id="bp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} domain={domain} />
            <Tooltip {...chartTooltip} />
            <ReferenceLine y={SEA_LEVEL} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: "Std. sea level", fill: "var(--warning)", fontSize: 10 }} />
            <Area type="monotone" dataKey="hpa" name="hPa" stroke="var(--chart-1)" fill="url(#bp)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Pressure vs Humidity" tag="OVERLAY">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" {...axis} minTickGap={40} />
              <YAxis yAxisId="l" {...axis} domain={domain} /><YAxis yAxisId="r" orientation="right" {...axis} />
              <Tooltip {...chartTooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" type="monotone" dataKey="hpa" name="hPa" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="hum" name="Humidity %" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Estimated Altitude" tag="METRES">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} domain={["auto", "auto"]} />
              <Tooltip {...chartTooltip} />
              <Line type="monotone" dataKey="alt" name="Altitude m" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Pressure Distribution" tag="SAMPLE COUNT">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bins} layout="vertical">
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axis} /><YAxis type="category" dataKey="range" {...axis} width={90} />
              <Tooltip {...chartTooltip} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Sample-to-Sample Change" tag="LAST 30">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={deltas}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={30} /><YAxis {...axis} />
              <Tooltip {...chartTooltip} cursor={{ fill: "var(--muted)" }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="d" name="Δ hPa" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Altitude is estimated from the standard atmosphere (1013.25 hPa) and shifts with the weather, so use it for relative changes rather than absolute height.</p>
    </div>
  );
}
