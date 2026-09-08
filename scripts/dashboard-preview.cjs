// Standalone sample-data preview: deliberately never loads app.js, .env or the database.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { getDashboardPayments } = require('../dashboard-payments');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = source.indexOf('const translations = {');
const end = source.indexOf('\n};', start) + 3;
if (start < 0 || end < start) throw new Error('Could not locate dashboard translations');
const translations = vm.runInNewContext(source.slice(start, end) + '; translations', {}, { timeout: 1000 });
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));
app.use(express.static(path.join(root, 'public')));
app.get('/preview-assets/:file', (req, res) => {
  if (!['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(req.params.file)) return res.sendStatus(404);
  res.sendFile(path.join(root, 'test-results', req.params.file));
});
app.get(['/', '/dashboard'], (req, res, next) => {
  const role = ['parent', 'catechist', 'admin', 'family_faith_leader'].includes(req.query.role) ? req.query.role : 'parent';
  const lang = req.query.lang === 'es' ? 'es' : 'en';
  const empty = req.query.state === 'empty';
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const cls = { id: 12, label: 'Second Year Communion A', time: 'Sunday 10:00–11:15 AM', room: '4', nextDate: date, href: `/admin/classes/12?date=${date}#class-attendance` };
  const reg = { id: 1, user_id: 1, student_full_name: 'Sofia Example', status: 'admitted', school_year: '2026-2027', ccd_grade_level: '2', registration_fee: 150 };
  if (['paid', 'partial', 'shared', 'family-paid'].includes(req.query.state)) {
    Object.assign(reg, { tuition_paid: 1, tuition_amount_paid: req.query.state === 'family-paid' ? 200 : req.query.state === 'partial' ? 50 : 150, tuition_paid_at: new Date().toISOString().slice(0, 10), tuition_payment_method: 'imported', tuition_transaction_id: 'SAMPLE-123' });
  }
  const groups = [ ['child', 3, 'child', 'in_progress'], ['conditional', 1, 'child', 'conditionally_accepted'], ['family', 1, 'family_faith', 'in_progress'] ].map(([key, count, type, status]) => ({ key, count: empty ? 0 : count, href: `/admin/registrations?type=${type}&status=${status}` }));
  const locals = {
    lang, t: key => translations[lang][key] || key, user: { id: 1, role, email: 'sample@example.test', provider: 'local' },
    success: [], error: [], studentRegs: empty ? [] : [reg], familyRegs: [], adultRegs: [], sponsorRegs: [], myStudents: [],
    myRegisteredChildren: empty ? [] : [{ reg, assignedClass: { id: 12, class_time: cls.time, classroom: '4', sectionLabel: 'A', catechists: [] }, gradeLabel: 'Second Year Communion', upcomingSessionDates: [date] }],
    totalFeesDue: empty ? 0 : 150, feeBreakdown: [], communicationUnread: empty ? 0 : 2,
    faithFormationSettings: { faithFormationRegistrationOpen: true, sponsorFormRegistrationOpen: true },
    ADULT_PROGRAMS: Object.fromEntries(['ocia', 'baptism_prep', 'adult_confirmation'].map(key => [key, { title: key === 'ocia' ? 'OCIA' : key.replaceAll('_', ' '), description: 'Sample program', icon: '○' }])),
    familyNextClasses: role === 'parent' && !empty ? { hasClasses: true, date, classes: [{ ...cls, children: [{ name: reg.student_full_name, conditional: false }] }] } : null,
    teachingClasses: role === 'family_faith_leader' ? (empty ? [] : [{ ...cls, label: 'Parent Faith Formation Session' }]) : role === 'catechist' ? (empty ? [] : [cls, { id: 13, label: 'OCIA', time: 'Wednesday 6:30 PM', nextDate: null, href: '/admin/classes/13' }]) : null,
    adminReview: { total: empty ? 0 : 5, groups, items: empty ? [] : groups.flatMap(group => Array.from({ length: group.count }, (_, index) => ({ key: group.key, name: `Sample registration ${index + 1}`, href: group.href }))) },
  };
  if (['shared', 'family-unpaid', 'family-paid'].includes(req.query.state)) { reg.registration_fee = 200; locals.studentRegs.push({ ...reg, id: 2, registration_fee: 0, student_full_name: 'Mateo Example' }); }
  locals.dashboardPayments = getDashboardPayments(locals.studentRegs, 1);
  if (req.query.state === 'installments') {
    reg.tuition_paid = 1;
    locals.dashboardPayments = getDashboardPayments(locals.studentRegs, 1, [
      { id: 1, registration_id: 1, user_id: 1, student_full_name: reg.student_full_name, amount: '75.00', paid_at: '2026-09-01', method: 'imported' },
      { id: 2, registration_id: 1, user_id: 1, student_full_name: reg.student_full_name, amount: '25.50', paid_at: '2026-09-07', method: 'check' },
    ]);
  }
  locals.adminAttention = { balances: empty ? [] : [{ name: 'Sofia and Mateo Example', href: '/admin/students?status=all#student-detail-1' }], amounts: empty ? [] : [{ name: 'Sample family — amount not recorded', href: '/admin/students?status=all#student-detail-2' }], sessions: empty ? [] : [{ name: 'Parent Faith Formation — date needed', href: '/admin/classes/13' }] };
  res.render('dashboard', locals, (error, html) => {
    if (error) return next(error);
    const toolbar = `<aside style="padding:12px;background:#fff3cd;color:#29251b;font:14px system-ui"><strong>Sample dashboard preview</strong> · No account required
      <form style="display:inline" method="get"><label> View <select name="role">${['parent', 'catechist', 'admin', 'family_faith_leader'].map(value => `<option ${value === role ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label> Language <select name="lang"><option value="en">English</option><option value="es" ${lang === 'es' ? 'selected' : ''}>Español</option></select></label>
      <label> Data <select name="state">${[['sample', 'Unpaid'], ['paid', 'Paid'], ['partial', 'Partial payment'], ['installments', 'Imported + manual payments'], ['shared', 'Family partial payment'], ['family-unpaid', 'Family unpaid'], ['family-paid', 'Family paid'], ['empty', 'Empty dashboard']].map(([value, title]) => `<option value="${value}" ${req.query.state === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label> <button>Show dashboard</button></form>
      <div>Try the tabs and account menu. Links to other pages show a preview notice; no records or payments are changed.</div></aside>`;
    html = html.replace('<body>', '<body>' + toolbar);
    for (const file of ['bootstrap.min.css', 'bootstrap.bundle.min.js']) {
      if (fs.existsSync(path.join(root, 'test-results', file))) html = html.replace(new RegExp('https://cdn\\.jsdelivr\\.net/npm/bootstrap@5\\.3\\.3/dist/(css|js)/' + file.replaceAll('.', '\\.')), '/preview-assets/' + file);
    }
    html = html.replace('</body>', `<script>document.addEventListener('click',function(event){const link=event.target.closest('a');if(!link)return;event.preventDefault();alert('Dashboard preview only. This link opens another page in the full application.');});</script></body>`);
    res.send(html);
  });
});
app.use((req, res) => res.status(404).send('Dashboard preview only. Return to http://127.0.0.1:3199/'));
app.listen(3199, '127.0.0.1', () => console.log('Dashboard preview: http://127.0.0.1:3199/'));
