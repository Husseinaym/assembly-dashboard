'use strict';
// Default master data. Everything here is editable in Settings and stored in the database.

const FACILITIES = [
  { name: 'EB Turbo', color: '#2563eb', confirmed: true, production: true },
  { name: 'Yaris 708D', color: '#dc2626', confirmed: true, production: true },
  { name: 'Yaris Cross 709D', color: '#ea580c', confirmed: true, production: true },
  { name: 'CHR Floors', color: '#16a34a', confirmed: true, production: true },
  { name: 'CHR Smalls', color: '#0d9488', confirmed: true, production: true },
  { name: 'Aygo', color: '#9333ea', confirmed: true, production: true },
  { name: 'F1H', color: '#ca8a04', confirmed: true, production: true },
];

// Ordered mapping rules. exact beats prefix/contains; the longest prefix wins.
const FACILITY_RULES = [
  // Defects "Assembly line" and Compliance "Facility" / "Assembly line" codes
  ['346D', 'prefix', 'Yaris 708D'],
  ['369D', 'prefix', 'Yaris Cross 709D'],
  ['130D Small', 'prefix', 'CHR Smalls'],
  ['130D', 'prefix', 'CHR Floors'],
  ['537D', 'prefix', 'Aygo'],
  ['Aygo', 'prefix', 'Aygo'],
  ['PSA - EB TURBO', 'prefix', 'EB Turbo'],
  ['F1H', 'prefix', 'F1H'],
  ['412B', 'prefix', 'Yaris Cross 709D'], // confirmed: 412B is the same as 709D
  ['PSA - Front door', 'prefix', 'F1H'], // confirmed: PSA doors, tailgate and bumper are F1H
  ['PSA - Rear door', 'prefix', 'F1H'],
  ['PSA - Tailgate', 'prefix', 'F1H'],
  ['PSA - Bumper', 'prefix', 'F1H'],
  // Safety "Area" names
  ['Yaris 708D', 'exact', 'Yaris 708D'],
  ['Yaris SUV 709D', 'exact', 'Yaris Cross 709D'],
  ['Yaris Cross 709D', 'exact', 'Yaris Cross 709D'],
  ['CHR Floor', 'exact', 'CHR Floors'],
  ['CHR Floors', 'exact', 'CHR Floors'],
  ['CHR Smalls', 'prefix', 'CHR Smalls'],
  ['EB Turbo', 'prefix', 'EB Turbo'],
].map(([pattern, match, facility], i) => ({ pattern, match, facility, sort: i }));

const CRITICAL_LIST = [
  { type: 'Terminal backout', match: 'exact', values: ['Terminal backout', 'Backout terminal'] },
  { type: 'Missing', match: 'contains', values: ['missing'] },
  { type: 'Bent terminal', match: 'exact', values: ['Bent terminal'] },
  { type: 'Wrong connector', match: 'exact', values: ['Wrong connector'] },
  { type: 'Winged ABO not closed', match: 'exact', values: ['Winged ABO not closed'] },
];

// Safety non-compliance items: Arabic text -> English short name
const SAFETY_ITEMS = [
  ['الممرات خالية من اي اغراض قد تعيق الحركة او تتسبب في حوادث السقوط والعرقلة', 'Aisles not clear (trip hazard)'],
  ['فحص ازرار الطوارئ / أقفال الحماية / غطاء الحماية للمعدات والتأكد من سلامتها', 'Emergency stop / guard / interlock fault'],
  ['غير مسموح الوقوف، المرور، او العمل داخل مناطق الخطر (محددة بالأصفر والأسود) داخل خطوط الإنتاج (Assembly).', 'In danger zone on line (Assembly)'],
  ['عدم وجود حواف حادة في جميع الأغراض في منطقة العمل', 'Sharp edges in work area'],
  ['جميع العمال يرتدون الزي المخصص لهم ومهمات الوقاية اللازمة اثناء العمل', 'Uniform / PPE not worn'],
  ['عدم تخزين مواد / أغراض امام معدات مكافحة الحرائق، ابواب الطوارئ و لوحات الكهرباء', 'Fire equipment / exit / panel blocked'],
  ['منطقة الخطر في خطوط الإنتاج (الكارسول) محددة، مزودة بستائر، وخالية من العمال', 'Carousel danger zone not secured'],
  ['الأرضيات في حالة جيدة، ولا يوجد بها فجوات قد تسبب العرقلة', 'Damaged floor (trip hazard)'],
  ['عدم التحدث في الهاتف في غير الأماكن المخصصة او أثناء السير', 'Phone use while walking'],
  ['الإلتزام بالحد الأقصى للتخزين على الأرفف، ووجود علامات تحديد لمعرفة الحد الأقصى', 'Shelf storage limit exceeded'],
  ['جميع العمال يرتدون الزي المخصص لهم ومهمات الوقاية اللازمة اثناء العمل (حذاء الأمان) (Lead Prep)', 'Safety shoes not worn (Lead Prep)'],
  ['فحص معدات رفع الأحمال (هاند ليفت) والتأكد من أنها تطابق مواصفات السلامة المطلوبة (الفرامل / مانع التزحلق / صدادات حماية)', 'Hand lift not to safety spec'],
  ['عدم إستخدام السلالم بدون غلق الفرامل على العجلات', 'Ladder used with wheels unlocked'],
  ['عدم وضع اي سوائل كميائية في زجاجات بدون تعريف', 'Unlabelled chemical bottle'],
  ['الوقوف في الأماكن المخصصة أثناء صيانة الماكينات (Lead Prep)', 'Wrong position during machine maintenance'],
  ['عدم إستخدام معدات القطع (مقص / كاتر) بدون رخصة + يجب ان تتطابق مع مواصفات السلامة', 'Cutting tool without licence / unsafe'],
  ['عدم إستخدام السلالم بدون غلق الفرامل على العجلات وإرتداء خوذة الحماية', 'Ladder unlocked / no helmet'],
  ['الإلتزام بإرشادات الدخول والخروج للأبواب / الصعود والنزول للسلالم طبقاً لأسهم الإتجاهات الموضوعة', 'Door / stair direction arrows ignored'],
  ['عدم تواجد المواد الكميائية (تنر/ زيوت / شحوم) داخل خطوط الإنتاج او في حوزة العاملين', 'Chemicals on production line'],
  ['جميع الأدوات والمعدات سليمة وصالحة للإستخدام (الوصلات الكهربائية / غطاء حماية للصاروخ / الحالة العامة للأدوات)', 'Damaged tools / equipment'],
  ['عدم الجري داخل صالات الإنتاج', 'Running in production hall'],
  ['عدم وضع اليدين في الجيب اثناء السير', 'Hands in pockets while walking'],
  ['يتم تخزين المواد الكميائية في خزانة مغلقة، وتكون تحت إشراف المهندس المسؤول عن الورشة', 'Chemicals not in locked cabinet'],
  ['التأكد من غلق مصدر الطاقة قبل إجراء أعمال الصيانة للمعدات', 'Power not isolated before maintenance'],
  ['عدم تواجد افراد داخل منطقة عمل الرافعة الشوكية', 'People in forklift work zone'],
  ['عدم وضع اليدين داخل غطاء الحماية في المعدات', 'Hands inside machine guard'],
  ['عدم إستخدام السيزر ليفت بدون تصريح من إدارة السلامة، مع إرتداء مهمات الوقاية ( خوذة / حزام الأمان / حذاء الأمان)', 'Scissor lift without permit / PPE'],
];

const SETTINGS = {
  week: { weekStart: 6, numbering: 'jan1', workDays: [6, 0, 1, 2, 3, 4] },
  targets: {
    // per working day; facility '*' = factory. weeks: { '202646': value } overrides.
    compliance_per_day: { '*': 15 },
    defects_per_day: {},
    critical_per_day: {},
    czcf_per_day: { '*': 0 },
    rework_per_day: {},
    safety_per_day: {},
  },
  targetWeeks: {}, // { kpi: { '202646': value } }
  spec: { mislocation: { lsl: 200, usl: 280 }, electrical: { lsl: null, usl: null } },
  facilitySpec: {}, // { 'EB Turbo': { mode: 'derived' } | { mode:'manual', lsl, usl } }
  newOperatorMonths: 3,
  presentation: { seconds: 30, pages: ['/', '/defects', '/defects/mislocation', '/defects/critical', '/compliance', '/safety'] },
  requireLogin: false,
  company: { name: 'SEWS-E', site: '6th of October, Egypt', department: 'Assembly Production Department' },
  repeatDays: 7,
};

// Built-in column mapping templates for the 3 known file layouts.
const TEMPLATES = [
  {
    name: 'Defects - Report_List_between_dates', data_type: 'defects', source: null, sheet_hint: '^Report_List', priority: 10,
    required: ['Date', 'Defect name', 'No of defect', 'Assembly line'],
    field_map: {
      week: 'Week', date: 'Date', team_leader: 'Team Leader name', shift: 'Shift', found_at: 'Defect found at', audit: 'Audit',
      defect_name: 'Defect name', defect_code: 'Defect code', yellow_card: 'Yellow card', produced_at: 'Defect produced at',
      breakdown: 'Breakdown', connector_no: 'Connector no', clip_no: 'Clip no', circuit_no: 'Circuit number',
      std_dim: 'Standard dimension', act_dim: 'Actual dimension', tol_min: 'Tolerance min', tol_max: 'Tolerance max', dev_dim: 'Deviation dimension',
      qty: 'No of defect', operator: 'Op name', terminal: 'Terminal', cpg: 'CPG', man: 'Man', machine: 'Machine', method: 'Method',
      material: 'Material', line: 'Assembly line', site: 'Site',
    },
  },
  {
    name: 'Compliance - week / Line sheet', data_type: 'compliance', source: 'Line', sheet_hint: '', priority: 5,
    required: ['Date', 'Defect name', 'Report No.', 'Data Entry'],
    field_map: {
      date: 'Date', week: 'Week', shift: 'Shift', facility: 'Facility', line: 'Assembly line', team_leader: 'Team Leader',
      violation: 'Defect name', operator: 'OP .ID', qty: 'Number of defects', patroller: 'Patroller', data_entry: 'Data Entry',
      time: 'Time', report_no: 'Report No.', found_at: 'Defect found at', station_no: 'NO', jig: 'JIG NUMBER',
      justification2: 'Justification2', comment: 'Comment', justification: 'Justification',
    },
  },
  {
    name: 'Compliance - Cam (camera cases)', data_type: 'compliance', source: 'Camera', sheet_hint: '^Cam', priority: 6,
    required: ['Date', 'Defect name', 'OP-Signature'],
    field_map: {
      date: 'Date', week: 'Week', shift: 'Shift', facility: 'Facility', line: 'Assembly line', team_leader: 'Team Leader',
      violation: 'Defect name', operator: 'OP .ID', qty: 'Number of defects', patroller: 'Patroller', time: 'Time',
      report_no: 'Report No.', found_at: 'Defect found at2', station_no: 'Station NO', comment: 'Comment', signature: 'OP-Signature',
    },
  },
  {
    name: 'Safety - All Record', data_type: 'safety', source: null, sheet_hint: '^All Record', priority: 10, exclusive: 'safety',
    required: ['Date', 'Area', 'Non-Compliance item', 'Department'],
    field_map: { date: 'Date', week: 'Week', shift: 'Shift', area: 'Area', location: 'Location', team: 'Team', item: 'Non-Compliance item', operator: 'OP .ID', department: 'Department', notes: 'Notes' },
  },
  {
    name: 'Safety - daily Compliance sheet', data_type: 'safety', source: null, sheet_hint: '^Compliance$', priority: 5, exclusive: 'safety',
    required: ['Date', 'Area', 'Non-Compliance item', 'Department'],
    field_map: { date: 'Date', week: 'Week', shift: 'Shift', area: 'Area', location: 'Location', team: 'Team', item: 'Non-Compliance item', operator: 'OP .ID', department: 'Department', notes: 'Notes' },
  },
  { name: 'Ignore - Defects pivot (Sheet1)', data_type: 'ignore', sheet_hint: '^Sheet1$', priority: 1, required: [], field_map: {} },
  { name: 'Ignore - Safety Summary pivot', data_type: 'ignore', sheet_hint: '^Summary$', priority: 1, required: [], field_map: {} },
  {
    name: 'Production quantities', data_type: 'production', source: null, sheet_hint: '', priority: 3,
    required: ['Date', 'Produced'], field_map: { date: 'Date', line: 'Assembly line', facility: 'Facility', qty: 'Produced' },
  },
  {
    name: 'Operator list (start dates)', data_type: 'operators', source: null, sheet_hint: '', priority: 3,
    required: ['Operator ID', 'Start date'], field_map: { operator: 'Operator ID', start_date: 'Start date', name: 'Name', facility: 'Facility' },
  },
];

// Target fields per data type for the column mapping wizard. required fields marked with *.
const FIELDS = {
  defects: { date: 'Date*', defect_name: 'Defect name*', qty: 'Quantity (No of defect)', line: 'Assembly line*', facility: 'Facility', week: 'Week', shift: 'Shift', team_leader: 'Team leader', found_at: 'Defect found at', audit: 'Audit', defect_code: 'Defect code', produced_at: 'Defect produced at (station)', operator: 'Operator ID', cpg: 'CPG (CZCF yes/no)', critical: 'Is critical (yes/no)', rework_min: 'Rework time (minutes)', part_number: 'Part number', category: 'Defect category', yellow_card: 'Yellow card', breakdown: 'Breakdown', connector_no: 'Connector no', clip_no: 'Clip no', circuit_no: 'Circuit number', terminal: 'Terminal', man: 'Man', machine: 'Machine', method: 'Method', material: 'Material', std_dim: 'Standard dimension', act_dim: 'Actual dimension', tol_min: 'Tolerance min', tol_max: 'Tolerance max', dev_dim: 'Deviation dimension', site: 'Site' },
  compliance: { date: 'Date*', violation: 'Violation (Defect name)*', facility: 'Facility', line: 'Assembly line', week: 'Week', shift: 'Shift', team_leader: 'Team leader', operator: 'Operator ID', qty: 'Number of cases', patroller: 'Patroller', data_entry: 'Data entry', time: 'Time', report_no: 'Report number', found_at: 'Defect found at', station_no: 'Station NO', jig: 'JIG number', operator_start: 'Operator start date', justification2: 'Justification2', comment: 'Comment', justification: 'Justification', signature: 'OP signature' },
  safety: { date: 'Date*', area: 'Area*', item: 'Non-compliance item*', week: 'Week', shift: 'Shift', location: 'Location', team: 'Team', operator: 'Operator ID', department: 'Department', notes: 'Notes' },
  production: { date: 'Date*', qty: 'Produced quantity*', line: 'Assembly line', facility: 'Facility' },
  operators: { operator: 'Operator ID*', start_date: 'Start date*', name: 'Name', facility: 'Facility' },
};

module.exports = { FACILITIES, FACILITY_RULES, CRITICAL_LIST, SAFETY_ITEMS, SETTINGS, TEMPLATES, FIELDS };
