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

const lines = raw.trim().split('\n');
const parsed = lines.map(line => {
  const parts = line.split('\t').map(p => p.trim());
  const num = parseInt(parts[0]);
  const name = parts[1];
  const shifts = parts.slice(2);
  return { num, name, shifts };
});

console.log('Total rows:', parsed.length);
parsed.forEach(p => console.log(p.num, p.name, 'shift count:', p.shifts.length));

// Column 0=27, 1=28, 2=29, 3=30 (Sep 27-30)
// Column 4=1, ..., 34=31 (Oct 1-31)
console.log('\n--- SEPTEMBER (Tgl 27 - 30) ---');
for(let d=27; d<=30; d++){
  const idx = d - 27;
  const ps = [], m = [];
  parsed.forEach((p, pIdx) => {
    if(p.shifts[idx] === 'PS') ps.push(pIdx);
    if(p.shifts[idx] === 'M') m.push(pIdx);
  });
  console.log(`Sep ${d}: PS=[${ps.join(',')}] M=[${m.join(',')}]`);
}

console.log('\n--- OCTOBER (Tgl 1 - 31) ---');
const octDays = [];
for(let d=1; d<=31; d++){
  const idx = d + 3;
  const ps = [], m = [];
  parsed.forEach((p, pIdx) => {
    if(p.shifts[idx] === 'PS') ps.push(pIdx);
    if(p.shifts[idx] === 'M') m.push(pIdx);
  });
  octDays.push({ day: d, PS: ps, M: m });
  console.log(`Oct ${d}: PS=[${ps.join(',')}] M=[${m.join(',')}] (PS count: ${ps.length}, M count: ${m.length})`);
}

// Compute total shifts per person in Oct
const totPS = {}, totM = {};
for(let i=0; i<10; i++) { totPS[i] = 0; totM[i] = 0; }
octDays.forEach(od => {
  od.PS.forEach(id => totPS[id]++);
  od.M.forEach(id => totM[id]++);
});

console.log('\n--- OCTOBER TOTALS ---');
parsed.forEach((p, i) => {
  console.log(`${p.name} (id ${i}): PS=${totPS[i]}, M=${totM[i]}, Total=${totPS[i] + totM[i]}`);
});
