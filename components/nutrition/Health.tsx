'use client';
import { useState } from 'react';
import {
  type DataSet,
  type Person,
  type Plan,
  prettyDate,
} from '../../lib/nutrition/model';
import { HEALTH_LABELS } from '../../lib/nutrition/health';
import { supabase } from '../../lib/nutrition/repository';

export function HealthHistory({
  data,
  person,
}: {
  data: DataSet;
  person: Person;
}) {
  const [metric, setMetric] = useState('');
  const samples = (data.healthSamples ?? []).filter(
    (s) => s.member_id === person,
  );
  if (person !== 'carlitos') return null;
  const selected = samples
    .filter((s) => !metric || s.metric === metric)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.metric.localeCompare(b.metric),
    );
  return (
    <section className="card">
      <div className="section-title">
        <h3>Apple Health · Freddy</h3>
        <span className="badge subtle">Datos importados</span>
      </div>
      <p className="hint">
        Cada dato conserva su fecha y dispositivo. Estos registros no sustituyen
        tus correcciones manuales. Las fuentes que coinciden no se suman.
      </p>
      <label>
        Ver métrica
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value="">Todas</option>
          {[...new Set(samples.map((s) => s.metric))].sort().map((m) => (
            <option key={m} value={m}>
              {HEALTH_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </label>
      <div className="history">
        {selected.slice(0, 40).map((s) => (
          <div className="health-row" key={s.id}>
            <strong>{HEALTH_LABELS[s.metric] ?? s.metric}</strong>
            <span>
              {s.value == null
                ? 'Detalle disponible en la exportación'
                : `${s.value.toLocaleString('es-ES')} ${s.unit}`}{' '}
              · {prettyDate(s.date, true)} · {s.source}
            </span>
          </div>
        ))}
      </div>
      {!samples.length && (
        <p className="muted">Todavía no hay una importación guardada.</p>
      )}
      {selected.length > 40 && (
        <p className="hint">
          Mostrando los 40 registros más recientes. El historial completo está
          incluido en la exportación.
        </p>
      )}
    </section>
  );
}

export function HealthAdmin({
  data,
  onOpen,
  notify,
  demo,
}: {
  data: DataSet;
  onOpen: (p: Plan) => void;
  notify: (s: string) => void;
  demo: boolean;
}) {
  const initial = data.coachingSettings?.find(
    (s) => s.member_id === 'carlitos',
  );
  const [goal, setGoal] = useState(initial?.goal ?? '');
  const [restrictions, setRestrictions] = useState(initial?.restrictions ?? '');
  const [saving, setSaving] = useState(false);
  const reports = [...(data.healthReports ?? [])].sort((a, b) =>
    b.period_start.localeCompare(a.period_start),
  );
  return (
    <section className="card">
      <h2>Revisión semanal de Carlitos</h2>
      <p className="muted">
        Sábados a las 10:00, hora de Madrid. Se revisan los siete días completos
        de sábado a viernes y se prepara el lunes siguiente. La publicación
        requiere tu revisión.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            if (demo) {
              notify('Contexto guardado solo en esta demostración.');
              return;
            }
            if (!supabase) throw new Error('No hay conexión.');
            const { error } = await supabase
              .from('coaching_settings')
              .upsert({
                member_id: 'carlitos',
                goal: goal.trim(),
                restrictions: restrictions.trim(),
                updated_at: new Date().toISOString(),
              });
            if (error) throw error;
            notify('Objetivo y restricciones guardados.');
          } catch (error) {
            notify((error as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Objetivo confirmado
          <textarea
            rows={2}
            maxLength={2000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Qué quieres conseguir y en qué plazo, sin necesidad de fijar un peso."
          />
        </label>
        <label>
          Restricciones y contexto
          <textarea
            rows={2}
            maxLength={4000}
            value={restrictions}
            onChange={(e) => setRestrictions(e.target.value)}
            placeholder="Alergias, lesiones, disponibilidad para entrenar y preferencias relevantes."
          />
        </label>
        <button className="secondary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar contexto'}
        </button>
      </form>
      <p className="hint">
        Sin objetivo confirmado o con datos insuficientes, el informe explica lo
        que falta y conserva el plan de referencia. Los errores de conexión se
        notifican en la tarea programada.
      </p>
      {!reports.length && (
        <p className="muted">Aún no se ha completado una revisión.</p>
      )}
      {reports.map((r) => {
        const draft = data.plans.find((p) => p.id === r.draft_plan_id);
        return (
          <article className="health-report" key={r.id}>
            {r.kind === 'manual' && (
              <p className="hint">Revisión adicional solicitada</p>
            )}
            <div className="section-title">
              <h3>
                {prettyDate(r.period_start, true)} –{' '}
                {prettyDate(r.period_end, true)}
              </h3>
              <span className="badge">
                {r.status === 'ready'
                  ? 'Propuesta preparada'
                  : r.status === 'error'
                    ? 'No se pudo completar'
                    : 'Faltan datos'}
              </span>
            </div>
            <p className="health-summary">{r.summary}</p>
            {r.changes.map((c, i) => (
              <div className="health-change" key={i}>
                <strong>{c.area}</strong>
                <p>Antes: {c.before}</p>
                <p>Propuesta: {c.after}</p>
                <p className="hint">{c.reason}</p>
              </div>
            ))}
            <p className="hint">
              Plan para la semana del {prettyDate(r.target_week)}. Informe
              guardado el{' '}
              {new Date(r.created_at).toLocaleString('es-ES', {
                timeZone: 'Europe/Madrid',
              })}
              .
            </p>
            {draft ? (
              <button className="secondary" onClick={() => onOpen(draft)}>
                {draft.status === 'published'
                  ? 'Ver versión publicada'
                  : 'Revisar y editar borrador'}
              </button>
            ) : (
              <p className="hint">
                Sin borrador asociado. Puedes crear un plan desde el editor.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
