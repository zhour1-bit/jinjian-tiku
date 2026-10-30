import {formatContent,prepareMath} from './math-format.js?v=285d646ede81';
const root=document.querySelector('#app');
const names={mock:'模考',past:'真题',practice:'千题千练',last30:'考前三十分'};
let bank=[],baseBank=new Map(),report={issues:[]},view={page:'home',category:null,module:null,mode:null,index:0,filter:null,review:false,editId:null,issueFilter:'open',returnPage:'issues',examNavOpen:null,studyParent:'module',listPage:0},db=load();
function normalizeNotes(value){return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,text])=>typeof text==='string')):{}}
function load(){let empty={version:1,favorites:{},read:{},attempts:[],sessions:{},corrections:{},reviewed:{},notes:{}};try{let x=JSON.parse(localStorage.getItem('jinjian-v1'));return x?.version===1?{...empty,...x,corrections:x.corrections||{},reviewed:x.reviewed||{},notes:normalizeNotes(x.notes)}:empty}catch{return empty}}
let noteTimer=null,pendingNote=null;
function commitNote(status){
  clearTimeout(noteTimer);noteTimer=null;
  if(!pendingNote)return;
  const{id,value}=pendingNote;
  if(value.trim())db.notes[id]=value;else delete db.notes[id];
  try{save();pendingNote=null;if(status)status.textContent=value.trim()?'已保存（可在收藏/错题中查看）':'备注已清空'}
  catch{const target=status||root.querySelector('#note-status');if(target)target.textContent='保存失败：请导出备份或清理浏览器空间后重试'}
}
window.addEventListener('pagehide',()=>commitNote());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')commitNote()});
function save(){metricCache=null;localStorage.setItem('jinjian-v1',JSON.stringify(db))}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const fmt=formatContent;
const questionIndex=new Map(),questionModule=new Map(),pendingModules=new Map();
let issueIds=new Set(),metricCache=null,navigationId=0,retryNavigation=null;
const all=()=>[...questionIndex.values()];
const byid=id=>questionIndex.get(id);
function indexModule(m){
  for(const q of m.items){Object.assign(q,{moduleId:m.id,moduleTitle:m.title,category:m.category});questionIndex.set(q.id,q)}
  m.studyItems=m.items.filter(q=>m.category==='last30'||q.valid);
  m.validCount=m.studyItems.length;
}
async function jsonFetch(url,options){const response=await fetch(url,options);if(!response.ok)throw Error('加载失败（'+response.status+'），请重试。');return response.json()}
async function ensureModule(m){
  if(!m||m.loaded)return;
  if(pendingModules.has(m.id))return pendingModules.get(m.id);
  const request=jsonFetch(m.dataFile).then(data=>{
    m.items=data.items.map(q=>({...q,...(q.passageId?{passage:data.passages[q.passageId]}:{})}));
    baseBank.set(m.id,structuredClone(m.items));m.loaded=true;applyCorrections();
  }).finally(()=>pendingModules.delete(m.id));
  pendingModules.set(m.id,request);return request;
}
function wrongIds(){const last=new Map();for(const a of db.attempts)last.set(a.id,a.correct);return [...last].filter(([,correct])=>!correct).map(([id])=>id)}
async function preparePage(page){
  let ids=[];
  if(page==='favorites')ids=Object.keys(db.favorites).filter(id=>db.favorites[id]);
  if(page==='wrong')ids=wrongIds();
  if(page==='issues')ids=[...issueIds];
  if(page==='edit')ids=[view.editId];
  const modules=new Set(ids.map(id=>questionModule.get(id)).filter(Boolean));
  if(page==='module'||page==='study')modules.add(view.module);
  await Promise.all([...modules].map(ensureModule));
  if(page==='study')await prepareMath();
}
async function navigate(page,updates={}){
  const token=++navigationId;Object.assign(view,updates);
  if(page==='favorites'||page==='wrong')view.listPage=0;
  view.page='loading';view.loadingTarget=page;render();
  try{await preparePage(page);if(token!==navigationId)return;view.page=page;render()}
  catch(error){if(token!==navigationId)return;view.page='loadError';view.loadError=error.message;retryNavigation=()=>navigate(page,updates);render()}
}
function metrics(){
  if(metricCache)return metricCache;
  const result=new Map(bank.map(m=>[m.id,{attempts:[],done:new Set(),right:0}]));
  for(const attempt of db.attempts){const module=questionModule.get(attempt.id),r=result.get(module?.id);if(r){r.attempts.push(attempt);r.done.add(attempt.id);if(attempt.correct)r.right++}}
  return metricCache=result;
}
function validQuestion(q){return !!(q.stem?.trim()&&Object.keys(q.options||{}).length>=2&&q.answer?.length&&q.answer.every(a=>q.options[a]?.trim()))}
function applyCorrections(){for(const m of bank){if(!m.loaded)continue;for(const q of m.items){const c=db.corrections[q.id];if(c){Object.assign(q,c);q.valid=validQuestion(q)}}indexModule(m)}}
function issueGroups(){let grouped=new Map;for(let i of report.issues){if(!grouped.has(i.questionId))grouped.set(i.questionId,[]);grouped.get(i.questionId).push(i)}return [...grouped].map(([id,issues])=>({id,issues,question:byid(id)})).filter(g=>g.question)}
const issueLabels={missing_answer:'缺少答案',missing_options:'缺少选项',answer_option_mismatch:'答案与选项不匹配',duplicate_number:'题号重复',duplicate_options:'选项内容重复',missing_stem:'题干缺失'};
function issueOpen(id){return !db.reviewed[id]&&issueIds.has(id)}
const completed=m=>m.category==='last30'?m.questionIds.filter(id=>db.read[id]).length:metrics().get(m.id).done.size;
const history=m=>metrics().get(m.id).attempts;
function header(){
  const open=[...issueIds].filter(id=>!db.reviewed[id]).length;
  const studyMenu=view.studyParent==='module'?'home':view.studyParent;
  const active=view.page==='study'?studyMenu:view.page==='edit'?(view.returnPage==='study'?studyMenu:'issues'):['category','module'].includes(view.page)?'home':view.page;
  const links=[['home','题库'],['favorites','收藏'],['wrong','错题'],['issues','待纠错 '+open],['stats','统计']];
  return `<div class="top"><div class="brand-row"><div class="brand">金监题库</div><div class="sub">财经岗 · 按自己的节奏准备每一题</div></div><nav class="nav" aria-label="主导航">${links.map(([page,label])=>`<button data-go="${page}" class="${active===page?'active':''}" ${active===page?'aria-current="page"':''}>${label}</button>`).join('')}</nav></div>`;
}
function render(){commitNote();let body='';if(view.page==='home')body=home();if(view.page==='category')body=category();if(view.page==='module')body=modulePage();if(view.page==='study')body=study();if(view.page==='favorites'||view.page==='wrong')body=listPage();if(view.page==='issues')body=issuesPage();if(view.page==='edit')body=editPage();if(view.page==='stats')body=stats();if(view.page==='loading')body='<div class="panel empty" role="status">正在加载…</div>';if(view.page==='loadError')body=`<div class="panel empty"><p>${esc(view.loadError)}</p><button class="primary" data-retry-load>重新加载</button></div>`;root.innerHTML=`<div class="shell">${header()}${backBar()}${body}</div>`;bind()}
function home(){let modules=bank.length, questions=bank.reduce((n,m)=>n+m.count,0),done=new Set(db.attempts.map(x=>x.id)).size;return `<div class="home-overview"><div class="stats"><div class="stat"><strong>${modules}</strong><span>学习子模块</span></div><div class="stat"><strong>${questions}</strong><span>题目与卡片</span></div><div class="stat"><strong>${done}</strong><span>已做题目</span></div><div class="stat"><strong>${Object.keys(db.favorites).filter(k=>db.favorites[k]).length}</strong><span>已收藏</span></div></div><div class="section-head"><h2>选择分类</h2></div><div class="grid">${Object.entries(names).map(([key,name])=>{let ms=bank.filter(m=>m.category===key);return `<div class="card"><span class="badge">${ms.length} 个子模块</span><h3>${name}</h3><p>${key==='last30'?'知识点与公式，随时翻阅':key==='practice'?'按章节巩固，随机模拟考试':'按原卷练习与模拟考试'}</p><button class="primary" data-cat="${key}">进入分类 →</button></div>`}).join('')}</div></div>`}
function category(){let ms=bank.filter(m=>m.category===view.category);return `<div class="toolbar"><button class="soft" data-go="home">← 全部分类</button><span class="pill">${names[view.category]}</span></div><div class="section-head"><h2>${names[view.category]} · ${ms.length} 个子模块</h2></div><div class="grid">${ms.map(m=>{let n=m.count,d=completed(m);return `<div class="card"><h3>${esc(m.title)}</h3><p>${n} ${m.category==='last30'?'张卡片':'道题'} · 已${m.category==='last30'?'读':'做'} ${d}</p><div class="progress"><i style="width:${n?d/n*100:0}%"></i></div><button class="primary" data-module="${m.id}">选择模式 →</button></div>`}).join('')}</div>`}
function examPool(m){return m.items.filter(q=>q.valid&&!issueOpen(q.id))}
function randomExamSetup(m){
  const pool=examPool(m),session=db.sessions[m.id+':exam'];
  const pending=session?.random&&session.questionIds?.length;
  const count=pending?session.questionIds.length:20;
  return `<section class="random-exam"><h2>随机模拟考试</h2><p class="sub">从当前「${esc(m.title)}」随机抽取10–30题，每题1分，交卷后统一查看答案。</p>
  ${pending?`<div class="resume-exam"><span>未完成考试 · ${session.questionIds.length}题 · 已答 ${session.questionIds.filter(id=>session.answers[id]?.length).length}题</span><button type="button" class="soft" data-resume-exam>继续考试</button></div>`:''}
  <form id="random-exam-form" class="exam-setup"><label for="random-exam-count">考试题数</label><select id="random-exam-count" name="count" aria-describedby="exam-pool-info">${Array.from({length:21},(_,i)=>i+10).map(n=>`<option value="${n}" ${n===count?'selected':''} ${n>pool.length?'disabled':''}>${n}题</option>`).join('')}</select><button class="primary" type="submit" ${pool.length<10?'disabled':''}>${pending?'重新抽题考试':'随机抽题并开始'}</button></form><p class="small muted" id="exam-pool-info">可抽取 ${pool.length} 道完整题目，同一场考试不重复抽题。${pool.length<10?'当前题量不足10题，暂不能组卷。':''}</p><div class="error" id="random-exam-error" role="alert"></div></section>`;
}
function modulePage(){
  const m=view.module,n=m.items.length,d=completed(m),h=history(m),right=h.filter(x=>x.correct).length;
  const modes=m.category==='last30'?[['cards','背诵卡片','翻阅知识点、公式，记录已读进度']]:[['practice','练习模式','作答后立即看答案与解析'],['review','背题模式','直接看答案，标记已读'],...(m.category==='practice'||m.items.some(x=>!x.valid||issueOpen(x.id))?[]:[['exam','考试模式','按原卷作答，交卷后统一复盘']])];
  return `<div class="toolbar"><button class="soft" data-cat="${m.category}">← ${names[m.category]}</button></div><div class="panel"><span class="badge">${names[m.category]}</span><h1>${esc(m.title)}</h1><div class="sub">${n} ${m.category==='last30'?'张卡片':'道题'} · 已${m.category==='last30'?'读':'做'} ${d}${m.category!=='last30'?` · 正确率 ${h.length?Math.round(right/h.length*100):0}%`:''}</div><div class="choices">${modes.map(([mode,title,desc])=>`<button class="mode" data-mode="${mode}"><strong>${title}</strong><small>${desc}</small></button>`).join('')}</div>${m.category==='practice'?randomExamSetup(m):''}${m.category!=='last30'&&m.items.some(x=>!x.valid||issueOpen(x.id))?`<div class="warning">本模块有 ${m.items.filter(x=>!x.valid||issueOpen(x.id)).length} 道题待核对。${m.category==='practice'?'随机模拟考试仅抽取完整且已核对的题目。':'练习只纳入答案、选项完整的题目；全部核对后开放考试模式。'}<button class="soft" data-go="issues">查看问题清单</button></div>`:''}<p class="small muted">来源：${m.sources.map(esc).join('、')}</p></div>`;
}
function items(){
  const xs=view.module.studyItems||[];
  if(!view.filter)return xs;
  return view.filter.map(id=>questionIndex.get(id)).filter(q=>q?.moduleId===view.module.id&&(view.module.category==='last30'||q.valid));
}
function beginRandomExam(e){
  e.preventDefault();
  const count=Number(new FormData(e.currentTarget).get('count')),pool=examPool(view.module);
  if(!Number.isInteger(count)||count<10||count>30||count>pool.length){root.querySelector('#random-exam-error').textContent='请选择10–30题，且不能超过当前可抽题量。';return}
  const key=view.module.id+':exam';
  if(db.sessions[key]?.random&&!confirm('重新抽题将替换这场未完成考试，确定继续？'))return;
  // Fisher–Yates: sample without replacement and keep the sampled order.
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  const questionIds=pool.slice(0,count).map(q=>q.id);
  db.sessions[key]={index:0,answers:{},submitted:{},questionIds,random:true};
  view.examNavOpen=null;
  save();start('exam');
}
function sessionKey(){return view.module.id+':'+view.mode}
function start(mode,idx=0,filter=null,parent='module'){
  view.mode=mode;const session=db.sessions[view.module.id+':'+mode];
  view.filter=filter||(mode==='exam'?session?.questionIds:null)||null;
  view.review=false;view.studyParent=parent;
  view.index=Math.max(0,Math.min(items().length-1,filter?idx:(session?.index??idx)));
  return navigate('study');
}
function examNavigator(xs, sess) {
  const answered=xs.filter(q=>sess.answers[q.id]?.length).length;
  const open=view.examNavOpen??window.matchMedia('(min-width: 960px)').matches;
  return `<aside class="exam-nav"><details ${open?'open':''} id="exam-navigator"><summary><span>答题卡 · 选择题号</span><small>已答 ${answered} / ${xs.length}</small></summary><div class="exam-nav-body"><p class="nav-legend"><span>未答</span><span class="legend-answered">已答</span><span class="legend-current">当前题</span></p><div class="question-grid" role="navigation" aria-label="考试题号">${xs.map((q,i)=>`<button class="question-number ${sess.answers[q.id]?.length?'answered':''} ${i===view.index?'current':''}" data-exam-index="${i}" aria-label="第${i+1}题，${sess.answers[q.id]?.length?'已答':'未答'}" ${i===view.index?'aria-current="step"':''} title="${esc(q.section)} · 原题号 ${q.number}">${i+1}</button>`).join('')}</div><p class="small muted">按整卷顺序编号，点击可跳转，答案自动保存。</p></div></details></aside>`;
}
function moveToQuestion(index) {
  if(!Number.isInteger(index)||index<0||index>=items().length)return;
  view.index=index;
  const key=sessionKey();
  db.sessions[key]={...(db.sessions[key]||{answers:{},submitted:{}}),index};
  save();render();
  root.querySelector('.question-title')?.focus({preventScroll:true});
  root.querySelector('.study-main')?.scrollIntoView({block:'start'});
}
function notePanel(id){return `<div class="note-panel"><label for="note-input">我的备注</label><textarea id="note-input" data-note="${id}" rows="3" placeholder="记录这道题的思路、易错点…">${esc(db.notes[id]||'')}</textarea><div class="small muted note-status" id="note-status" role="status" aria-live="polite">${db.notes[id]?'已保存（可在收藏/错题中查看）':'输入后自动保存'}</div></div>`}
function study() {
  const m=view.module,xs=items(),x=xs[view.index];
  if(!x)return `<div class="panel empty">暂无可学习内容。<button class="soft" data-go="module">返回</button></div>`;
  const sess=db.sessions[sessionKey()]||{index:view.index,answers:{},submitted:{}};
  const selected=sess.answers[x.id]||[],show=view.mode==='review'||view.mode==='cards'||view.review||!!sess.submitted[x.id];
  const options=Object.entries(x.options||{}).map(([letter,value])=>`<button class="option ${selected.includes(letter)?'sel':''} ${show&&x.answer.includes(letter)?'correct':''} ${show&&selected.includes(letter)&&!x.answer.includes(letter)?'wrong':''}" data-option="${letter}" aria-pressed="${selected.includes(letter)}" ${show?'disabled':''}><b>${letter}</b><span>${fmt(value)}</span></button>`).join('');
  let cardsBody='';
  if(view.mode==='cards'){
    const t=(x.title||'').trim(),raw=x.content||'';
    const firstLine=raw.trim().split('\n')[0].trim();
    const exactDup=!!t&&firstLine===t;
    const partDup=!!t&&!exactDup&&firstLine.startsWith(t);
    let display=exactDup?(raw.includes('\n')?raw.slice(raw.indexOf('\n')+1):''):raw;
    display=display.replace(/([^\n])（(?=[0-9一二三四五六七八九十]{1,3}）)/g,'$1\n（');
    const heading=t&&!exactDup&&!partDup?`<div class="question-title" tabindex="-1">${esc(t)}</div>`:'';
    cardsBody=`${heading}<div class="content cards-content">${fmt(display)}</div><div class="toolbar"><button class="${db.read[x.id]?'soft':'primary'}" data-read="${x.id}">${db.read[x.id]?'✓ 已读':'标记已读'}</button></div>`;
  }
  return `<div class="toolbar study-toolbar"><button class="soft" data-go="${view.studyParent}">← ${view.studyParent==='favorites'?'返回收藏':view.studyParent==='wrong'?'返回错题':'返回模块'}</button><span class="pill">${view.mode==='practice'?'练习':view.mode==='review'?'背题':view.mode==='exam'?'考试':'背诵卡片'} · ${view.index+1}/${xs.length}</span><span class="spacer"></span><button class="soft" data-fav="${x.id}">${db.favorites[x.id]?'★ 已收藏':'☆ 收藏'}</button>${view.mode!=='cards'?`<button class="soft" data-edit="${x.id}">纠错</button>`:''}</div>
  <div class="study-layout ${view.mode==='exam'?'with-navigator':''}">${view.mode==='exam'?examNavigator(xs,sess):''}<div class="study-main">
  <div class="panel question-panel"><div class="sub source-meta">${esc(x.section||'')}${x.points!=null?' · '+x.points+' 分':''} · 来源 ${esc(x.source)}:${x.line}</div>
  ${x.passage?`<div class="passage">${fmt(x.passage)}</div>`:''}
  ${view.mode==='cards'?cardsBody:`<div class="question-kind">${x.type==='multiple'?'多选题':'单选题'}</div><div class="question-title" tabindex="-1">${view.mode==='exam'&&sess.random?view.index+1:x.number}. ${fmt(x.stem)}</div>${options}
  ${view.mode==='practice'&&!show?`<button class="primary" data-submit="1" ${selected.length?'':'disabled'}>提交答案</button>`:''}
  ${view.mode==='review'?`<button class="${db.read[x.id]?'soft':'primary'}" data-read="${x.id}">${db.read[x.id]?'✓ 已读':'标记已读'}</button>`:''}
  ${view.mode==='practice'&&sess.submitted[x.id]?`<button class="soft" data-retry="${x.id}">重新作答</button>`:''}
  ${show?`<div class="answer"><b>答案：${x.answer.join('')}</b>${sess.submitted[x.id]?` · ${sess.submitted[x.id].correct?'回答正确':'回答错误'}`:''}<div>${fmt(x.explanation||'暂无解析')}</div></div>`:''}`}</div>
  ${notePanel(x.id)}
  <div class="footer-actions study-actions"><button class="soft" data-prev="1" ${view.index===0?'disabled':''}>← 上一题</button><span class="muted">${view.mode==='exam'?'已答 '+xs.filter(q=>sess.answers[q.id]?.length).length+'/'+xs.length:''}</span>${view.mode==='exam'?`<button class="primary finish-exam" data-finish="1">交卷</button>`:''}<button class="primary" data-next="1" ${view.index===xs.length-1?'disabled':''}>下一题 →</button></div>
  </div></div>`;
}
function backBar(){
  if(['favorites','wrong','issues','stats','loading','loadError'].includes(view.page))return '<div class="toolbar back-toolbar"><button class="soft" data-go="home">← 返回题库</button></div>';
  return '';
}
function listPage(){
  const ids=view.page==='favorites'?Object.keys(db.favorites).filter(id=>db.favorites[id]):wrongIds();
  const xs=ids.map(byid).filter(Boolean),pages=Math.max(1,Math.ceil(xs.length/30));
  view.listPage=Math.min(view.listPage,pages-1);
  const visible=xs.slice(view.listPage*30,view.listPage*30+30);
  return `<div class="section-head"><h2>${view.page==='favorites'?'我的收藏':'错题本'} · ${xs.length}</h2></div><div class="panel">${visible.length?visible.map(x=>`<div class="row"><div><b>${esc(x.title||x.stem.slice(0,70))}</b><div class="small muted">${esc(x.moduleTitle)} · ${esc(x.section||'')}</div>${db.notes[x.id]?`<div class="note-preview">备注：${esc(db.notes[x.id])}</div>`:''}</div><button data-jump="${x.id}">查看 →</button></div>`).join(''):'<div class="empty">这里还没有内容</div>'}</div>${pages>1?`<div class="toolbar list-pagination"><button class="soft" data-list-page="${view.listPage-1}" ${view.listPage===0?'disabled':''}>上一页</button><span>${view.listPage+1}/${pages}</span><button class="soft" data-list-page="${view.listPage+1}" ${view.listPage===pages-1?'disabled':''}>下一页</button></div>`:''}`;
}
function issuesPage(){let groups=issueGroups(),open=groups.filter(g=>!db.reviewed[g.id]),shown=view.issueFilter==='open'?open:groups;return `<div class="section-head"><h2>题目数据问题 · ${groups.length} 道题</h2></div><p class="muted">共 ${report.issues.length} 条问题。每题显示原文位置和问题类型；修正保存在本机，原始 Markdown 不会被改动。</p><div class="toolbar"><button class="${view.issueFilter==='open'?'primary':'soft'}" data-issue-filter="open">待处理 ${open.length}</button><button class="${view.issueFilter==='all'?'primary':'soft'}" data-issue-filter="all">全部 ${groups.length}</button></div><div class="panel">${shown.length?shown.map((g,n)=>{let q=g.question;return `<div class="issue-row"><div class="issue-main"><div class="small muted">${n+1}. ${esc(q.moduleTitle)} · ${esc(q.source)}:${q.line}</div><strong>${esc((q.stem||'（题干缺失）').replace(/\s+/g,' ').slice(0,150))}</strong>${q.knownAnswerText?`<p class="small">已知答案：${esc(q.knownAnswerText)}</p>`:''}<div class="toolbar">${[...new Set(g.issues.map(i=>i.code))].map(code=>`<span class="badge issue-badge">${esc(issueLabels[code]||code)}</span>`).join('')}${db.reviewed[g.id]?'<span class="badge resolved">已核对</span>':''}</div></div><button class="primary" data-edit="${g.id}">${db.reviewed[g.id]?'查看修正':'纠错编辑'} →</button></div>`}).join(''):'<div class="empty">所有题目都已处理</div>'}</div>`}
function editPage(){let x=byid(view.editId);if(!x)return '<div class="panel">题目不存在</div>';let issues=report.issues.filter(i=>i.questionId===x.id);return `<div class="toolbar"><button class="soft" data-go="${view.returnPage}">← ${view.returnPage==='study'?'返回题目':'问题清单'}</button></div><div class="panel"><h2>纠错编辑 · ${esc(x.moduleTitle)} 第 ${x.number} 题</h2><p class="small muted">来源：${esc(x.source)}:${x.line} · 题目 ID：${x.id}</p>${issues.length?`<div class="warning">原始问题：${[...new Set(issues.map(i=>issueLabels[i.code]||i.code))].join('、')}</div>`:''}${x.knownAnswerText?`<p>已知答案：${esc(x.knownAnswerText)}</p>`:''}${x.correctionNote?`<p class="small muted">校对说明：${esc(x.correctionNote)}</p>`:''}<form id="correction-form"><label>题干<textarea name="stem" rows="6" required>${esc(x.stem)}</textarea></label><label>阅读材料／配图（如有）<textarea name="passage" rows="4">${esc(x.passage||'')}</textarea></label><div class="option-grid">${'ABCDE'.split('').map(a=>`<label>选项 ${a}<textarea name="option-${a}" rows="2">${esc(x.options?.[a]||'')}</textarea></label>`).join('')}</div><label>题型<select name="type"><option value="single" ${x.type==='single'?'selected':''}>单选</option><option value="multiple" ${x.type==='multiple'?'selected':''}>多选</option><option value="boolean" ${x.type==='boolean'?'selected':''}>判断</option></select></label><label>正确答案（如 B 或 ACD）<input name="answer" value="${esc((x.answer||[]).join(''))}" maxlength="5" required></label><label>解析<textarea name="explanation" rows="7">${esc(x.explanation||'')}</textarea></label><div id="form-error" class="error" role="alert"></div><div class="toolbar"><button class="primary" type="submit">保存并核对</button>${db.corrections[x.id]?`<button class="soft" type="button" data-reset-correction="${x.id}">恢复导入内容</button>`:''}</div></form>${notePanel(x.id)}</div>`}
function stats(){let h=db.attempts,right=h.filter(x=>x.correct).length;return `<div class="section-head"><h2>学习统计</h2></div><div class="stats"><div class="stat"><strong>${new Set(h.map(x=>x.id)).size}</strong><span>已做题目</span></div><div class="stat"><strong>${h.length}</strong><span>总作答次数</span></div><div class="stat"><strong>${right}</strong><span>正确次数</span></div><div class="stat"><strong>${h.length?Math.round(right/h.length*100):0}%</strong><span>历次作答正确率</span></div></div><div class="panel"><h2>各子模块</h2>${bank.map(m=>{let a=history(m),r=a.filter(x=>x.correct).length;return `<div class="row"><span>${esc(m.title)}</span><span class="small muted">${m.category==='last30'?`已读 ${completed(m)}/${m.count}`:`已做 ${completed(m)}/${m.validCount} · 作答 ${a.length} 次 · 正确 ${r} 次 · ${a.length?Math.round(r/a.length*100):0}%`}</span></div>`}).join('')}</div><div class="panel" style="margin-top:16px"><h2>数据备份</h2><p class="muted">数据保存在当前浏览器。更换设备时，先导出，再在新设备导入。</p><div class="toolbar"><button class="primary" data-export="1">导出备份</button><button class="soft" data-import="1">导入备份</button><input class="file" id="import-file" type="file" accept="application/json"></div></div>`}
function bind(){root.querySelector('[data-retry-load]')?.addEventListener('click',()=>retryNavigation?.());root.querySelectorAll('[data-note]').forEach(t=>t.addEventListener('input',()=>{clearTimeout(noteTimer);pendingNote={id:t.dataset.note,value:t.value};root.querySelector('#note-status').textContent='正在保存…';noteTimer=setTimeout(()=>commitNote(root.querySelector('#note-status')),500)}));root.querySelectorAll('[data-list-page]').forEach(b=>b.onclick=()=>{view.listPage=Number(b.dataset.listPage);render()});root.querySelector('#random-exam-form')?.addEventListener('submit',beginRandomExam);root.querySelector('[data-resume-exam]')?.addEventListener('click',()=>start('exam'));root.querySelectorAll('[data-issue-filter]').forEach(b=>b.onclick=()=>{view.issueFilter=b.dataset.issueFilter;render()});root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{view.editId=b.dataset.edit;view.returnPage=view.page;navigate('edit')});root.querySelector('#correction-form')?.addEventListener('submit',saveCorrection);root.querySelector('[data-reset-correction]')?.addEventListener('click',resetCorrection);root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));root.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>navigate('category',{category:b.dataset.cat}));root.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>navigate('module',{module:bank.find(m=>m.id===b.dataset.module)}));root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>start(b.dataset.mode));root.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>{db.favorites[b.dataset.fav]=!db.favorites[b.dataset.fav];save();render()});root.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>{db.read[b.dataset.read]=!db.read[b.dataset.read];save();render()});root.querySelectorAll('[data-option]').forEach(b=>b.onclick=()=>{let x=items()[view.index],key=sessionKey(),s=db.sessions[key]||{index:view.index,answers:{},submitted:{}};let v=s.answers[x.id]||[],l=b.dataset.option;s.answers[x.id]=x.type==='multiple'?(v.includes(l)?v.filter(a=>a!==l):[...v,l].sort()):[l];db.sessions[key]=s;save();render()});root.querySelectorAll('[data-submit]').forEach(b=>b.onclick=()=>{let x=items()[view.index],s=db.sessions[sessionKey()],answer=s.answers[x.id]||[],correct=answer.join('')===x.answer.slice().sort().join('');s.submitted[x.id]={correct};db.attempts.push({id:x.id,correct,selected:answer,time:new Date().toISOString(),mode:'practice'});save();render()});root.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>{let s=db.sessions[sessionKey()];delete s.answers[b.dataset.retry];delete s.submitted[b.dataset.retry];save();render()});root.querySelectorAll('[data-prev],[data-next]').forEach(b=>b.onclick=()=>moveToQuestion(view.index+(b.dataset.next?1:-1)));root.querySelectorAll('[data-exam-index]').forEach(b=>b.onclick=()=>moveToQuestion(Number(b.dataset.examIndex)));root.querySelector('#exam-navigator')?.addEventListener('toggle',e=>{view.examNavOpen=e.currentTarget.open});root.querySelectorAll('[data-finish]').forEach(b=>b.onclick=finishExam);root.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{let parent=view.page,x=byid(b.dataset.jump);view.module=bank.find(m=>m.id===x.moduleId);let xs=view.module.items.filter(y=>y.valid||view.module.category==='last30');view.index=xs.findIndex(y=>y.id===x.id);start(view.module.category==='last30'?'cards':'review',Math.max(0,view.index),xs.map(y=>y.id),parent)});root.querySelector('[data-export]')?.addEventListener('click',exportData);root.querySelector('[data-import]')?.addEventListener('click',()=>document.querySelector('#import-file').click());root.querySelector('#import-file')?.addEventListener('change',importData)}
function finishExam(){let xs=items(),key=sessionKey(),s=db.sessions[key]||{answers:{}};if(!confirm(`确定交卷？当前已作答 ${Object.values(s.answers).filter(x=>x?.length).length}/${xs.length} 题。`))return;let correct=0,earned=0,total=0;for(let x of xs){let a=s.answers[x.id]||[],ok=a.length>0&&a.slice().sort().join('')===x.answer.slice().sort().join('');db.attempts.push({id:x.id,correct:ok,selected:a,time:new Date().toISOString(),mode:'exam'});const points=s.random?1:(x.points??1);if(ok){correct++;earned+=points}total+=points}db.sessions[view.module.id+':review']={index:0,answers:s.answers,questionIds:xs.map(q=>q.id),submitted:Object.fromEntries(xs.map(x=>[x.id,{correct:(s.answers[x.id]||[]).length>0&&(s.answers[x.id]||[]).slice().sort().join('')===x.answer.slice().sort().join('')}]))};delete db.sessions[key];save();alert(`已交卷：答对 ${correct}/${xs.length} 题，得分 ${earned}/${total}。现在进入答案复盘。`);view.filter=xs.map(q=>q.id);view.mode='review';view.index=0;view.review=true;render()}
function restoreBase(){questionIndex.clear();for(const m of bank)if(baseBank.has(m.id)){m.items=structuredClone(baseBank.get(m.id));indexModule(m)}}
function saveCorrection(e){e.preventDefault();let f=new FormData(e.currentTarget),id=view.editId,x=byid(id),options={};for(let a of 'ABCDE'){let value=String(f.get('option-'+a)||'').trim();if(value)options[a]=value}let answer=String(f.get('answer')||'').toUpperCase().replace(/[\s,，、]/g,'').split('');let draft={stem:String(f.get('stem')||'').trim(),passage:String(f.get('passage')||'').trim(),options,type:String(f.get('type')),answer,explanation:String(f.get('explanation')||'').trim()};let error='';if(!validQuestion(draft))error='请填写题干、至少两个选项，并确保答案字母对应已有选项。';else if(new Set(answer).size!==answer.length)error='答案字母不能重复。';else if(draft.type!=='multiple'&&answer.length!==1)error='单选或判断题只能有一个正确答案。';if(error){document.querySelector('#form-error').textContent=error;return}db.corrections[id]=draft;db.reviewed[id]=true;Object.assign(x,draft,{valid:true});indexModule(questionModule.get(id));try{save()}catch(err){document.querySelector('#form-error').textContent='保存失败：浏览器存储空间不足，请先导出备份。';return}navigate(view.returnPage==='study'?'study':'issues')}
function resetCorrection(){let id=view.editId;if(!confirm('恢复导入内容，并将这题重新列为待纠错？'))return;delete db.corrections[id];delete db.reviewed[id];restoreBase();applyCorrections();save();render()}
function exportData(){commitNote();let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`金监题库备份-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function importData(e){try{let x=JSON.parse(await e.target.files[0].text());if(x.version!==1||!Array.isArray(x.attempts)||typeof x.favorites!=='object'||typeof x.read!=='object'||typeof x.sessions!=='object')throw Error('备份格式不正确');if(!confirm('导入会覆盖当前浏览器的学习记录，确定继续？'))return;db={...load(),...x,corrections:x.corrections||{},reviewed:x.reviewed||{},notes:normalizeNotes(x.notes)};restoreBase();applyCorrections();save();render()}catch(err){alert(err.message)}}
async function initialize(){
  try{
    const data=await jsonFetch('data/catalogue.json',{cache:'no-cache'});
    bank=data.modules.map(m=>({...m,items:[],loaded:false}));report={issues:data.issues};
    issueIds=new Set(report.issues.map(i=>i.questionId));
    questionModule.clear();for(const m of bank)for(const id of m.questionIds)questionModule.set(id,m);
    metricCache=null;view.page='home';render();
  }catch(error){view.page='loadError';view.loadError='题库目录加载失败。请检查网络后重试。';retryNavigation=initialize;render()}
}
initialize();
