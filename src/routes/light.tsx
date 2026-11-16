import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Lightbulb, SunMedium, Moon, Gauge as GaugeIcon } from "lucide-react";
import { useTelemetry, fmtTime, fmtDateTime } from "@/lib/telemetry";
import { PageHeader, Panel, StatCard, Gauge, StatusBadge, DisabledNotice, chartTooltip, axis } from "@/components/eco/widgets";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/light")({
  head: () => meta("Light Intensity", "Ambient light (lux) from the ESP32 light sensor with trends, peaks and brightness distribution."),
  component: Light,
});

const band = (lux: number) =>
  lux < 10 ? { label: "Dark", tone: "warning" as const }
  : lux < 200 ? { label: "Dim", tone: "warning" as const }
  : lux < 1000 ? { label: "Indoor", tone: "success" as const }
  : lux < 10000 ? { label: "Bright", tone: "success" as const }
  : { label: "Direct sunlight", tone: "warning" as const };

const fmtLux = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));

function Light() {
  const { readings, latest, enabled } = useTelemetry();
  if (!latest) return null;
  if (!enabled("light")) return <DisabledNotice what="The light intensity sensor" />;
  const luxOf = (r: (typeof readings)[number]) => r.lux ?? 0;
  const lux = luxOf(latest);
  const all = readings.map(luxOf);
  const max = Math.max(...all);
  const min = Math.min(...all);
  const avg = all.reduce((s, v) => s + v, 0) / (all.length || 1);
  const peak = readings.reduce((a, b) => (luxOf(b) > luxOf(a) ? b : a), latest);
  const data = readings.slice(-120).map((r) => ({ t: fmtTime(r.ts), lux: +luxOf(r).toFixed(0), temp: +r.temperature.toFixed(1) }));
  const bins = ([[0, 10, "Dark <10"], [10, 200, "Dim 10-200"], [200, 1000, "Indoor 200-1k"], [1000, 10000, "Bright 1k-10k"], [10000, 1e12, "Sun 10k+"]] as [number, number, string][]).map(([lo, hi, label]) => ({
    range: label, count: all.filter((v) => v >= lo && v < hi).length,
  }));
  const b = band(lux);

  return (
    <div>
      <PageHeader code="09 / LIGHT" title="Light Intensity" subtitle="Ambient illuminance (lux) reported by the ESP32 light sensor." />
      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Illuminance" tag="lux" className="flex flex-col items-center md:row-span-2">
          <Gauge value={lux} max={2000} label="Ambient light" unit="lx" warn={1e9} danger={1e9} size={220} />
          <div className="mt-2"><StatusBadge {...b} /></div>
        </Panel>
        <StatCard accent label="Current" value={fmtLux(lux)} unit="lx" icon={<Lightbulb className="h-4 w-4" />} />
        <StatCard label="Average" value={fmtLux(avg)} unit="lx" icon={<GaugeIcon className="h-4 w-4" />} />
        <StatCard label="Peak" value={fmtLux(max)} unit="lx" icon={<SunMedium className="h-4 w-4" />} sub={fmtDateTime(peak.ts)} />
        <StatCard label="Minimum" value={fmtLux(min)} unit="lx" icon={<Moon className="h-4 w-4" />} />
        <StatCard label="Condition" value={b.label} />
        <StatCard label="Samples" value={String(readings.length)} />
      </div>
      <Panel title="Light Trend" tag="LIVE · 120 SAMPLES" className="mt-4">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs><linearGradient id="lx" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} />
            <Tooltip {...chartTooltip} />
            <Area type="monotone" dataKey="lux" name="Lux" stroke="var(--chart-1)" fill="url(#lx)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Light vs Temperature" tag="OVERLAY">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" {...axis} minTickGap={40} />
              <YAxis yAxisId="l" {...axis} /><YAxis yAxisId="r" orientation="right" {...axis} />
              <Tooltip {...chartTooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" type="monotone" dataKey="lux" name="Lux" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="temp" name="Temp °C" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Brightness Distribution" tag="SAMPLE COUNT">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bins} layout="vertical">
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axis} /><YAxis type="category" dataKey="range" {...axis} width={100} />
              <Tooltip {...chartTooltip} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}
