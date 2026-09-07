import { zipSync, strToU8 } from 'fflate';
import { type DataSet, type Person, addDays } from './model';
export function csvCell(value: unknown) {
  let s =
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function csv(rows: object[]) {
  if (!rows.length) return '\uFEFF';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    '\uFEFF' +
    [
      keys.map(csvCell).join(';'),
      ...rows.map((row) =>
        keys.map((k) => csvCell((row as Record<string, unknown>)[k])).join(';'),
      ),
    ].join('\r\n')
  );
}
export function exportData(
  data: DataSet,
  person: Person | 'all',
  from: string,
  to: string,
  backup = false,
) {
  const selected = (m: string) => person === 'all' || m === person;
  const inRange = (d: string) => d >= from && d <= to;
  const plans = data.plans
    .filter(
      (p) =>
        backup ||
        (p.status === 'published' &&
          p.week <= to &&
          addDays(p.week, 6) >= from),
    )
    .map((p) => ({
      ...p,
      members: p.members.filter((m) => selected(m.member_id)),
    }))
    .filter((p) => p.members.length);
  const entries: Record<string, Uint8Array> = {};
  const files: Record<string, object[]> = {
    perfiles: data.profiles
      .filter((p) => selected(p.id))
      .map(({ user_id: _user_id, ...rest }) => rest),
    registros: data.daily.filter(
      (r) => selected(r.member_id) && (backup || inRange(r.date)),
    ),
    medidas: data.measurements.filter(
      (r) => selected(r.member_id) && (backup || inRange(r.date)),
    ),
    revisiones: data.reviews.filter(
      (r) =>
        selected(r.member_id) &&
        (backup || (r.week <= to && addDays(r.week, 6) >= from)),
    ),
    planes: plans.map(
      ({ members: _members, shared: _shared, ...rest }) => rest,
    ),
    platos_compartidos: plans.flatMap((p) =>
      p.shared.map((s) => ({ ...s, plan_id: p.id })),
    ),
    planes_personales: plans.flatMap((p) =>
      p.members.map((m) => ({ ...m, plan_id: p.id })),
    ),
    comidas: plans.flatMap((p) =>
      p.members.flatMap((m) =>
        m.days.flatMap((d, i) =>
          Object.entries(d.meals).map(([slot, meal]) => ({
            plan_id: p.id,
            member_id: m.member_id,
            date: addDays(p.week, i),
            slot,
            ...meal,
            plato_compartido:
              p.shared.find((s) => s.day === i && s.slot === slot)?.title || '',
          })),
        ),
      ),
    ),
    entrenamientos: plans.flatMap((p) =>
      p.members.flatMap((m) =>
        m.days.map((d, i) => ({
          plan_id: p.id,
          member_id: m.member_id,
          date: addDays(p.week, i),
          ...d.workout,
        })),
      ),
    ),
  };
  for (const [name, records] of Object.entries(files))
    entries[name + '.csv'] = strToU8(csv(records));
  entries['LEEME.txt'] = strToU8(
    'Nutrición en Familia\nCSV UTF-8, separador punto y coma. Fechas YYYY-MM-DD (Europe/Madrid).\nPeso en kg y medidas en cm. Sin datos no equivale a incumplimiento.\nDescanso diario: sleep_hours=horas de la noche anterior (0-24); sleep_quality=calidad (1 muy mala, 5 muy buena). Vacío=sin registrar.\nEstados: done=completo; partial=parcial; missed=no realizado.\nLos planes publicados son versiones inmutables; para cada semana se aplica la última versión publicada que incluya a la persona.\nExportación sin contraseñas ni sesiones.\n',
  );
  if (backup)
    entries['respaldo.json'] = strToU8(
      JSON.stringify(
        { schema_version: 1, exported_at: new Date().toISOString(), ...data },
        null,
        2,
      ),
    );
  return zipSync(entries);
}
export function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
