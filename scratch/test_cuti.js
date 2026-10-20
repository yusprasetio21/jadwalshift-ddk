// Unit test verification for Cuti bug fixes
const fs = require('fs');

// Mock browser environment
global.window = {
  addEventListener: () => {},
  scrollTo: () => {}
};
global.document = {
  getElementById: () => ({
    textContent: '',
    innerHTML: '',
    style: {},
    classList: { add: ()=>{}, remove: ()=>{} },
    setAttribute: ()=>{},
    addEventListener: ()=>{},
    querySelectorAll: () => [],
    querySelector: () => null,
    cloneNode: function() { return this; },
    replaceWith: () => {}
  }),
  body: { classList: { toggle: ()=>{}, add: ()=>{}, remove: ()=>{} }, style: {} },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};
global.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
global.confirm = () => true;

// Load code from logika.js
const code = fs.readFileSync('c:\\Users\\ayp\\Documents\\jadwalshift-ddk\\logika.js', 'utf8');

const testCode = `
// Test 1: Personnel 8 on day 26 (initially Libur - / L1)
console.log('--- Test 1: Setting Cuti on Date 26 for Personnel 8 (initially Libur) ---');
viewY = 2026;
viewM = 10;
const sk = skey(2026, 10);
const sched = {
  days: 31,
  calendar: Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    PS: [5, 6],
    M: [1, 2],
    L1: [8, 9],
    L2: [2, 8],
    lockedPS: [],
    lockedM: [],
    cutiReplacements: []
  })),
  monthPS: {},
  monthM: {},
  logs: []
};
schedules[sk] = sched;
currentRole = 'admin';

// Verify cell BEFORE edit
const beforeCell = computeCell(26, 8, sched.calendar[25], 10, 2026);
console.log('Before edit (day 26, pid 8):', beforeCell);

// Open manual edit modal for day 26, pid 8
openManualEditModal(26, 8);
manualEditState.selectedMode = 'CUTI';
manualEditState.cutiReason = 'Cuti tahunan';

saveManualEdit().then(() => {
  const afterCell = computeCell(26, 8, sched.calendar[25], 10, 2026);
  console.log('After edit (day 26, pid 8):', afterCell);
  if(afterCell.cls === 'slot-cuti' && afterCell.label === 'C'){
    console.log('✅ TEST 1 PASSED: Cell is slot-cuti (Red) with label C!');
  } else {
    console.error('❌ TEST 1 FAILED: Expected slot-cuti, got:', afterCell);
    process.exit(1);
  }

  // Test 2: Date 26 when an existing pending cuti already exists
  console.log('\\n--- Test 2: Existing pending cuti on Date 26 for Personnel 4 ---');
  cutiList.push({
    id: 999,
    personnelId: 4,
    start: 26,
    end: 26,
    reason: 'Pengajuan cuti',
    status: 'pending',
    month: 10,
    year: 2026
  });

  const pendingBefore = computeCell(26, 4, sched.calendar[25], 10, 2026);
  console.log('Pending cell before admin edit:', pendingBefore);

  openManualEditModal(26, 4);
  console.log('Modal initial mode for pending cuti:', manualEditState.selectedMode);
  manualEditState.selectedMode = 'CUTI';
  saveManualEdit().then(() => {
    const pendingAfter = computeCell(26, 4, sched.calendar[25], 10, 2026);
    console.log('Cell after admin save:', pendingAfter);
    if(pendingAfter.cls === 'slot-cuti' && pendingAfter.label === 'C'){
      console.log('✅ TEST 2 PASSED: Pending cuti properly approved and turned red!');
    } else {
      console.error('❌ TEST 2 FAILED: Expected slot-cuti, got:', pendingAfter);
      process.exit(1);
    }

    // Test 3: Date 24 on duty (PS) changed to Cuti
    console.log('\\n--- Test 3: Personnel 9 on Date 24 (initially PS) ---');
    sched.calendar[23].PS = [4, 9];
    openManualEditModal(24, 9);
    manualEditState.selectedMode = 'CUTI';
    saveManualEdit().then(() => {
      const dutyAfter = computeCell(24, 9, sched.calendar[23], 10, 2026);
      console.log('Cell after admin save (initially PS):', dutyAfter);
      if(dutyAfter.cls === 'slot-cuti' && dutyAfter.label === 'C'){
        console.log('✅ TEST 3 PASSED: Duty shift properly changed to cuti and turned red!');
      } else {
        console.error('❌ TEST 3 FAILED: Expected slot-cuti, got:', dutyAfter);
        process.exit(1);
      }
      console.log('\\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
    });
  });
});
`;

const vm = require('vm');
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  window: global.window,
  document: global.document,
  sessionStorage: global.sessionStorage,
  confirm: global.confirm,
  alert: console.log,
  navigator: { onLine: true },
  location: { reload: ()=>{} },
  process,
  Math,
  Date,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  Promise
});

vm.runInContext(code + '\n' + testCode, context);
