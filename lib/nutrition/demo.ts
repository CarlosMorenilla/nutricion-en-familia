import {
  type DataSet,
  PEOPLE,
  NAMES,
  blankPlan,
  blankDay,
  monday,
  today,
  addDays,
} from './model';
export function demoData(): DataSet {
  const week = monday(today());
  const plan = blankPlan(week);
  plan.status = 'published';
  plan.reviewed = true;
  plan.shared = plan.shared.map((s) => ({
    ...s,
    title:
      s.slot === 'comida'
        ? 'Arroz con pollo y verduras'
        : 'Pescado al horno con patata',
    instructions: 'Cocina para todos y sirve la ración de cada persona.',
  }));
  plan.members = PEOPLE.map((member_id, i) => ({
    member_id,
    notes:
      'Plan ficticio para probar la aplicación. No es una pauta nutricional.',
    source: 'Demostración',
    days: Array.from({ length: 7 }, (_, d) => {
      const day = blankDay();
      day.meals.desayuno = {
        title: 'Tostada con huevo y fruta',
        portion: 'Pan integral 60 g + 1 huevo + 1 fruta',
        substitution: '',
      };
      day.meals.comida = {
        title: '',
        portion:
          'Arroz ' +
          (80 - i * 10) +
          ' g (en crudo) + pollo 120 g + verduras 200 g',
        substitution: '',
      };
      day.meals.merienda = {
        title: 'Yogur y fruta',
        portion: 'Yogur natural 125 g + 1 fruta',
        substitution: '',
      };
      day.meals.cena = {
        title: '',
        portion: 'Pescado 120 g + patata 180 g (cocinada) + verduras 150 g',
        substitution: '',
      };
      day.workout = {
        title: d === 6 ? 'Descanso' : 'Fuerza y paseo',
        details: 'Paseo cómodo durante 30 minutos.',
        intensity: 'Ritmo que permita conversar',
        rest: '60–90 segundos entre series',
        exercises:
          'Sentadilla a una silla · 2 × 10\nRemo en máquina · 2 × 12\nPress de pecho en máquina · 2 × 12',
      };
      return day;
    }),
  }));
  const data: DataSet = {
    profiles: PEOPLE.map((id) => ({
      id,
      name: NAMES[id],
      role: id === 'carlitos' ? 'admin' : 'member',
      user_id: null,
    })),
    plans: [plan],
    daily: [],
    measurements: [],
    reviews: [],
  };
  for (const person of PEOPLE) {
    for (let i = 28; i >= 0; i -= 3) {
      data.measurements.push({
        member_id: person,
        date: addDays(today(), -i),
        weight:
          Math.round(
            (person === 'carlitos' ? 76 : person === 'mama' ? 68 : 86) * 100 +
              i * 2,
          ) / 100,
        waist: null,
        hip: null,
        chest: null,
        arm: null,
        thigh: null,
      });
    }
    for (let i = 0; i < 5; i++)
      data.daily.push({
        member_id: person,
        date: addDays(today(), -i),
        diet: i === 2 ? 'partial' : 'done',
        training: i === 3 ? null : 'done',
        comment: '',
        sleep_hours: i === 3 ? null : 7 + (i % 3) / 2,
        sleep_quality: i === 3 ? null : 4,
      });
  }
  return data;
}
