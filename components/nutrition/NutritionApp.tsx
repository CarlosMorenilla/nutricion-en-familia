'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Leaf,
  ArrowUpRight,
  LockKeyhole,
  CalendarDays,
  Utensils,
  Activity,
  LayoutDashboard,
  ChartNoAxesCombined,
  SlidersHorizontal,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Scale,
  Users,
  Clock,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  type DataSet,
  type Person,
  type Daily,
  type Measurement,
  type Review,
  type Plan,
  type Slot,
  NAMES,
  PEOPLE,
  SLOTS,
  SLOT_LABELS,
  DAYS,
  MEASURES,
  MEASURE_LABELS,
  today,
  monday,
  addDays,
  dayIndex,
  prettyDate,
  publishedPlan,
  adherence,
  weeklyWeights,
} from '../../lib/nutrition/model';
import { demoData } from '../../lib/nutrition/demo';
import {
  supabase,
  signIn,
  fetchData,
  saveRecord,
  removeMeasurement,
  savePlan,
} from '../../lib/nutrition/repository';
import { CheckIn, MeasurementForm, WeeklyReview } from './Forms';
import Admin from './Admin';
import { useScrollNavigation } from '../../hooks/use-scroll-navigation';

type Tab = 'today' | 'week' | 'progress' | 'admin';
const NAV = [
  { id: 'today', label: 'Hoy', icon: LayoutDashboard },
  { id: 'week', label: 'Mi semana', icon: CalendarDays },
  { id: 'progress', label: 'Mi evolución', icon: ChartNoAxesCombined },
  { id: 'admin', label: 'Administración', icon: SlidersHorizontal },
] as const;
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Leaf size={25} />
      </span>
      <span>
        nutrición<span className="brand-sub">EN FAMILIA</span>
      </span>
    </div>
  );
}
function Login({
  onDemo,
  notify,
}: {
  onDemo: () => void;
  notify: (s: string) => void;
}) {
  const demoEnabled =
    import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_DEMO === 'true' ||
    !supabase;
  return (
    <main className="login">
      <section className="login-story">
        <Brand />
        <div className="story-body">
          <span className="eyebrow">TU ESPACIO DE BIENESTAR</span>
          <h1>
            Un plan para ti.
            <br />
            Una mesa para todos.
          </h1>
          <p>
            Tu alimentación, tu movimiento y tu evolución.
            <br />
            Todo en un mismo lugar.
          </p>
          <div className="story-features">
            <span>
              <Utensils /> Alimentación a tu medida
            </span>
            <span>
              <Activity /> Movimiento con sentido
            </span>
            <span>
              <CalendarDays /> Seguimiento semana a semana
            </span>
          </div>
        </div>
        <span className="story-footer">
          NUTRICIÓN EN FAMILIA <span>Pequeños hábitos. Cada día.</span>
        </span>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">BIENVENIDO A TU ESPACIO</span>
          <h2>Cuidarse empieza aquí.</h2>
          <p>
            Accede a tu menú, consulta tu entrenamiento y sigue tu progreso a tu
            ritmo.
          </p>
          <button
            className="primary"
            disabled={!supabase}
            onClick={() => void signIn().catch((e) => notify(e.message))}
          >
            <span className="google-letter">G</span> Continuar con Google{' '}
            <ArrowUpRight size={19} />
          </button>
          <small className="login-note">
            {supabase
              ? 'Acceso exclusivo para las cuentas de tu familia.'
              : 'El acceso con Google está pendiente de configuración.'}
          </small>
          {demoEnabled && (
            <button className="demo-button" onClick={onDemo}>
              Explorar una demostración <ArrowRight size={17} />
            </button>
          )}
          <div className="privacy">
            <LockKeyhole size={19} />
            <p>
              Un espacio privado
              <br />
              <span>Solo tú y el administrador podéis ver tu seguimiento.</span>
            </p>
          </div>
        </div>
        <footer>Hecho para acompañaros, día a día.</footer>
      </section>
    </main>
  );
}
function MealCard({
  slot,
  title,
  portion,
  substitution,
  shared,
  instructions,
}: {
  slot: Slot;
  title: string;
  portion: string;
  substitution: string;
  shared: boolean;
  instructions: string;
}) {
  return (
    <article className={'meal-card ' + (shared ? 'shared-meal' : '')}>
      <div className="meal-heading">
        <span className="meal-number">
          {String(SLOTS.indexOf(slot) + 1).padStart(2, '0')}
        </span>
        <span className="eyebrow">{SLOT_LABELS[slot]}</span>
        {shared && (
          <span className="family-label">
            <Users size={13} /> En familia
          </span>
        )}
      </div>
      <h3>{title || SLOT_LABELS[slot]}</h3>
      <p className="portion">{portion}</p>
      {instructions && (
        <details>
          <summary>Preparación</summary>
          <p className="preserve">{instructions}</p>
        </details>
      )}
      {substitution && (
        <div className="substitution">
          <strong>Tu alternativa</strong>
          <p>{substitution}</p>
        </div>
      )}
    </article>
  );
}
export default function NutritionApp() {
  const [uid, setUid] = useState<string | null>(null),
    [demo, setDemo] = useState(false),
    [data, setData] = useState<DataSet | null>(null),
    [tab, setTab] = useState<Tab>('today'),
    [person, setPerson] = useState<Person>('carlitos'),
    [date, setDate] = useState(today()),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!supabase),
    [notice, setNotice] = useState(''),
    [loadError, setLoadError] = useState('');
  const notify = useCallback((s: string) => setNotice(s), []);
  const navigationHidden = useScrollNavigation(tab);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setLoadError(error.message);
      setUid(data.session?.user.id ?? null);
      setLoading(!!data.session);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (alive) {
          setUid(session?.user.id ?? null);
          if (!session) {
            setData(null);
            setLoading(false);
          }
        }
      },
    );
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);
  const reload = useCallback(async () => {
    const d = await fetchData();
    setData(d);
    return d;
  }, []);
  useEffect(() => {
    if (!uid || demo) return;
    let alive = true;
    void fetchData()
      .then((d) => {
        if (!alive) return;
        setData(d);
        const me = d.profiles.find((p) => p.user_id === uid);
        if (me) setPerson(me.id);
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [uid, demo]);
  const me = demo
    ? data?.profiles.find((p) => p.id === 'carlitos')
    : data?.profiles.find((p) => p.user_id === uid);
  const admin = me?.role === 'admin';
  const activePerson = admin ? person : (me?.id ?? 'carlitos');
  async function mutate(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setNotice(
        demo
          ? 'Guardado en la demostración. Se borrará al salir.'
          : 'Guardado correctamente.',
      );
    } catch (e) {
      setNotice('No se ha podido guardar: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function localUpsert<T extends { member_id: Person }>(
    items: T[],
    r: T,
    key: keyof T,
  ) {
    return [
      ...items.filter((x) => x.member_id !== r.member_id || x[key] !== r[key]),
      r,
    ];
  }
  async function saveDaily(r: Daily) {
    await mutate(async () => {
      if (demo)
        setData((d) => ({ ...d!, daily: localUpsert(d!.daily, r, 'date') }));
      else {
        await saveRecord('daily_records', r);
        await reload();
      }
    });
  }
  async function saveMeasure(r: Measurement) {
    await mutate(async () => {
      if (demo)
        setData((d) => ({
          ...d!,
          measurements: localUpsert(d!.measurements, r, 'date'),
        }));
      else {
        await saveRecord('measurements', r);
        await reload();
      }
    });
  }
  async function saveReview(r: Review) {
    await mutate(async () => {
      if (demo)
        setData((d) => ({
          ...d!,
          reviews: localUpsert(d!.reviews, r, 'week'),
        }));
      else {
        await saveRecord('weekly_reviews', r);
        await reload();
      }
    });
  }
  async function saveEdited(p: Plan, publish: boolean) {
    setBusy(true);
    try {
      if (demo) {
        setData((d) => {
          const existing = d!.plans.find((x) => x.id === p.id);
          if (existing && existing.revision !== p.revision)
            throw new Error('Recarga el borrador.');
          const version =
            existing?.version ??
            Math.max(
              0,
              ...d!.plans
                .filter((x) => x.week === p.week)
                .map((x) => x.version),
            ) + 1;
          return {
            ...d!,
            plans: [
              ...d!.plans.filter((x) => x.id !== p.id),
              {
                ...p,
                status: publish ? 'published' : 'draft',
                revision: p.revision + 1,
                version,
              },
            ],
          };
        });
      } else {
        await savePlan(p, publish);
        await reload();
      }
      notify(publish ? 'Semana publicada.' : 'Borrador guardado.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (demo) {
      setDemo(false);
      setData(null);
      setTab('today');
      setNotice('');
      return;
    }
    const result = await supabase?.auth.signOut();
    if (result?.error) {
      notify(result.error.message);
      return;
    }
    setData(null);
    setUid(null);
    setTab('today');
    setNotice('');
  }
  useEffect(() => {
    const ctx = (
      document as Document & {
        modelContext?: {
          registerTool: (t: unknown, o: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!ctx || !me) return;
    const controller = new AbortController();
    try {
      void Promise.resolve(
        ctx.registerTool(
          {
            name: 'view_nutrition_section',
            title: 'Abrir sección de nutrición',
            description:
              'Navega a una sección de la cuenta actual, sin modificar registros.',
            inputSchema: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  enum: admin
                    ? ['today', 'week', 'progress', 'admin']
                    : ['today', 'week', 'progress'],
                },
              },
              required: ['section'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute(input: unknown) {
              const section = (input as { section?: Tab })?.section;
              if (
                !section ||
                !NAV.some((n) => n.id === section) ||
                (section === 'admin' && !admin)
              )
                throw new Error('Sección no permitida.');
              setTab(section);
              return { section };
            },
          },
          { signal: controller.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => controller.abort();
  }, [me, admin]);
  const toast = notice && (
    <output className="toast">
      <span>{notice}</span>
      <button aria-label="Cerrar aviso" onClick={() => setNotice('')}>
        <X size={18} />
      </button>
    </output>
  );
  if (loading)
    return (
      <main className="connection-state">
        <Brand />
        <output>Preparando tu espacio…</output>
      </main>
    );
  if (!demo && !uid)
    return (
      <>
        <Login
          onDemo={() => {
            setData(demoData());
            setDemo(true);
            setPerson('carlitos');
            setTab('today');
          }}
          notify={notify}
        />
        {loadError && <p className="error">{loadError}</p>}
        {toast}
      </>
    );
  if (loadError || !me || !data)
    return (
      <main className="connection-state">
        <Brand />
        <h1>
          {loadError
            ? 'No hemos podido cargar tu espacio'
            : 'Esta cuenta todavía no tiene acceso'}
        </h1>
        <p>
          {loadError
            ? 'Comprueba tu conexión e inténtalo de nuevo.'
            : 'Pide a Carlitos que vincule este correo a tu perfil.'}
        </p>
        <div className="actions">
          {loadError && (
            <button
              className="primary"
              onClick={() => {
                setLoading(true);
                void reload()
                  .then(() => setLoadError(''))
                  .catch((e) => setLoadError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Reintentar
            </button>
          )}
          <button className="secondary" onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
        {toast}
      </main>
    );
  const week = monday(date),
    day = dayIndex(date),
    plan = publishedPlan(data.plans, date, activePerson),
    personal = plan?.members.find((m) => m.member_id === activePerson),
    dailyPlan = personal?.days[day],
    record = data.daily.find(
      (r) => r.member_id === activePerson && r.date === date,
    ),
    measurement = data.measurements.find(
      (r) => r.member_id === activePerson && r.date === date,
    ),
    review = data.reviews.find(
      (r) => r.member_id === activePerson && r.week === week,
    );
  const measurements = data.measurements
      .filter((r) => r.member_id === activePerson)
      .sort((a, b) => a.date.localeCompare(b.date)),
    weekly = weeklyWeights(measurements),
    weights = measurements.filter((r) => r.weight !== null),
    lastWeight = weights.at(-1),
    weekRecords = data.daily.filter(
      (r) => r.member_id === activePerson && monday(r.date) === week,
    ),
    dietScore = adherence(weekRecords, 'diet'),
    trainingScore = adherence(weekRecords, 'training');
  const title =
    tab === 'today'
      ? 'Tu día, con calma.'
      : tab === 'week'
        ? 'Una semana bien organizada.'
        : tab === 'progress'
          ? 'Cada semana cuenta.'
          : 'Cuidar de todos, a tu manera.';
  return (
    <div className="app-shell">
      <aside className={'sidebar' + (navigationHidden ? ' scroll-hidden' : '')}>
        <Brand />
        <div className="sidebar-label">MI ESPACIO</div>
        <nav aria-label="Navegación principal">
          {NAV.filter((n) => n.id !== 'admin' || admin).map((n) => (
            <button
              key={n.id}
              aria-current={tab === n.id ? 'page' : undefined}
              className={tab === n.id ? 'active' : ''}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              {tab === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <LockKeyhole size={17} />
            <span>Tu espacio es privado</span>
          </div>
          <button className="account" onClick={() => void logout()}>
            <span className="avatar">{me.name.slice(0, 1)}</span>
            <span>
              <strong>{me.name}</strong>
              <small>{admin ? 'Administrador' : 'Miembro de la familia'}</small>
            </span>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="breadcrumb">
            Mi espacio <span>/</span> {NAV.find((n) => n.id === tab)?.label}
          </span>
          <div className="topbar-right">
            <span className="private-pill">
              <span /> Espacio familiar
            </span>
            <button
              className="mobile-logout"
              onClick={() => void logout()}
              aria-label="Cerrar sesión"
            >
              <LogOut size={20} />
            </button>
            <span className="avatar">{me.name.slice(0, 1)}</span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            Demostración · Datos ficticios · Los cambios no se guardan al salir{' '}
            <button onClick={() => void logout()}>Salir</button>
          </div>
        )}
        <main className="workspace">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === 'admin'
                  ? 'PANEL DE CARLITOS'
                  : 'HOLA, ' + NAMES[activePerson].toUpperCase()}
              </span>
              <h1>{title}</h1>
              <p>
                {tab === 'today'
                  ? 'Tu alimentación y tu movimiento, paso a paso.'
                  : tab === 'week'
                    ? 'Consulta tus comidas y encuentra tu ritmo.'
                    : tab === 'progress'
                      ? 'Observa tu evolución sin perder de vista cómo te sientes.'
                      : 'Planes personales, comidas compartidas y seguimiento.'}
              </p>
            </div>
            {admin && tab !== 'admin' && (
              <label className="profile-switch">
                <Users size={17} />
                <select
                  aria-label="Ver perfil"
                  value={person}
                  onChange={(e) => setPerson(e.target.value as Person)}
                >
                  {PEOPLE.map((id) => (
                    <option key={id} value={id}>
                      {NAMES[id]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {tab !== 'admin' && (
            <div className="date-toolbar">
              <div className="date-navigation">
                <button
                  className="icon-button"
                  aria-label={
                    tab === 'today' ? 'Día anterior' : 'Semana anterior'
                  }
                  onClick={() =>
                    setDate(addDays(date, tab === 'today' ? -1 : -7))
                  }
                >
                  <ChevronLeft size={19} />
                </button>
                <strong>
                  {tab === 'today'
                    ? DAYS[day] + ', ' + prettyDate(date)
                    : prettyDate(week, true) +
                      ' — ' +
                      prettyDate(addDays(week, 6), true)}
                </strong>
                <button
                  className="icon-button"
                  aria-label={
                    tab === 'today' ? 'Día siguiente' : 'Semana siguiente'
                  }
                  onClick={() =>
                    setDate(addDays(date, tab === 'today' ? 1 : 7))
                  }
                >
                  <ChevronRight size={19} />
                </button>
              </div>
              <div className="date-controls">
                <button
                  className="text-button"
                  onClick={() => setDate(today())}
                >
                  Hoy
                </button>
                <input
                  aria-label="Elegir fecha"
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
              </div>
            </div>
          )}
          {(tab === 'today' || tab === 'week') && (
            <>
              {tab === 'week' && (
                <div className="week-strip">
                  {DAYS.map((d, i) => {
                    const dt = addDays(week, i);
                    return (
                      <button
                        className={day === i ? 'active' : ''}
                        key={d}
                        onClick={() => setDate(dt)}
                      >
                        <span>{d.slice(0, 3)}</span>
                        <strong>
                          {new Date(dt + 'T12:00:00Z').getUTCDate()}
                        </strong>
                        <span
                          className={
                            'week-dot ' +
                            (data.daily.some(
                              (r) =>
                                r.member_id === activePerson &&
                                r.date === dt &&
                                (r.diet || r.training),
                            )
                              ? 'filled'
                              : '')
                          }
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="dashboard-columns">
                <div className="main-column">
                  <div className="section-title">
                    <h2>
                      <Utensils size={22} /> Tu alimentación
                    </h2>
                    <span className="muted">
                      {dailyPlan ? '4 momentos para ti' : 'Plan pendiente'}
                    </span>
                  </div>
                  {dailyPlan ? (
                    <div className="meals-grid">
                      {SLOTS.map((slot) => {
                        const base = plan!.shared.find(
                          (s) => s.day === day && s.slot === slot,
                        );
                        return (
                          <MealCard
                            key={slot}
                            slot={slot}
                            title={base?.title || dailyPlan.meals[slot].title}
                            portion={dailyPlan.meals[slot].portion}
                            substitution={dailyPlan.meals[slot].substitution}
                            shared={!!base}
                            instructions={base?.instructions || ''}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="card empty">
                      <Utensils size={32} />
                      <h3>Tu plan aún no está publicado</h3>
                      <p>
                        {activePerson === 'papa'
                          ? 'Carlitos preparará tus cantidades y tu rutina.'
                          : 'Cuando Carlitos revise y publique esta semana, aparecerá aquí.'}
                      </p>
                      {admin && (
                        <button
                          className="secondary"
                          onClick={() => setTab('admin')}
                        >
                          Ir a administración <ArrowRight size={17} />
                        </button>
                      )}
                    </div>
                  )}
                  {dailyPlan && (
                    <section className="card workout">
                      <div className="section-title">
                        <h2>
                          <Activity size={22} /> Tu movimiento
                        </h2>
                        <span className="badge subtle">Plan del día</span>
                      </div>
                      <h3>{dailyPlan.workout.title}</h3>
                      <p className="preserve">{dailyPlan.workout.details}</p>
                      {dailyPlan.workout.intensity && (
                        <div className="workout-meta">
                          <Activity size={17} />
                          <span>{dailyPlan.workout.intensity}</span>
                        </div>
                      )}
                      {dailyPlan.workout.rest && (
                        <div className="workout-meta">
                          <Clock size={17} />
                          <span>{dailyPlan.workout.rest}</span>
                        </div>
                      )}
                      {dailyPlan.workout.exercises && (
                        <details>
                          <summary>
                            Ver ejercicios e indicaciones{' '}
                            <ChevronRight size={17} />
                          </summary>
                          <div className="exercise-list">
                            {dailyPlan.workout.exercises
                              .split('\n')
                              .filter(Boolean)
                              .map((x, i) => (
                                <div key={i}>
                                  <span>{String(i + 1).padStart(2, '0')}</span>
                                  <p>{x}</p>
                                </div>
                              ))}
                          </div>
                        </details>
                      )}
                    </section>
                  )}
                  {dailyPlan?.notes && (
                    <details className="card">
                      <summary>
                        Notas del día <ChevronRight size={17} />
                      </summary>
                      <p className="preserve">{dailyPlan.notes}</p>
                    </details>
                  )}
                  {personal?.notes && (
                    <details className="card">
                      <summary>
                        Notas de tu plan <ChevronRight size={17} />
                      </summary>
                      <p className="preserve">{personal.notes}</p>
                    </details>
                  )}
                </div>
                <aside className="side-column">
                  <section className="week-summary">
                    <span className="eyebrow">TU SEMANA HASTA AHORA</span>
                    <h3>La constancia suma.</h3>
                    <div className="summary-number">
                      <strong>{dietScore.done}</strong>
                      <span>
                        días siguiendo
                        <br />
                        tu alimentación
                      </span>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{ width: (dietScore.done / 7) * 100 + '%' }}
                      />
                    </div>
                    <p>
                      {dietScore.count} de 7 días con registro ·{' '}
                      {7 - dietScore.count} sin datos
                    </p>
                    <button onClick={() => setTab('progress')}>
                      Ver mi evolución <ArrowUpRight size={17} />
                    </button>
                  </section>
                  <CheckIn
                    key={activePerson + date + JSON.stringify(record)}
                    person={activePerson}
                    date={date}
                    record={record}
                    onSave={(r) => void saveDaily(r)}
                    busy={busy}
                  />
                  <div className="gentle-note">
                    <Leaf size={21} />
                    <p>
                      No necesitas un día perfecto.
                      <br />
                      <strong>Encuentra lo que funciona para ti.</strong>
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {tab === 'progress' && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span>Último peso registrado</span>
                  <strong>
                    {lastWeight
                      ? lastWeight.weight!.toLocaleString('es-ES')
                      : '—'}{' '}
                    <small>kg</small>
                  </strong>
                  <p>
                    {lastWeight
                      ? prettyDate(lastWeight.date)
                      : 'Registra tu primera medida'}
                  </p>
                </div>
                <div className="stat-card">
                  <span>Alimentación esta semana</span>
                  <strong>
                    {dietScore.percent === null
                      ? '—'
                      : dietScore.percent + ' %'}
                  </strong>
                  <p>
                    {dietScore.done} completos · {dietScore.partial} parciales ·{' '}
                    {dietScore.count} días registrados
                  </p>
                </div>
                <div className="stat-card">
                  <span>Entrenamiento esta semana</span>
                  <strong>
                    {trainingScore.percent === null
                      ? '—'
                      : trainingScore.percent + ' %'}
                  </strong>
                  <p>
                    {trainingScore.done} completos · {trainingScore.partial}{' '}
                    parciales · {trainingScore.count} días registrados
                  </p>
                </div>
              </div>
              <section className="card chart-card">
                <div className="section-title">
                  <div>
                    <span className="eyebrow">PESO CORPORAL</span>
                    <h2>Tu evolución, con perspectiva</h2>
                  </div>
                  <span className="badge subtle">
                    {weights.length} registros
                  </span>
                </div>
                <p className="muted">
                  Todos tus registros y sus medias semanales. Un dato aislado no
                  cuenta toda la historia.
                </p>
                {weights.length ? (
                  <>
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart
                          data={weights.map((w) => ({
                            ...w,
                            label: prettyDate(w.date, true),
                          }))}
                          margin={{ left: 0, right: 20, top: 20, bottom: 10 }}
                        >
                          <CartesianGrid vertical={false} stroke="#e5ece7" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: '#61716b' }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={30}
                          />
                          <YAxis
                            domain={['auto', 'auto']}
                            tick={{ fontSize: 12, fill: '#61716b' }}
                            axisLine={false}
                            tickLine={false}
                            width={48}
                          />
                          <Tooltip formatter={(v) => [v + ' kg', 'Peso']} />
                          <Line
                            type="linear"
                            dataKey="weight"
                            stroke="#246170"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#fff', strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="weekly-averages">
                      {weekly.slice(-6).map((w) => (
                        <div key={w.week}>
                          <span>Semana {prettyDate(w.week, true)}</span>
                          <strong>
                            {w.average.toLocaleString('es-ES')} kg
                          </strong>
                          <small>{w.count} observaciones</small>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty">
                    <Scale size={32} />
                    <h3>Tu historia empieza con un registro</h3>
                    <p>Cuando añadas un peso, aparecerá aquí.</p>
                  </div>
                )}
              </section>
              <div className="two-columns">
                <MeasurementForm
                  key={
                    'measure-' +
                    activePerson +
                    date +
                    JSON.stringify(measurement)
                  }
                  person={activePerson}
                  date={date}
                  record={measurement}
                  onSave={(r) => void saveMeasure(r)}
                  onDelete={() => {
                    if (window.confirm('¿Eliminar las medidas de este día?'))
                      void mutate(async () => {
                        if (demo)
                          setData((d) => ({
                            ...d!,
                            measurements: d!.measurements.filter(
                              (r) =>
                                r.member_id !== activePerson || r.date !== date,
                            ),
                          }));
                        else {
                          await removeMeasurement(activePerson, date);
                          await reload();
                        }
                      });
                  }}
                  busy={busy}
                />
                <WeeklyReview
                  key={'review-' + activePerson + week + JSON.stringify(review)}
                  person={activePerson}
                  week={week}
                  record={review}
                  onSave={(r) => void saveReview(r)}
                  busy={busy}
                />
              </div>
              <section className="card">
                <h3>Historial de medidas</h3>
                <p className="hint">
                  Selecciona una fecha para corregir sus valores.
                </p>
                <div className="history">
                  {[...measurements].reverse().map((m) => (
                    <button key={m.date} onClick={() => setDate(m.date)}>
                      <strong>{prettyDate(m.date, true)}</strong>
                      <span>
                        {MEASURES.filter((k) => m[k] !== null)
                          .map(
                            (k) =>
                              MEASURE_LABELS[k] +
                              ': ' +
                              m[k]!.toLocaleString('es-ES') +
                              (k === 'weight' ? ' kg' : ' cm'),
                          )
                          .join(' · ')}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {!measurements.length && (
                    <p className="muted">Aún no hay medidas registradas.</p>
                  )}
                </div>
              </section>
            </>
          )}
          {tab === 'progress' && (
            <section className="card sleep-history">
              <h3>Tu descanso diario</h3>
              <p className="hint">
                Horas y calidad de la noche anterior. Pulsa un día para
                corregirlo.
              </p>
              <div className="history">
                {data.daily
                  .filter(
                    (r) =>
                      r.member_id === activePerson &&
                      (r.sleep_hours != null || r.sleep_quality != null),
                  )
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => (
                    <button
                      key={r.date}
                      onClick={() => {
                        setDate(r.date);
                        setTab('today');
                        window.scrollTo({ top: 0 });
                      }}
                    >
                      <strong>{prettyDate(r.date, true)}</strong>
                      <span>
                        {r.sleep_hours == null
                          ? 'Horas sin registrar'
                          : r.sleep_hours.toLocaleString('es-ES') + ' h'}{' '}
                        ·{' '}
                        {r.sleep_quality == null
                          ? 'Calidad sin registrar'
                          : 'Calidad ' + r.sleep_quality + '/5'}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                {!data.daily.some(
                  (r) =>
                    r.member_id === activePerson &&
                    (r.sleep_hours != null || r.sleep_quality != null),
                ) && (
                  <p className="muted">
                    Puedes empezar hoy, aunque tu dieta siga en borrador.
                  </p>
                )}
              </div>
            </section>
          )}
          {admin && (
            <div hidden={tab !== 'admin'}>
              <Admin
                data={data}
                busy={busy}
                onSave={saveEdited}
                notify={notify}
              />
            </div>
          )}
          <footer className="workspace-footer">
            <span>Nutrición en Familia</span>
            <span>Un espacio para cuidar de vosotros.</span>
          </footer>
        </main>
      </div>
      {toast}
    </div>
  );
}
