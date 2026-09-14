'use client';
import { useState, useEffect } from 'react';
import { Plus, Copy, Save, Upload, Download, Check, Users } from 'lucide-react';
import {
  type DataSet,
  type Plan,
  type Person,
  DAYS,
  PEOPLE,
  NAMES,
  SLOTS,
  SLOT_LABELS,
  blankDay,
  blankPlan,
  monday,
  today,
  addDays,
  prettyDate,
  validatePlan,
} from '../../lib/nutrition/model';
import { download, exportData } from '../../lib/nutrition/export';
import { HealthAdmin } from './Health';
type Props = {
  demo: boolean;
  data: DataSet;
  busy: boolean;
  onSave: (p: Plan, publish: boolean) => Promise<void>;
  notify: (s: string) => void;
};
export default function Admin({ data, busy, onSave, notify, demo }: Props) {
  const [selected, setSelected] = useState(''),
    [edit, setEdit] = useState<Plan | null>(null),
    [person, setPerson] = useState<Person>('carlitos'),
    [day, setDay] = useState(0),
    [week, setWeek] = useState(monday(today())),
    [exportPerson, setExportPerson] = useState<Person | 'all'>('all'),
    [from, setFrom] = useState(addDays(today(), -28)),
    [to, setTo] = useState(today()),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(fn: (p: Plan) => void) {
    if (!edit) return;
    const p = structuredClone(edit);
    fn(p);
    p.reviewed = false;
    setEdit(p);
    setDirty(true);
  }
  function open(p: Plan) {
    if (
      dirty &&
      !window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos?')
    )
      return;
    setSelected(p.id);
    setEdit(structuredClone(p));
    setWeek(p.week);
    setDirty(false);
  }
  async function save(publish: boolean) {
    if (!edit) return;
    try {
      if (publish) validatePlan(edit);
      await onSave(edit, publish);
      setEdit(null);
      setDirty(false);
      setSelected('');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function importPlan(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('El archivo supera 2 MB.');
      const p = JSON.parse(await file.text()) as Plan;
      if (
        !p.members?.length ||
        !Array.isArray(p.shared) ||
        p.shared.length !== 14
      )
        throw new Error('No es un archivo de importación válido.');
      const sharedKeys = new Set<string>();
      for (const meal of p.shared) {
        if (
          !Number.isInteger(meal.day) ||
          meal.day < 0 ||
          meal.day > 6 ||
          !['comida', 'cena'].includes(meal.slot) ||
          typeof meal.title !== 'string' ||
          typeof meal.instructions !== 'string'
        )
          throw new Error('Formato de plato compartido no válido.');
        sharedKeys.add(meal.day + ':' + meal.slot);
      }
      if (
        sharedKeys.size !== 14 ||
        new Set(p.members.map((m) => m.member_id)).size !== p.members.length
      )
        throw new Error('El archivo contiene días o personas duplicados.');
      for (const m of p.members) {
        if (!PEOPLE.includes(m.member_id) || m.days?.length !== 7)
          throw new Error('Perfil o días no válidos.');
        if (typeof m.notes !== 'string' || typeof m.source !== 'string')
          throw new Error('Faltan las notas o la procedencia del plan.');
        for (const d of m.days) {
          if (typeof d.notes !== 'string')
            throw new Error('Formato de notas no válido.');
          for (const s of SLOTS) {
            if (
              typeof d.meals?.[s]?.portion !== 'string' ||
              typeof d.meals[s].title !== 'string' ||
              typeof d.meals[s].substitution !== 'string'
            )
              throw new Error('Formato de comida no válido.');
          }
          for (const k of [
            'title',
            'details',
            'rest',
            'intensity',
            'exercises',
          ])
            if (
              typeof (d.workout as unknown as Record<string, unknown>)?.[k] !==
              'string'
            )
              throw new Error('Formato de rutina no válido.');
        }
      }
      p.id = crypto.randomUUID();
      p.status = 'draft';
      p.revision = 0;
      p.reviewed = false;
      p.week = week;
      open(p);
      notify('Borradores cargados. Revisa y guarda para importarlos.');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const member = edit?.members.find((m) => m.member_id === person),
    current = member?.days[day],
    locked = edit?.status === 'published';
  function newDraft() {
    if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return;
    const p = blankPlan(week);
    setEdit(p);
    setSelected('');
    setDirty(false);
  }
  function duplicate() {
    if (!edit) return;
    const p = structuredClone(edit);
    p.id = crypto.randomUUID();
    p.week = week;
    p.status = 'draft';
    p.revision = 0;
    p.reviewed = false;
    setEdit(p);
    setDirty(true);
    setSelected('');
  }
  return (
    <div className="admin-layout">
      <HealthAdmin data={data} onOpen={open} notify={notify} demo={demo} />
      <div className="card">
        <div className="section-title">
          <div>
            <span className="eyebrow">PLANIFICACIÓN</span>
            <h3>Los planes de la familia</h3>
          </div>
          <Users size={24} />
        </div>
        <div className="admin-toolbar">
          <details
            className="admin-guide"
            open={data.plans.every((p) => p.status === 'draft')}
          >
            <summary>Cómo preparar y publicar una dieta</summary>
            <ol>
              <li>
                Abre una semana de la lista. Si ya está publicada, usa
                «Duplicar» para preparar otra versión.
              </li>
              <li>
                Elige el día y la persona. Escribe el plato, sus cantidades y el
                entrenamiento. Comida y cena tienen un plato base común.
              </li>
              <li>
                «Guardar borrador» guarda tu trabajo, pero aún no lo muestra en
                «Hoy».
              </li>
              <li>
                Revisa los siete días, marca la casilla de revisión y pulsa
                «Publicar semana». Se publica solo para las personas incluidas
                en ese plan.
              </li>
            </ol>
            <p className="hint">
              Los cambios de dieta se guardan directamente aquí: no necesitas
              subir la web otra vez a Cloudflare. Puedes registrar tu descanso
              aunque no haya plan publicado.
            </p>
          </details>
          <label>
            Semana de destino
            <input
              type="date"
              value={week}
              onChange={(e) =>
                e.target.value && setWeek(monday(e.target.value))
              }
            />
          </label>
          <button className="secondary" onClick={newDraft}>
            <Plus size={17} /> Crear borrador
          </button>
          <label className="secondary file-button">
            <Upload size={17} /> Importar borradores
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                void importPlan(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="hint">
          Si tu dieta ya está en la lista, ábrela directamente. «Importar
          borradores» acepta un archivo JSON preparado con el formato de la
          aplicación; no admite Excel o PDF directamente.
        </p>
        <div className="plan-list">
          {[...data.plans]
            .sort(
              (a, b) => b.week.localeCompare(a.week) || b.version - a.version,
            )
            .map((p) => (
              <button
                key={p.id}
                className={'plan-item ' + (selected === p.id ? 'selected' : '')}
                onClick={() => open(p)}
              >
                <span>
                  <strong>Semana del {prettyDate(p.week, true)}</strong>
                  <small>
                    {p.members.map((m) => NAMES[m.member_id]).join(' · ')} ·
                    Versión {p.version}
                  </small>
                </span>
                <span
                  className={'badge ' + (p.status === 'draft' ? 'amber' : '')}
                >
                  {p.status === 'draft' ? 'Borrador' : 'Publicado'}
                </span>
              </button>
            ))}
          {!data.plans.length && (
            <div className="empty">
              Todavía no hay planes. Crea uno o importa tus borradores.
            </div>
          )}
        </div>
      </div>
      {edit && (
        <section className="card editor">
          <div className="section-title">
            <h3>
              {locked ? 'Plan publicado' : 'Editar borrador'} ·{' '}
              {prettyDate(edit.week, true)}
            </h3>
            <button className="secondary" onClick={duplicate}>
              <Copy size={16} /> Duplicar a {prettyDate(week, true)}
            </button>
          </div>
          {locked && (
            <p className="notice">
              Este plan forma parte del historial. Duplícalo para realizar
              cambios.
            </p>
          )}
          <div className="day-tabs">
            {DAYS.map((d, i) => (
              <button
                key={d}
                className={day === i ? 'active' : ''}
                onClick={() => setDay(i)}
              >
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
          <fieldset disabled={locked || busy}>
            <legend>Platos compartidos · {DAYS[day]}</legend>
            <p className="hint">
              El plato base es común. Las raciones y excepciones se editan
              debajo, por persona.
            </p>
            {(['comida', 'cena'] as const).map((slot) => {
              const base = edit.shared.find(
                (s) => s.day === day && s.slot === slot,
              );
              return (
                <div className="shared-editor" key={slot}>
                  <label>
                    {SLOT_LABELS[slot]} familiar
                    <input
                      value={base?.title || ''}
                      placeholder="Ej. Arroz con pollo y verduras"
                      onChange={(e) =>
                        change((p) => {
                          const b = p.shared.find(
                            (s) => s.day === day && s.slot === slot,
                          )!;
                          b.title = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Preparación común
                    <textarea
                      rows={2}
                      value={base?.instructions || ''}
                      onChange={(e) =>
                        change((p) => {
                          p.shared.find(
                            (s) => s.day === day && s.slot === slot,
                          )!.instructions = e.target.value;
                        })
                      }
                    />
                  </label>
                </div>
              );
            })}
          </fieldset>
          <div className="person-tabs">
            {PEOPLE.map((id) => (
              <button
                key={id}
                className={person === id ? 'active' : ''}
                onClick={() => setPerson(id)}
              >
                {NAMES[id]}
              </button>
            ))}
          </div>
          {!member ? (
            <div className="empty">
              <h3>Plan de {NAMES[person]} pendiente</h3>
              <p>Las cantidades y rutinas se definirán individualmente.</p>
              <button
                className="secondary"
                disabled={locked}
                onClick={() =>
                  change((p) =>
                    p.members.push({
                      member_id: person,
                      days: Array.from({ length: 7 }, blankDay),
                      notes: '',
                      source: 'Creado en la web',
                    }),
                  )
                }
              >
                <Plus size={16} /> Añadir a esta semana
              </button>
            </div>
          ) : (
            <fieldset disabled={locked || busy}>
              <legend>
                Plan de {NAMES[person]} · {DAYS[day]}
              </legend>
              {member.source && <p className="hint">Origen: {member.source}</p>}
              <label>
                Notas del plan personal
                <textarea
                  value={member.notes}
                  rows={2}
                  onChange={(e) =>
                    change((p) => {
                      p.members.find((m) => m.member_id === person)!.notes =
                        e.target.value;
                    })
                  }
                />
              </label>
              {SLOTS.map((slot) => (
                <div className="meal-editor" key={slot}>
                  <h4>{SLOT_LABELS[slot]}</h4>
                  <label>
                    {slot === 'comida' || slot === 'cena'
                      ? 'Plato original / referencia personal'
                      : 'Nombre del plato'}
                    <input
                      value={current!.meals[slot].title}
                      onChange={(e) =>
                        change((p) => {
                          p.members.find((m) => m.member_id === person)!.days[
                            day
                          ].meals[slot].title = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Cantidades y unidades
                    <textarea
                      rows={3}
                      value={current!.meals[slot].portion}
                      onChange={(e) =>
                        change((p) => {
                          p.members.find((m) => m.member_id === person)!.days[
                            day
                          ].meals[slot].portion = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Sustitución o excepción{' '}
                    <span className="muted">(opcional)</span>
                    <input
                      value={current!.meals[slot].substitution}
                      onChange={(e) =>
                        change((p) => {
                          p.members.find((m) => m.member_id === person)!.days[
                            day
                          ].meals[slot].substitution = e.target.value;
                        })
                      }
                    />
                  </label>
                  {(slot === 'comida' || slot === 'cena') && (
                    <p className="hint">
                      Comprueba que estas cantidades correspondan al plato
                      familiar o explica la excepción.
                    </p>
                  )}
                </div>
              ))}
              <div className="meal-editor">
                <h4>Entrenamiento</h4>
                {(
                  [
                    { key: 'title', label: 'Entrenamiento o descanso' },
                    {
                      key: 'details',
                      label: 'Indicaciones y duración del cardio',
                    },
                    { key: 'intensity', label: 'Intensidad prevista' },
                    { key: 'rest', label: 'Descansos' },
                    {
                      key: 'exercises',
                      label:
                        'Ejercicios · series · repeticiones (uno por línea)',
                    },
                  ] as const
                ).map((f) => (
                  <label key={f.key}>
                    {f.label}
                    <textarea
                      rows={f.key === 'exercises' ? 5 : 2}
                      value={current!.workout[f.key]}
                      onChange={(e) =>
                        change((p) => {
                          p.members.find((m) => m.member_id === person)!.days[
                            day
                          ].workout[f.key] = e.target.value;
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Notas del día
                  <textarea
                    value={current!.notes}
                    rows={2}
                    onChange={(e) =>
                      change((p) => {
                        p.members.find((m) => m.member_id === person)!.days[
                          day
                        ].notes = e.target.value;
                      })
                    }
                  />
                </label>
              </div>
            </fieldset>
          )}
          {!locked && (
            <div className="editor-footer">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={edit.reviewed}
                  onChange={(e) => {
                    setEdit({ ...edit, reviewed: e.target.checked });
                    setDirty(true);
                  }}
                />{' '}
                He revisado los siete días, las comidas comunes, las raciones
                individuales y sus excepciones.
              </label>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  <Save size={17} /> Guardar borrador
                </button>
                <button
                  className="primary"
                  disabled={busy || !edit.reviewed}
                  onClick={() => void save(true)}
                >
                  <Check size={17} /> Publicar semana
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <section className="card">
        <div className="section-title">
          <div>
            <span className="eyebrow">TUS DATOS</span>
            <h3>Exportar seguimiento</h3>
          </div>
          <Download size={23} />
        </div>
        <div className="form-grid">
          <label>
            Persona
            <select
              value={exportPerson}
              onChange={(e) =>
                setExportPerson(e.target.value as Person | 'all')
              }
            >
              <option value="all">Toda la familia</option>
              {PEOPLE.map((p) => (
                <option key={p} value={p}>
                  {NAMES[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={!from || !to || from > to}
            onClick={() =>
              download(
                exportData(data, exportPerson, from, to),
                'seguimiento-' + from + '-' + to + '.zip',
              )
            }
          >
            <Download size={17} /> Descargar CSV en ZIP
          </button>
          <button
            className="secondary"
            onClick={() =>
              download(
                exportData(data, 'all', from, to, true),
                'respaldo-nutricion-' + today() + '.zip',
              )
            }
          >
            Respaldo completo
          </button>
        </div>
        <p className="hint">
          Incluye los registros y los planes del periodo. Guarda estos archivos
          en un lugar privado.
        </p>
      </section>
    </div>
  );
}
