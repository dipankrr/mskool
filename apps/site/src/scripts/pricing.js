// Pricing page: student count + plan + billing drive the printed quote, the plan cards,
// the comparison highlight and the WhatsApp links. Prices come from src/pricing.ts via #page-data.
const PAGE = JSON.parse(document.getElementById('page-data').textContent);
const PLANS = PAGE.plans, MIN = PAGE.min, WA = PAGE.wa;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const inr = (x) => '₹' + Math.round(x).toLocaleString('en-IN');

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);

/* nav glass, dock, reveals (same behaviour as the landing page) */
const nav = $('nav'), dock = $('dock');
new IntersectionObserver(([e]) => nav.classList.toggle('solid', !e.isIntersecting)).observe($('topSentinel'));
let heroIn = true, ctaIn = false;
const dockSync = () => dock.classList.toggle('up', !heroIn && !ctaIn);
new IntersectionObserver(([e]) => { heroIn = e.isIntersecting; dockSync(); }, { threshold: .1 }).observe($('top'));
new IntersectionObserver(([e]) => { ctaIn = e.isIntersecting; dockSync(); }, { threshold: .05 }).observe($('apply'));
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.rv').forEach((el) => io.observe(el));

/* state */
const S = { n: Number($('nIn').value) || 400, plan: 'school', bill: 'y' };
const range = $('nRange'), num = $('nIn'), slip = $('slip'), cards = document.querySelector('.cards'), table = document.querySelector('.tbl table');
$('qDate').textContent = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const waLink = (text) => WA ? 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text) : '#apply';
const billWord = () => (S.bill === 'y' ? 'yearly' : 'monthly');
/** Total for one billing period (a year or a month) and the rate used. */
const quote = (p) => {
  const rate = S.bill === 'y' ? p.yearly : p.monthly, billed = Math.max(S.n, MIN);
  return { rate, billed, total: rate * billed * (S.bill === 'y' ? 12 : 1) };
};

let lastTot = '';
function render() {
  const p = PLANS.find((x) => x.id === S.plan), q = quote(p);
  $('qPlan').textContent = p.name;
  $('qN').textContent = S.n.toLocaleString('en-IN');
  $('qMin').hidden = S.n >= MIN;
  $('qRate').textContent = '₹' + q.rate + ' × ' + q.billed.toLocaleString('en-IN') + (S.bill === 'y' ? ' × 12' : '');
  $('qSub').textContent = inr(q.total);
  $('qTotL').textContent = S.bill === 'y' ? 'Total a year' : 'Total a month';
  const tot = $('qTot'); tot.textContent = inr(q.total);
  if (lastTot && lastTot !== tot.textContent && !reduce) { tot.classList.remove('flash'); void tot.offsetWidth; tot.classList.add('flash'); }
  lastTot = tot.textContent;
  $('qAltL').textContent = S.bill === 'y' ? 'That is, a month' : 'That is, a year';
  $('qAlt').textContent = inr(S.bill === 'y' ? q.total / 12 : q.total * 12);
  // Office has no parent app: show it struck through rather than as a free line.
  $('qParent').classList.toggle('q-off', p.id === 'office');

  cards.dataset.bill = S.bill;
  PLANS.forEach((pl) => {
    const c = quote(pl);
    document.querySelector(`[data-for="${pl.id}"]`).textContent =
      S.n.toLocaleString('en-IN') + ' students: ' + inr(c.total) + (S.bill === 'y' ? ' a year' : ' a month');
    document.querySelector(`[data-card="${pl.id}"]`).classList.toggle('sel', pl.id === S.plan);
    document.querySelector(`[data-choose="${pl.id}"]`).href =
      waLink(`Hi mSkool, I'm interested in the ${pl.name} plan for about ${S.n} students, billed ${billWord()}.`);
  });
  document.querySelectorAll('[data-plan]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plan === S.plan)));
  document.querySelectorAll('[data-bill]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bill === S.bill)));
  table.dataset.sel = S.plan;
  $('qGo').href = waLink(`Hi mSkool, please send me this quote.\n\nPlan: ${p.name}\nStudents: ${S.n}\nBilling: ${billWord()}\nTotal: ${inr(q.total)} ${S.bill === 'y' ? 'a year' : 'a month'} + GST`);
}

/** Feed the receipt out of the printer again (on plan or billing change). */
function reprint() {
  if (reduce) return;
  slip.classList.remove('print'); void slip.offsetWidth; slip.classList.add('print');
}

const setRangeFill = () => range.style.setProperty('--p', ((Number(range.value) - range.min) / (range.max - range.min)) * 100 + '%');
range.addEventListener('input', () => { S.n = Number(range.value); num.value = String(S.n); setRangeFill(); render(); });
num.addEventListener('input', () => {
  const v = Math.floor(Number(num.value));
  if (!v || v < 1) return;
  S.n = Math.min(v, 20000);
  range.value = String(Math.min(Math.max(S.n, 50), 3000)); setRangeFill(); render();
});
num.addEventListener('blur', () => { num.value = String(S.n); });
document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { if (S.plan === b.dataset.plan) return; S.plan = b.dataset.plan; render(); reprint(); }));
document.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => { if (S.bill === b.dataset.bill) return; S.bill = b.dataset.bill; render(); reprint(); }));
// Tapping a plan card picks that plan (the Choose button still opens WhatsApp).
document.querySelectorAll('[data-card]').forEach((c) => c.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  if (S.plan !== c.dataset.card) { S.plan = c.dataset.card; render(); reprint(); }
}));

setRangeFill();
render();
