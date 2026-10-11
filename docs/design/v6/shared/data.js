/* Wayfinder v6 design MOCK (retired for the app): the pages' data SHAPE lives on in packages/shared/src/wf.ts,
   filled from Tiger / data/fixtures by apps/web/lib/wf. Kept so the static mockups still open.
   One simulated company shared by every page, so the numbers agree.
   window.WF = { org, people, me, queries, matches, stats, series, routing, darwin, helpers } */
(() => {
  'use strict';
  // Departments (big nodes) → sub-departments (medium) → people (small)
  const org = [
    {id:'lead', name:'Leadership', subs:[{id:'exec', name:'Executive Office', people:['Ben Ortiz', 'Mara Lin']}, {id:'strat', name:'Strategy', people:['Jon Reyes', 'Kezia Moe']}]},
    {id:'sales', name:'Sales', subs:[{id:'ae', name:'Account Execs', people:['Sam Cole', 'Ivy Tran', 'Raj Patel']}, {id:'mktg', name:'Marketing', people:['Nina Bose', 'Owen Hart']}]},
    {id:'ops', name:'Operations', subs:[{id:'proc', name:'Procurement', people:['Ivan Petrov', 'Lucy Fern']}, {id:'fac', name:'Facilities', people:['Fatima Noor', 'Gus Wade']}, {id:'it', name:'IT Help', people:['Dev Shah', 'Ola Berg']}]},
    {id:'fin', name:'Finance', subs:[{id:'fpa', name:'FP&A', people:['Priya Rao', 'Hal Moss']}, {id:'pay', name:'Payables', people:['Cora Diaz', 'Eli Park']}]},
    {id:'legal', name:'Legal', subs:[{id:'contracts', name:'Contracts', people:['Ana Silva', 'Theo Vance']}, {id:'privacy', name:'Privacy', people:['Rina Sato']}]},
    {id:'eng', name:'Engineering', subs:[{id:'platform', name:'Platform', people:['Tom Becker', 'Yuki Mori', 'Abe Lund']}, {id:'product', name:'Product Eng', people:['Zoe Kim', 'Max Ruiz']}]},
    {id:'data', name:'Data Platform', subs:[{id:'infra', name:'Data Infra', people:['Dmitri Volkov', 'Sia Ng']}, {id:'gov', name:'Governance', people:['Paul Adeyemi']}]},
    {id:'analytics', name:'Analytics Eng', subs:[{id:'models', name:'Modeling', people:['Leo Park', 'June Ali']}, {id:'bi', name:'BI & Dashboards', people:['Kai Hughes', 'Ama Osei']}]},
    {id:'people', name:'People Ops', subs:[{id:'hr', name:'HR Partners', people:['Iris Cho', 'Noah Bell']}, {id:'onb', name:'Onboarding', people:['Lena Fox']}]},
  ];
  const people = [];
  org.forEach(d => d.subs.forEach(s => s.people.forEach(full => {
    const first = full.split(' ')[0];
    people.push({id:first.toLowerCase(), name:full, first, dept:d.id, deptName:d.name, sub:s.id, subName:s.name});
  })));
  const P = id => people.find(p => p.id === id);
  const D = id => org.find(d => d.id === id);
  const me = P('leo');   // the viewer: Leo, a new Analytics Eng hire

  // Queries Leo has raised. hops: each stop Wayfinder routed to. verdict: redirect | delegate | approve | answer | pending
  const queries = [
    {id:'q-db', title:'Read access to the customer DB', status:'active', started:'Mon 9:02', elapsed:'1 h 12 m', usual:'4 days', type:'Access',
      hops:[
        {who:'dmitri', verdict:'redirect', msg:'Not us. Analytics Engineering owns that now.', at:'9:04'},
        {who:'priya', verdict:'delegate', msg:"I'm out till Thursday, ask Tom.", at:'9:21'},
        {who:'tom', verdict:'approve', msg:'Granted read access. Ben has to sign off.', at:'9:48'},
        {who:'ben', verdict:'pending', msg:'Waiting on approval by text.', at:'10:14'},
      ], learned:{from:'leo', to:'june', note:'Customer DB access belongs to Analytics Eng (Modeling)'}},
    {id:'q-vendor', title:'Vendor NDA for the churn data pilot', status:'active', started:'Mon 10:30', elapsed:'38 m', usual:'9 days', type:'Legal',
      hops:[
        {who:'nina', verdict:'redirect', msg:'Marketing does not sign NDAs.', at:'10:31'},
        {who:'ivan', verdict:'redirect', msg:'Procurement only handles purchase orders.', at:'10:40'},
        {who:'ana', verdict:'pending', msg:'Reviewing the draft now.', at:'10:55'},
      ], learned:{from:'leo', to:'ana', note:'Vendor NDAs go straight to Legal · Contracts'}},
    {id:'q-budget', title:'Conference budget for dbt Summit', status:'active', started:'Mon 11:05', elapsed:'12 m', usual:'3 days', type:'Money',
      hops:[
        {who:'hal', verdict:'delegate', msg:'Priya owns travel budgets this quarter.', at:'11:07'},
        {who:'priya', verdict:'pending', msg:'Auto-reply: back Thursday. Wayfinder will remind her.', at:'11:08'},
      ]},
    {id:'q-badge', title:'Building badge', status:'done', started:'Mon 8:10', elapsed:'14 m', usual:'1 day', type:'Facilities',
      hops:[{who:'fatima', verdict:'answer', msg:'Badge ready at the front desk.', at:'8:24'}]},
    {id:'q-laptop', title:'Laptop with 32 GB RAM', status:'done', started:'Fri 4:40', elapsed:'2 h 5 m', usual:'5 days', type:'IT',
      hops:[{who:'ola', verdict:'redirect', msg:'Hardware upgrades go through Dev.', at:'4:52'}, {who:'dev', verdict:'answer', msg:'Shipping a 32 GB MacBook Monday.', at:'6:45'}]},
    {id:'q-staging', title:'A staging server for the churn model', status:'done', started:'Fri 2:15', elapsed:'54 m', usual:'2 days', type:'Infra',
      hops:[{who:'sia', verdict:'redirect', msg:'Staging lives with Platform.', at:'2:20'}, {who:'tom', verdict:'answer', msg:'stg-churn-01 is yours for two weeks.', at:'3:09'}]},
  ];
  // Chat / transaction log per query: who said what, plus approvals and payments
  const transactions = {
    'q-db':[
      {t:'9:02', from:'leo', kind:'msg', text:'I need read access to the customer database for the churn model.'},
      {t:'9:02', from:'wf', kind:'route', text:'Routing to Data Platform · Data Infra (Dmitri).'},
      {t:'9:04', from:'dmitri', kind:'msg', text:'Not us. Analytics Engineering owns that now.'},
      {t:'9:05', from:'wf', kind:'learn', text:'Learned: customer DB access belongs to Analytics Eng.'},
      {t:'9:21', from:'priya', kind:'msg', text:"I'm out till Thursday, ask Tom."},
      {t:'9:48', from:'tom', kind:'approve', text:'Granted read-only role analytics_reader.'},
      {t:'10:14', from:'wf', kind:'pending', text:'Asked Ben Ortiz to approve by text. Reminder in 2 h.'},
    ],
    'q-vendor':[
      {t:'10:30', from:'leo', kind:'msg', text:'We need an NDA with Churnly before sharing sample data.'},
      {t:'10:31', from:'nina', kind:'msg', text:'Marketing does not sign NDAs.'},
      {t:'10:40', from:'ivan', kind:'msg', text:'Procurement only handles purchase orders.'},
      {t:'10:55', from:'ana', kind:'msg', text:'Send me the draft. I can turn it around today.'},
    ],
    'q-budget':[
      {t:'11:05', from:'leo', kind:'msg', text:'Can I get $1,450 for dbt Summit (ticket + hotel)?'},
      {t:'11:07', from:'hal', kind:'msg', text:'Priya owns travel budgets this quarter.'},
      {t:'11:08', from:'wf', kind:'pay', text:'Held $1,450 in Nessie pending Priya’s OK.'},
    ],
    'q-badge':[{t:'8:10', from:'leo', kind:'msg', text:'Where do I get my badge?'}, {t:'8:24', from:'fatima', kind:'approve', text:'Badge ready at the front desk.'}],
    'q-laptop':[{t:'4:40', from:'leo', kind:'msg', text:'Can I get a 32 GB laptop?'}, {t:'4:52', from:'ola', kind:'msg', text:'Hardware upgrades go through Dev.'}, {t:'6:45', from:'dev', kind:'approve', text:'Shipping Monday.'}],
    'q-staging':[{t:'2:15', from:'leo', kind:'msg', text:'Need a staging box for the churn model.'}, {t:'2:20', from:'sia', kind:'msg', text:'Staging lives with Platform.'}, {t:'3:09', from:'tom', kind:'approve', text:'stg-churn-01 is yours for two weeks.'}],
  };
  // Mycelium matches for the Lagoon: people with overlapping queries or spare resources
  const matches = [
    {a:'leo', b:'ana', kind:'query', why:'both asked about churn models this week', score:.92, topic:'Churn models'},
    {a:'leo', b:'kai', kind:'query', why:'Kai built the retention dashboard Leo is rebuilding', score:.87, topic:'Retention dashboard'},
    {a:'leo', b:'zoe', kind:'resource', why:'Zoe has a spare dbt Summit ticket', score:.81, topic:'dbt Summit'},
    {a:'leo', b:'yuki', kind:'query', why:'both requested GPU staging this month', score:.74, topic:'GPU staging'},
    {a:'leo', b:'june', kind:'team', why:'same team, joined three weeks apart', score:.7, topic:'Onboarding buddy'},
    {a:'priya', b:'tom', kind:'query', why:'both stuck on the same budget dashboard', score:.68, topic:'Budget dashboard'},
  ];
  // Headline stats (Home globe + Insights)
  const stats = {hoursSaved:1284, peopleHelped:people.length * 12, departments:org.length, subDepartments:org.reduce((n, d) => n + d.subs.length, 0),
    requestsRouted:3470, avgHopsBefore:6.1, avgHopsAfter:1.4, introsMade:212, approvalsByText:860, medianResolve:'1 h 40 m', medianBefore:'4.2 days'};
  // Weekly series for charts (12 weeks)
  const series = Array.from({length:12}, (_, i) => ({week:`W${i + 1}`, requests:180 + Math.round(i * 22 + Math.sin(i) * 18), resolved:150 + Math.round(i * 24 + Math.cos(i) * 12),
    hops:+(6.1 - i * .4 + Math.sin(i * 1.3) * .15).toFixed(1), hoursSaved:40 + i * 14 + Math.round(Math.sin(i * .8) * 6)}));
  // Hours saved and request share per department (skill bars, gain graph)
  const byDept = org.map((d, i) => ({id:d.id, name:d.name, hoursSaved:[96, 142, 231, 168, 120, 188, 110, 154, 75][i], requests:[210, 380, 610, 420, 300, 520, 290, 480, 260][i],
    hopsBefore:[4.2, 5.1, 7.4, 6.0, 6.8, 5.5, 6.3, 5.9, 4.8][i], hopsAfter:[1.2, 1.5, 1.9, 1.4, 1.3, 1.6, 1.4, 1.2, 1.1][i]}));
  // Department → department routing volume (chord/sankey)
  const routing = [['sales', 'legal', 120], ['sales', 'fin', 90], ['analytics', 'data', 160], ['eng', 'ops', 70], ['people', 'ops', 140], ['fin', 'lead', 60],
    ['ops', 'fin', 110], ['analytics', 'eng', 80], ['legal', 'lead', 40], ['eng', 'data', 95], ['people', 'legal', 30], ['sales', 'analytics', 55]];
  // Darwin generations: each evolves routing rules; fitness rises, hops fall
  const darwin = Array.from({length:10}, (_, i) => ({gen:i + 1, avgHops:+(6.1 - (6.1 - 1.4) * (1 - Math.pow(1 - i / 9, 1.8))).toFixed(1),
    fitness:+(0.31 + 0.64 * (1 - Math.pow(1 - i / 9, 2))).toFixed(2), rules:[2, 3, 5, 6, 8, 9, 11, 12, 14, 15][i]}));
  const rules = [
    {id:'r1', gen:2, text:'Vendor NDAs go straight to Legal · Contracts', saves:'5 hops', status:'approved'},
    {id:'r2', gen:3, text:'Customer DB access → Analytics Eng · Modeling', saves:'3 hops', status:'approved'},
    {id:'r3', gen:4, text:'When Priya is out, travel budgets go to Hal', saves:'2 days', status:'approved'},
    {id:'r4', gen:5, text:'Badge requests auto-answer with front desk hours', saves:'1 hop', status:'approved'},
    {id:'r5', gen:6, text:'Staging servers → Platform, skip Data Infra', saves:'1 hop', status:'approved'},
    {id:'r6', gen:7, text:'Spend under $500 approved by manager text, not VP', saves:'1.5 days', status:'approved'},
    {id:'r7', gen:8, text:'New hires get an onboarding buddy from their sub-team', saves:'intro', status:'proposed'},
    {id:'r8', gen:9, text:'Hardware upgrades go to Dev, not IT Help queue', saves:'1 hop', status:'proposed'},
    {id:'r9', gen:10, text:'Privacy reviews run in parallel with Contracts', saves:'3 days', status:'proposed'},
  ];

  window.WF = {org, people, me, queries, transactions, matches, stats, series, byDept, routing, darwin, rules,
    person:P, dept:D, query:id => queries.find(q => q.id === id) || queries[0],
    nameOf:id => id === 'wf' ? 'Wayfinder' : (P(id)?.first ?? id)};
})();
