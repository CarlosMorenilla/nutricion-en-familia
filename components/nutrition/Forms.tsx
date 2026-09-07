'use client';
import { useState } from 'react';
import { Save, ChevronDown, Trash2 } from 'lucide-react';
import {
  type Person,
  type Daily,
  type Measurement,
  type Review,
  type Status,
  MEASURES,
  MEASURE_LABELS,
  decimal,
  today,
  monday,
} from '../../lib/nutrition/model';
export function CheckIn({
  person,
  date,
  record,
  onSave,
  busy,
}: {
  person: Person;
  date: string;
  record?: Daily;
  onSave: (r: Daily) => void;
  busy: boolean;
}) {
  const [diet, setDiet] = useState<Status>(record?.diet ?? null),
    [training, setTraining] = useState<Status>(record?.training ?? null),
    [comment, setComment] = useState(record?.comment || ''),
    [sleepHours, setSleepHours] = useState(
      record?.sleep_hours?.toString().replace('.', ',') ?? '',
    ),
    [sleepQuality, setSleepQuality] = useState<number | null>(
      record?.sleep_quality ?? null,
    ),
    [error, setError] = useState('');
  const fields = [
    {
      label: '¿Cómo ha ido la alimentación?',
      value: diet,
      set: setDiet,
      options: ['Seguí el plan', 'En parte', 'No lo seguí'],
    },
    {
      label: '¿Y el entrenamiento?',
      value: training,
      set: setTraining,
      options: ['Hecho', 'Parcial', 'No realizado'],
    },
  ];
  return (
    <form
      className="card check-in"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const sleep_hours = decimal(sleepHours, 0, 24);
          setError('');
          onSave({
            member_id: person,
            date,
            diet,
            training,
            comment,
            sleep_hours,
            sleep_quality: sleepQuality,
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="section-title">
        <h3>Tu día, en un momento</h3>
        <span className="badge">Registro rápido</span>
      </div>
      <fieldset>
        <legend>¿Cómo has dormido?</legend>
        <p className="hint">
          El descanso de la noche anterior. Todo es opcional.
        </p>
        <label>
          Horas de sueño
          <input
            inputMode="decimal"
            placeholder="Ej. 7,5"
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
          />
        </label>
        <div className="scale">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              aria-label={'Calidad del sueño: ' + n + ' de 5'}
              aria-pressed={sleepQuality === n}
              className={sleepQuality === n ? 'chosen' : ''}
              onClick={() => setSleepQuality(sleepQuality === n ? null : n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="scale-labels">
          <span>Muy mala</span>
          <span>Muy buena</span>
        </div>
      </fieldset>
      {fields.map((f) => (
        <fieldset key={f.label}>
          <legend>{f.label}</legend>
          <div className="choices">
            {f.options.map((label, i) => (
              <button
                type="button"
                key={label}
                aria-pressed={f.value === ['done', 'partial', 'missed'][i]}
                className={
                  f.value === ['done', 'partial', 'missed'][i] ? 'chosen' : ''
                }
                onClick={() =>
                  f.set(
                    f.value === ['done', 'partial', 'missed'][i]
                      ? null
                      : (['done', 'partial', 'missed'][i] as Status),
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <label>
        Algo que quieras comentar <span className="muted">(opcional)</span>
        <textarea
          maxLength={2000}
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Hoy me ha resultado más fácil…"
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy || date > today()}>
        <Save size={17} /> Guardar mi día
      </button>
      {date > today() && (
        <p className="muted">Podrás registrar este día cuando llegue.</p>
      )}
    </form>
  );
}
export function MeasurementForm({
  person,
  date,
  record,
  onSave,
  onDelete,
  busy,
}: {
  person: Person;
  date: string;
  record?: Measurement;
  onSave: (r: Measurement) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [values, setValues] = useState(
      Object.fromEntries(
        MEASURES.map((k) => [
          k,
          record?.[k]?.toString().replace('.', ',') || '',
        ]),
      ),
    ),
    [error, setError] = useState('');
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const numbers = Object.fromEntries(
            MEASURES.map((k) => [
              k,
              decimal(values[k], 0.1, k === 'weight' ? 400 : 300),
            ]),
          );
          if (Object.values(numbers).every((v) => v === null))
            throw new Error('Introduce al menos un peso o una medida.');
          setError('');
          onSave({ member_id: person, date, ...numbers } as Measurement);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="section-title">
        <h3>Registrar mis medidas</h3>
        <span className="badge subtle">A tu ritmo</span>
      </div>
      <label>
        Peso <span className="muted">kg</span>
        <input
          aria-label="Peso en kilogramos"
          inputMode="decimal"
          placeholder="Ej. 74,5"
          value={values.weight}
          onChange={(e) => setValues({ ...values, weight: e.target.value })}
        />
      </label>
      <details open={MEASURES.slice(1).some((k) => record?.[k] != null)}>
        <summary>
          Otras medidas opcionales <ChevronDown size={16} />
        </summary>
        <div className="form-grid">
          {MEASURES.slice(1).map((k) => (
            <label key={k}>
              {MEASURE_LABELS[k]} <span className="muted">cm</span>
              <input
                inputMode="decimal"
                value={values[k]}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || date > today()}>
          <Save size={17} /> Guardar medidas
        </button>
        {record && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={16} /> Eliminar registro
          </button>
        )}
      </div>
      <p className="hint">
        No hace falta pesarse cada día. Registra cuando te venga bien.
      </p>
    </form>
  );
}
export function WeeklyReview({
  person,
  week,
  record,
  onSave,
  busy,
}: {
  person: Person;
  week: string;
  record?: Review;
  onSave: (r: Review) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState({
      hunger: record?.hunger ?? 0,
      energy: record?.energy ?? 0,
      sleep: record?.sleep ?? 0,
    }),
    [comment, setComment] = useState(record?.comment || '');
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ member_id: person, week, ...values, comment });
      }}
    >
      <div className="section-title">
        <h3>Tu revisión semanal</h3>
        <span className="badge">2 minutos</span>
      </div>
      <p className="muted">Piensa en cómo te has sentido esta semana.</p>
      {(
        [
          { key: 'hunger', label: 'Hambre', left: 'Muy poca', right: 'Mucha' },
          {
            key: 'energy',
            label: 'Energía',
            left: 'Muy baja',
            right: 'Muy alta',
          },
          {
            key: 'sleep',
            label: 'Descanso',
            left: 'Muy malo',
            right: 'Muy bueno',
          },
        ] as const
      ).map((f) => (
        <fieldset key={f.key}>
          <legend>{f.label}</legend>
          <div className="scale">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                aria-label={f.label + ': ' + n + ' de 5'}
                aria-pressed={values[f.key] === n}
                className={values[f.key] === n ? 'chosen' : ''}
                onClick={() => setValues({ ...values, [f.key]: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="scale-labels">
            <span>{f.left}</span>
            <span>{f.right}</span>
          </div>
        </fieldset>
      ))}
      <label>
        ¿Qué ha ido bien? ¿Qué te ha costado?
        <textarea
          maxLength={2000}
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Puedes contarlo con tus propias palabras."
        />
      </label>
      <button
        className="primary"
        disabled={
          busy ||
          Object.values(values).some((v) => !v) ||
          week > monday(today())
        }
      >
        <Save size={17} /> Guardar revisión
      </button>
    </form>
  );
}
