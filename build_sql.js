const fs = require('fs');

const raw = `1	Hendra Setiaji	-	-	-	PS	M	-	-	-	PS	M	-	M	M	-	-	-	PS	M	-	-	-	M	-	-	PS	M	-	-	-	-	-	-	PS	M	-
2	Asmadi Djasman	PS	-	PS	-	PS	M	-	-	-	PS	M	-	-	-	M	-	-	-	-	PS	M	-	-	-	PS	M	-	-	PS	M	-	-	-	PS	M
3	Akbar Yus Prasetio	-	-	-	M	-	-	PS	-	-	M	-	-	-	PS	-	-	PS	M	-	-	PS	-	-	PS	M	-	-	M	-	M	-	-	PS	M	-
4	Amzah	-	-	M	-	-	-	-	PS	M	-	-	PS	-	PS	M	-	-	PS	M	-	-	-	-	PS	M	-	PS	-	-	-	PS	M	-	-	-
5	Aziz Setia Aji	M	M	-	PS	-	PS	M	-	-	PS	M	-	-	-	-	-	M	-	PS	-	-	PS	M	M	-	-	-	PS	PS	-	-	PS	M	-	-
6	Hanapi	M	-	-	-	M	-	-	M	-	-	PS	-	-	-	PS	M	-	-	-	PS	M	-	-	-	-	PS	M	-	-	PS	M	-	-	-	PS
7	M Hajar Zakariya	-	PS	PS	M	-	-	PS	M	-	-	-	PS	M	-	-	PS	M	-	-	M	-	-	PS	-	-	-	M	-	-	PS	M	-	-	-	PS
8	Grandhista Septya I. P	-	-	-	-	-	PS	M	-	-	-	PS	M	-	-	PS	M	-	-	PS	M	-	-	PS	M	-	PS	-	-	-	-	PS	M	-	-	-
9	Reza Pitriyanto	PS	M	-	-	PS	M	-	-	PS	-	-	-	PS	M	-	PS	-	-	-	-	PS	M	-	-	-	-	PS	M	M	-	-	PS	M	-	-
10	Reza Bayu Perdana	-	PS	M	-	-	-	-	PS	M	-	-	-	PS	M	-	-	-	PS	M	-	-	PS	M	-	-	-	-	PS	M	-	-	-	-	PS	M`;

const personnelNames = [
  'Hendra Setiaji', 'Asmadi Djasman', 'Akbar Yus Prasetio', 'Amzah', 'Aziz Setia Aji',
  'Hanapi', 'M Hajar Zakariya', 'Grandhista Septya I. P', 'Reza Pitriyanto', 'Reza Bayu Perdana'
];

const lines = raw.trim().split('\n');
const parsed = lines.map(line => {
  const parts = line.split('\t').map(p => p.trim());
  const num = parseInt(parts[0]);
  const name = parts[1];
  const shifts = parts.slice(2);
  return { num, name, shifts };
});

// Sep 29 and 30 M shifts for day 1 L1 and L2 calculation:
// Sep 29 (col 2): Amzah (3), Reza Bayu (9) => M=[3,9]
// Sep 30 (col 3): Akbar (2), M Hajar (6) => M=[2,6]
const sep29M = [3, 9];
const sep30M = [2, 6];

const calendar = [];
const month_ps = {}, month_m = {};
for(let i=0; i<10; i++){ month_ps[i] = 0; month_m[i] = 0; }

for(let d=1; d<=31; d++){
  const col = d + 3;
  const ps = [], m = [];
  parsed.forEach((p, pIdx) => {
    if(p.shifts[col] === 'PS') ps.push(pIdx);
    if(p.shifts[col] === 'M') m.push(pIdx);
  });

  ps.forEach(id => month_ps[id]++);
  m.forEach(id => month_m[id]++);

  let l1 = [], l2 = [];
  if(d === 1){
    l1 = sep30M.slice();
    l2 = sep29M.slice();
  } else if(d === 2){
    l1 = calendar[0].M.slice();
    l2 = sep30M.slice();
  } else {
    l1 = calendar[d-2].M.slice();
    l2 = calendar[d-3].M.slice();
  }

  const cells = {};
  for(let i=0; i<10; i++){
    if(ps.includes(i)){
      cells[i] = { cls: 'slot-PS', label: 'PS', title: 'Pagi Siang' };
    } else if(m.includes(i)){
      cells[i] = { cls: 'slot-M', label: 'M', title: 'Malam' };
    } else if(l1.includes(i)){
      cells[i] = { cls: 'slot-off', label: '–', title: 'Libur-1 (baru pulang malam)' };
    } else if(l2.includes(i)){
      cells[i] = { cls: 'slot-off', label: '–', title: 'Libur-2 (libur penuh)' };
    } else {
      cells[i] = { cls: 'slot-off', label: '–', title: 'Menunggu giliran di antrian' };
    }
  }

  calendar.push({
    day: d,
    PS: ps,
    M: m,
    L1: l1,
    L2: l2,
    lockedPS: [],
    lockedM: [],
    swappedPS: [],
    swappedM: [],
    cutiReplacements: [],
    cells: cells
  });
}

// End state
const lastDay = calendar[30];
const secondLastDay = calendar[29];
const end_cur = {
  PS: lastDay.PS.slice(),
  M: lastDay.M.slice(),
  L1: lastDay.L1.slice(),
  L2: lastDay.L2.slice()
};
const end_queue = [3, 4, 7, 8]; // personnel not on duty/rest on last day

const logs = [
  { type: 'ok', text: 'Jadwal operasional resmi Oktober 2026 diterapkan sesuai jadwal dinas riil BMKG DDK.' }
];

const schedRow = {
  year: 2026,
  month: 10,
  days: 31,
  calendar: calendar,
  month_ps: month_ps,
  month_m: month_m,
  logs: logs,
  end_queue: end_queue,
  end_cur: end_cur,
  generated_at: new Date().toISOString()
};

// Generate SQL statement
const calendarJson = JSON.stringify(calendar).replace(/'/g, "''");
const monthPsJson = JSON.stringify(month_ps).replace(/'/g, "''");
const monthMJson = JSON.stringify(month_m).replace(/'/g, "''");
const logsJson = JSON.stringify(logs).replace(/'/g, "''");
const endQueueJson = JSON.stringify(end_queue).replace(/'/g, "''");
const endCurJson = JSON.stringify(end_cur).replace(/'/g, "''");

const sqlUpdate = `-- =====================================================================
-- SQL QUERY UPDATE JADWAL OPERASIONAL OKTOBER 2026
-- DIREKTORAT DATA DAN KOMPUTASI (BMKG DDK)
-- =====================================================================

INSERT INTO public.schedules (
  year,
  month,
  days,
  calendar,
  month_ps,
  month_m,
  logs,
  end_queue,
  end_cur,
  generated_at
) VALUES (
  2026,
  10,
  31,
  '${calendarJson}'::jsonb,
  '${monthPsJson}'::jsonb,
  '${monthMJson}'::jsonb,
  '${logsJson}'::jsonb,
  '${endQueueJson}'::jsonb,
  '${endCurJson}'::jsonb,
  NOW()
)
ON CONFLICT (year, month) DO UPDATE SET
  days = EXCLUDED.days,
  calendar = EXCLUDED.calendar,
  month_ps = EXCLUDED.month_ps,
  month_m = EXCLUDED.month_m,
  logs = EXCLUDED.logs,
  end_queue = EXCLUDED.end_queue,
  end_cur = EXCLUDED.end_cur,
  generated_at = NOW();
`;

fs.writeFileSync('update_jadwal_oktober_2026.sql', sqlUpdate, 'utf8');
console.log('SQL file written successfully: update_jadwal_oktober_2026.sql (size: ' + sqlUpdate.length + ' bytes)');

// Also write JSON for direct REST update
fs.writeFileSync('oct_sched.json', JSON.stringify(schedRow), 'utf8');
console.log('JSON file written: oct_sched.json');
