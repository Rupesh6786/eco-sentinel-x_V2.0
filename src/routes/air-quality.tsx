import { createFileRoute } from "@tanstack/react-router";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { useTelemetry, classify, fmtTime } from "@/lib/telemetry";
import { PageHeader, Panel, Gauge, StatusBadge, StatCard, DisabledNotice, chartTooltip, axis } from "@/components/eco/widgets";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/air-quality")({
  head: () => meta("Air Quality", "MQ-2 smoke/LPG, MQ-7 carbon monoxide and MQ-135 air quality concentrations with safety thresholds."),
  component: AirQuality,
});

function AirQuality() {
  const { readings, latest, settings, enabled } = useTelemetry();
  if (!latest) return null;
  const data = readings.slice(-120).map((r) => ({ t: fmtTime(r.ts), mq2: +r.mq2_ppm.toFixed(1), mq7: +r.mq7_ppm.toFixed(1), mq135: +r.mq135_ppm.toFixed(1), aqi: r.aqi }));
  const c2 = classify(latest.mq2_ppm, settings.mq2_threshold * 0.7, settings.mq2_threshold);
  const c7 = classify(latest.mq7_ppm, settings.mq7_threshold * 0.7, settings.mq7_threshold);
  const c135 = classify(latest.mq135_ppm, settings.mq135_threshold * 0.7, settings.mq135_threshold);
  const max2 = Math.max(...readings.map((r) => r.mq2_ppm));
  const max7 = Math.max(...readings.map((r) => r.mq7_ppm));
  const max135 = Math.max(...readings.map((r) => r.mq135_ppm));
  const aqiColor = (v: number) => (v >= 150 ? "var(--destructive)" : v >= 100 ? "var(--warning)" : "var(--primary)");
  const anyGas = enabled("mq2") || enabled("mq7") || enabled("mq135");

  return (
    <div>
      <PageHeader code="02 / GAS SENSORS" title="Air Quality" subtitle="MQ-2 (Smoke / LPG), MQ-7 (Carbon Monoxide) and MQ-135 (air quality) live concentrations." />
      {!anyGas && <DisabledNotice what="Every gas sensor (MQ-2, MQ-7, MQ-135)" />}
      <div className="grid gap-4 md:grid-cols-3">
        {enabled("mq2") && (
          <Panel title="MQ-2 · Smoke / LPG" tag="ppm" className="flex flex-col items-center">
            <Gauge value={latest.mq2_ppm} max={1000} label="Concentration" unit="ppm" warn={settings.mq2_threshold * 0.7} danger={settings.mq2_threshold} size={240} />
            <div className="mt-2"><StatusBadge {...c2} /></div>
          </Panel>
        )}
        {enabled("mq7") && (
          <Panel title="MQ-7 · Carbon Monoxide" tag="ppm" className="flex flex-col items-center">
            <Gauge value={latest.mq7_ppm} max={200} label="Concentration" unit="ppm" warn={settings.mq7_threshold * 0.7} danger={settings.mq7_threshold} size={240} />
            <div className="mt-2"><StatusBadge {...c7} /></div>
          </Panel>
        )}
        {enabled("mq135") && (
          <Panel title="MQ-135 · Air Quality" tag="ppm" className="flex flex-col items-center">
            <Gauge value={latest.mq135_ppm} max={500} label="NH₃ / Benzene / CO₂ eq." unit="ppm" warn={settings.mq135_threshold * 0.7} danger={settings.mq135_threshold} size={240} />
            <div className="mt-2"><StatusBadge {...c135} /></div>
          </Panel>
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {enabled("mq2") && <>
          <StatCard label="MQ-2 Peak" value={max2.toFixed(0)} unit="ppm" />
          <StatCard label="MQ-2 Limit" value={String(settings.mq2_threshold)} unit="ppm" />
        </>}
        {enabled("mq7") && <>
          <StatCard label="MQ-7 Peak" value={max7.toFixed(0)} unit="ppm" />
          <StatCard label="MQ-7 Limit" value={String(settings.mq7_threshold)} unit="ppm" />
        </>}
        {enabled("mq135") && <>
          <StatCard label="MQ-135 Peak" value={max135.toFixed(0)} unit="ppm" />
          <StatCard label="MQ-135 Limit" value={String(settings.mq135_threshold)} unit="ppm" />
        </>}
      </div>
      {enabled("mq2") && (
        <Panel title="MQ-2 Concentration" tag="THRESHOLD CODED" className="mt-4">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} />
              <Tooltip {...chartTooltip} />
              <ReferenceLine y={settings.mq2_threshold * 0.7} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: "Moderate", fill: "var(--warning)", fontSize: 10 }} />
              <ReferenceLine y={settings.mq2_threshold} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: "Hazard", fill: "var(--destructive)", fontSize: 10 }} />
              <Line type="monotone" dataKey="mq2" name="MQ-2 ppm" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {enabled("mq7") && (
          <Panel title="MQ-7 Concentration" tag="CO">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} />
                <Tooltip {...chartTooltip} />
                <ReferenceLine y={settings.mq7_threshold} stroke="var(--destructive)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="mq7" name="MQ-7 ppm" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}
        {enabled("mq135") && (
          <Panel title="MQ-135 Concentration" tag="AIR QUALITY">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="t" {...axis} minTickGap={40} /><YAxis {...axis} />
                <Tooltip {...chartTooltip} />
                <ReferenceLine y={settings.mq135_threshold} stroke="var(--destructive)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="mq135" name="MQ-135 ppm" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}
        <Panel title="AQI History" tag="LAST 30">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.slice(-30)}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={30} /><YAxis {...axis} />
              <Tooltip {...chartTooltip} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="aqi" name="AQI" radius={[3, 3, 0, 0]}>{data.slice(-30).map((d, i) => <Cell key={i} fill={aqiColor(d.aqi)} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}
