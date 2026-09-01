import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays,
  Car, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3,
  Download, FileCheck2, FileImage, FileText, Filter, Gauge, LayoutDashboard,
  ListFilter, Menu, MoreHorizontal, Paperclip, Plus, Search,
  Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, UploadCloud,
  UsersRound, X,
} from 'lucide-react'
import { listClaims, registerAndAnalyze, type ApiClaim, type ClaimRegistration } from './api/claims'

type View = 'dashboard' | 'cases' | 'reports' | 'new' | 'detail'
type Risk = 'Alto' | 'Medio' | 'Bajo'

type Claim = {
  id: string
  insured: string
  vehicle: string
  plate: string
  date: string
  risk: Risk
  score: number
  status: string
  reason: string
  policyNumber: string
  occurredAt: string
  location: string
  description: string
  recommendation: string
  confidence: number
  findings: { title:string; detail:string; impact:number; evidence:string }[]
  evidence: { name:string; contentType:string; size:number; status?:string }[]
  createdAt: string
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="brand" aria-label="Ficohsa Seguros">
    <div className="brand-mark"><span /><span /><span /><span /></div>
    {!compact && <div><strong>Ficohsa</strong><small>SEGUROS</small></div>}
  </div>
}

function RiskPill({ risk, score }: { risk: Risk, score?: number }) {
  return <span className={`risk risk-${risk.toLowerCase()}`}><i /> {risk}{score !== undefined && ` · ${score}`}</span>
}

function Sidebar({ view, setView, open, close, claimCount }: { view: View, setView: (v: View) => void, open: boolean, close: () => void, claimCount:number }) {
  const go = (v: View) => { setView(v); close() }
  return <>
    <div className={`mobile-scrim ${open ? 'show' : ''}`} onClick={close} />
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-logo"><Logo /><button className="icon-btn mobile-only" onClick={close} aria-label="Cerrar menú"><X size={20}/></button></div>
      <div className="product-name"><ShieldCheck size={17}/><span>Gestión de Siniestros</span></div>
      <nav>
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => go('dashboard')}><LayoutDashboard/>Resumen</button>
        <button className={view === 'cases' || view === 'detail' ? 'active' : ''} onClick={() => go('cases')}><FileText/>Siniestros <b>{claimCount}</b></button>
        <button onClick={() => go('new')}><Sparkles/>Nuevo análisis</button>
        <button className={view === 'reports' ? 'active' : ''} onClick={() => go('reports')}><BarChart3/>Reportes</button>
        <span className="nav-label">GESTIÓN</span>
        <button disabled title="Requiere el servicio de gestión de investigadores"><UsersRound/>Investigadores</button>
        <button disabled title="Requiere el servicio de reglas de negocio"><ListFilter/>Reglas de negocio</button>
        <button disabled title="Requiere el servicio de auditoría"><Activity/>Registro de actividad</button>
      </nav>
      <div className="sidebar-bottom">
        <button disabled title="Módulo aún no conectado"><CircleHelp/>Centro de ayuda</button>
        <button disabled title="Módulo aún no conectado"><Settings/>Configuración</button>
        <div className="user-card"><div className="avatar">LM</div><div><strong>Laura Mejía</strong><small>Analista Sr.</small></div><MoreHorizontal size={18}/></div>
      </div>
    </aside>
  </>
}

function Topbar({ title, onMenu }: { title: string, onMenu: () => void }) {
  return <header className="topbar">
    <div className="top-title"><button className="icon-btn mobile-only" onClick={onMenu} aria-label="Abrir menú"><Menu/></button><div><span>Ficohsa Seguros Honduras</span><h2>{title}</h2></div></div>
    <div className="top-actions"><button className="icon-btn notification" disabled aria-label="Notificaciones no conectadas" title="Módulo aún no conectado"><Bell/><i/></button><button className="help" disabled title="Módulo aún no conectado"><CircleHelp/>Ayuda</button></div>
  </header>
}

function MetricCard({ label, value, note, icon, tone }: { label: string, value: string, note: string, icon: React.ReactNode, tone: string }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}>{icon}</div>
    <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </article>
}

function EmptyState({ title, text, action }: { title:string; text:string; action?:React.ReactNode }) {
  return <div className="empty-state"><FileText/><strong>{title}</strong><p>{text}</p>{action}</div>
}

function claimAnalytics(items:Claim[]) {
  const completed=items.filter(item=>item.status==='Analizado')
  const high=items.filter(item=>item.risk==='Alto').length
  const medium=items.filter(item=>item.risk==='Medio').length
  const low=items.filter(item=>item.risk==='Bajo').length
  const pending=items.length-completed.length
  const months=Array.from({length:6},(_,index)=>{const date=new Date();date.setDate(1);date.setMonth(date.getMonth()-(5-index));return date})
  const monthly=months.map(date=>{const month=date.getMonth(),year=date.getFullYear();const matches=items.filter(item=>{const d=new Date(item.createdAt);return d.getMonth()===month&&d.getFullYear()===year});return {m:date.toLocaleDateString('es-HN',{month:'short'}).replace('.',''),total:matches.length,suspicious:matches.filter(item=>item.risk==='Alto').length}})
  const max=Math.max(1,...monthly.map(item=>item.total))
  return {completed,high,medium,low,pending,monthly:monthly.map(item=>({...item,totalHeight:item.total/max*100,suspiciousHeight:item.suspicious/max*100}))}
}

function Dashboard({ setView, openClaim, items, loading, error, retry }: { setView: (v: View) => void, openClaim: (c: Claim) => void, items: Claim[], loading:boolean, error:string, retry:()=>void }) {
  const stats=claimAnalytics(items)
  return <div className="page dashboard-page">
    <section className="welcome-row"><div><h1>Buenos días, Laura</h1><p>Este es el estado de los siniestros y alertas de fraude hoy.</p></div><button className="primary" onClick={() => setView('new')}><Plus/>Nuevo análisis</button></section>
    <section className="metrics-grid">
      <MetricCard label="Siniestros registrados" value={String(items.length)} note="Total disponible en el sistema" icon={<FileCheck2/>} tone="blue"/>
      <MetricCard label="Riesgo alto" value={String(stats.high)} note="Requieren atención prioritaria" icon={<ShieldAlert/>} tone="red"/>
      <MetricCard label="Análisis completados" value={String(stats.completed.length)} note="Procesados por el motor" icon={<CheckCircle2/>} tone="green"/>
      <MetricCard label="En proceso" value={String(stats.pending)} note="Pendientes o con error" icon={<Clock3/>} tone="amber"/>
    </section>
    <section className="dashboard-grid">
      <article className="panel trend-panel">
        <div className="panel-head"><div><h3>Tendencia de siniestros</h3><p>Comportamiento de los últimos 6 meses</p></div><span className="select-btn"><CalendarDays/>Últimos 6 meses</span></div>
        <div className="chart-legend"><span><i className="blue-dot"/>Analizados</span><span><i className="red-dot"/>Sospechosos</span></div>
        <div className="bar-chart">
          {stats.monthly.map(x => <div className="bar-group" key={x.m}><div className="bars"><div className="bar total" title={`${x.total} registrados`} style={{height: `${x.totalHeight}%`}}/><div className="bar suspicious" title={`${x.suspicious} de riesgo alto`} style={{height: `${x.suspiciousHeight}%`}}/></div><span>{x.m}</span></div>)}
        </div>
      </article>
      <article className="panel risk-panel">
        <div className="panel-head"><div><h3>Distribución de riesgo</h3><p>Todos los siniestros disponibles</p></div></div>
        <div className="donut-row"><div className="donut" style={{background:`conic-gradient(#e83e49 0 ${items.length?stats.high/items.length*100:0}%,#efb04a 0 ${items.length?(stats.high+stats.medium)/items.length*100:0}%,#2fac82 0)`}}><div><strong>{items.length}</strong><span>Total casos</span></div></div>
          <div className="risk-legend"><div><i className="high"/><span>Riesgo alto<small>Requiere investigación</small></span><strong>{stats.high}</strong></div><div><i className="medium"/><span>Riesgo medio<small>Revisión manual</small></span><strong>{stats.medium}</strong></div><div><i className="low"/><span>Riesgo bajo<small>Monitoreo</small></span><strong>{stats.low}</strong></div></div>
        </div>
      </article>
    </section>
    <section className="panel cases-panel">
      <div className="panel-head"><div><h3>Siniestros recientes</h3><p>Últimos casos evaluados por el motor de análisis</p></div><button className="text-btn" onClick={() => setView('cases')}>Ver todos <ArrowRight/></button></div>
      {loading ? <div className="loading-state"><span className="spinner dark"/>Cargando siniestros...</div> : error ? <EmptyState title="No se pudieron cargar los siniestros" text={error} action={<button className="secondary" onClick={retry}>Reintentar</button>}/> : items.length ? <ClaimsTable data={items.slice(0, 5)} openClaim={openClaim}/> : <EmptyState title="Aún no hay siniestros" text="Registra el primer expediente para comenzar el análisis." action={<button className="primary" onClick={()=>setView('new')}><Plus/>Nuevo análisis</button>}/>}
    </section>
  </div>
}

function ClaimsTable({ data, openClaim }: { data: Claim[], openClaim: (c: Claim) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>SINIESTRO</th><th>ASEGURADO / VEHÍCULO</th><th>FECHA</th><th>NIVEL DE RIESGO</th><th>ESTADO</th><th /></tr></thead><tbody>
    {data.map(c => <tr key={c.id} onClick={() => openClaim(c)}><td><strong>{c.id}</strong><small>{c.plate}</small></td><td><strong>{c.insured}</strong><small>{c.vehicle}</small></td><td>{c.date}</td><td><RiskPill risk={c.risk} score={c.score}/></td><td><span className="status">{c.status}</span></td><td><button className="icon-btn" aria-label={`Abrir ${c.id}`}><ChevronRight/></button></td></tr>)}
  </tbody></table></div>
}

function Cases({ openClaim, setView, items, loading, error, retry }: { openClaim: (c: Claim) => void, setView: (v: View) => void, items: Claim[], loading:boolean, error:string, retry:()=>void }) {
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState('Todos')
  const [status,setStatus]=useState('Todos')
  const [showMore,setShowMore]=useState(false)
  const statuses=useMemo(()=>Array.from(new Set(items.map(item=>item.status))),[items])
  const filtered = useMemo(() => items.filter(c => (risk === 'Todos' || c.risk === risk) && (status==='Todos'||c.status===status) && `${c.id} ${c.insured} ${c.plate} ${c.vehicle} ${c.reason}`.toLowerCase().includes(query.toLowerCase())), [items, query, risk,status])
  return <div className="page"><section className="welcome-row"><div><h1>Siniestros</h1><p>Consulta, analiza y da seguimiento a todos los casos.</p></div><button className="primary" onClick={() => setView('new')}><Plus/>Nuevo análisis</button></section>
    <section className="panel cases-panel full-list"><div className="filterbar"><div className="searchbox"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por siniestro, asegurado o placa..."/></div><div className="risk-filters">{['Todos','Alto','Medio','Bajo'].map(x => <button className={risk === x ? 'active' : ''} onClick={() => setRisk(x)} key={x}>{x}</button>)}</div><button className={`select-btn ${showMore?'active':''}`} onClick={()=>setShowMore(!showMore)}><Filter/>Más filtros</button></div>
      {showMore&&<div className="advanced-filters"><label>Estado<select value={status} onChange={event=>setStatus(event.target.value)}><option>Todos</option>{statuses.map(value=><option key={value}>{value}</option>)}</select></label><button className="text-btn" onClick={()=>{setQuery('');setRisk('Todos');setStatus('Todos')}}>Limpiar filtros</button></div>}
      <div className="result-count">{filtered.length} de {items.length} siniestros</div>{loading?<div className="loading-state"><span className="spinner dark"/>Cargando siniestros...</div>:error?<EmptyState title="No se pudieron cargar los siniestros" text={error} action={<button className="secondary" onClick={retry}>Reintentar</button>}/>:filtered.length?<ClaimsTable data={filtered} openClaim={openClaim}/>:<EmptyState title="Sin resultados" text="Ajusta los filtros o registra un nuevo siniestro."/>}
    </section>
  </div>
}

function NewAnalysis({ onDone, onCancel }: { onDone: (claim: Claim) => void, onCancel: () => void }) {
  const [step, setStep] = useState(1)
  const [files, setFiles] = useState<File[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [policyValidated, setPolicyValidated] = useState(false)
  const [form, setForm] = useState<ClaimRegistration>({ policyNumber:'', occurredAt:'', insuredName:'', identityDocument:'', vehicle:'', plate:'', location:'', description:'' })
  const input = useRef<HTMLInputElement>(null)
  const field = (name: keyof ClaimRegistration) => ({ value:form[name], onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{ setForm({...form,[name]:event.target.value}); setError(''); if(name==='policyNumber')setPolicyValidated(false) } })
  const validatePolicy = () => {
    if(form.policyNumber.trim().length<5){setError('Ingresa un número de póliza válido');return}
    setPolicyValidated(true);setError('')
  }
  const next = async () => {
    if(step===1&&Object.values(form).some(value=>!value.trim())){setError('Completa todos los campos obligatorios para continuar');return}
    if (step < 3){setError('');setStep(step + 1)}
    else {
      setAnalyzing(true); setError('')
      try {
        const saved=await registerAndAnalyze(form,files)
        onDone(toClaim(saved))
      } catch (cause) { setError(cause instanceof Error?cause.message:'No fue posible registrar el siniestro'); setAnalyzing(false) }
    }
  }
  const addFiles = (list: FileList | null) => list && setFiles([...files, ...Array.from(list)].slice(0,10))
  return <div className="page form-page">
    <button className="back-link" onClick={onCancel}><ArrowLeft/>Volver a siniestros</button>
    <div className="form-title"><div><h1>Nuevo análisis de siniestro</h1><p>Ingresa la información para ejecutar las validaciones automáticas.</p></div><span>Nuevo registro</span></div>
    <div className="stepper">{['Información del siniestro','Documentos y evidencias','Revisión y análisis'].map((x,i) => <div className={step >= i+1 ? 'active' : ''} key={x}><span>{step > i+1 ? <Check/> : i+1}</span><b>{x}</b>{i < 2 && <i/>}</div>)}</div>
    <section className="panel form-panel">
      {step === 1 && <><div className="section-heading"><span><Car/></span><div><h3>Datos del siniestro</h3><p>Completa los campos obligatorios para identificar el caso.</p></div></div>
        <div className="form-grid"><label>Número de póliza *<div className="input-action"><input placeholder="Ej. AUT-HN-000001" {...field('policyNumber')}/><button type="button" onClick={validatePolicy}>Validar</button></div>{policyValidated&&<small className="valid"><CheckCircle2/>Formato válido para continuar</small>}</label><label>Fecha y hora del siniestro *<input type="datetime-local" {...field('occurredAt')}/></label><label>Nombre del asegurado *<input placeholder="Nombre completo" {...field('insuredName')}/></label><label>Documento de identidad *<input placeholder="Documento del asegurado" {...field('identityDocument')}/></label><label>Vehículo *<input placeholder="Marca, modelo y año" {...field('vehicle')}/></label><label>Placa *<input placeholder="Ej. HAB 4821" {...field('plate')}/></label><label className="wide">Lugar del siniestro *<input placeholder="Ciudad y ubicación del accidente" {...field('location')}/></label><label className="wide">Descripción del accidente *<textarea placeholder="Describe cómo ocurrió el accidente" maxLength={2000} {...field('description')}/><small className="counter">{form.description.length} / 2000</small></label></div></>}
      {step === 2 && <><div className="section-heading"><span><Paperclip/></span><div><h3>Documentos y evidencias</h3><p>Adjunta los soportes. El sistema aplicará OCR y validaciones de integridad.</p></div></div>
        <input hidden multiple type="file" accept="application/pdf,image/jpeg,image/png,image/tiff" ref={input} onChange={e => addFiles(e.target.files)}/><button className="upload-zone" onClick={() => input.current?.click()}><UploadCloud/><strong>Arrastra los archivos o haz clic para buscar</strong><span>PDF, JPG, PNG o TIFF · Máximo 4 MB por archivo</span></button>
        <div className="file-list"><h4>Archivos cargados <span>{files.length}</span></h4>{files.map((f,i) => <div className="file" key={`${f.name}-${i}`}><span className={f.type==='application/pdf' ? 'pdf' : 'image'}>{f.type==='application/pdf' ? <FileText/> : <FileImage/>}</span><div><strong>{f.name}</strong><small>{(f.size/1024/1024).toFixed(1)} MB · Listo para carga segura</small></div><CheckCircle2 className="file-check"/><button className="icon-btn" onClick={() => setFiles(files.filter((_,n) => n !== i))}><X/></button></div>)}</div>
        <div className="doc-tip"><Sparkles/><div><strong>Recomendación del asistente</strong><p>Incluye declaración del conductor, licencia, identidad, informe policial y fotografías de todos los ángulos.</p></div></div></>}
      {step === 3 && <><div className="section-heading"><span><ShieldCheck/></span><div><h3>Revisa antes de analizar</h3><p>El motor evaluará 24 reglas, documentos e imágenes adjuntas.</p></div></div>
        <div className="review-grid"><div><small>PÓLIZA</small><strong>{form.policyNumber}</strong></div><div><small>ASEGURADO</small><strong>{form.insuredName}</strong></div><div><small>VEHÍCULO</small><strong>{form.vehicle} · {form.plate}</strong></div><div><small>FECHA</small><strong>{new Date(form.occurredAt).toLocaleString('es-HN')}</strong></div></div>
        <div className="analysis-scope"><h4>El análisis incluirá</h4><div><span><FileCheck2/>OCR y consistencia documental</span><span><FileImage/>Análisis visual de daños</span><span><ShieldAlert/>Scoring de fraude</span><span><Search/>Duplicidad y patrones</span></div></div>
        <label className="consent"><input type="checkbox" defaultChecked/><span><b>Confirmo que la información está completa</b><small>La ejecución quedará registrada en la bitácora de auditoría.</small></span></label></>}
      {error && <div className="form-error" role="alert"><AlertTriangle/>{error}</div>}
      <div className="form-actions"><button className="secondary" disabled={step === 1||analyzing} onClick={() => setStep(step-1)}><ArrowLeft/>Anterior</button><button className="primary" onClick={next} disabled={analyzing}>{analyzing ? <><span className="spinner"/>Registrando y analizando...</> : step === 3 ? <><Sparkles/>Iniciar análisis</> : <>Continuar<ArrowRight/></>}</button></div>
    </section>
  </div>
}

function downloadText(name:string,content:string,type='text/plain') { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();URL.revokeObjectURL(url) }

function ClaimDetail({ claim, back }: { claim: Claim, back: () => void }) {
  const riskCopy={Alto:['Alta probabilidad de irregularidad','El análisis encontró señales que requieren investigación antes de emitir una resolución.'],Medio:['El caso requiere revisión manual','El motor encontró señales que deben ser revisadas por un analista.'],Bajo:['Baja probabilidad de irregularidad','No se encontraron señales de riesgo relevantes con la información disponible.']}[claim.risk]
  const exportReport=()=>downloadText(`${claim.id}.txt`,[`Informe de siniestro ${claim.id}`,`Asegurado: ${claim.insured}`,`Vehículo: ${claim.vehicle} · ${claim.plate}`,`Riesgo: ${claim.risk} (${claim.score}/100)`,`Recomendación: ${claim.recommendation}`,`Resumen: ${claim.reason}`,'',...claim.findings.map((finding,index)=>`${index+1}. ${finding.title} (+${finding.impact}): ${finding.detail}`)].join('\n'))
  return <div className="page detail-page">
    <button className="back-link" onClick={back}><ArrowLeft/>Volver a siniestros</button>
    <section className="detail-title"><div><div className="eyebrow">SINIESTRO · {claim.date.toUpperCase()}</div><h1>{claim.id}</h1><p>{claim.insured} · {claim.vehicle} · {claim.plate}</p></div><div className="detail-actions"><button className="secondary" onClick={exportReport}><Download/>Exportar informe</button></div></section>
    <section className={`score-hero panel tone-${claim.risk.toLowerCase()}`}><div className="score-gauge"><svg viewBox="0 0 120 70"><path d="M15 60 A45 45 0 0 1 105 60"/><path className="fill" style={{strokeDasharray:`${claim.score*1.42} 142`}} d="M15 60 A45 45 0 0 1 105 60"/></svg><strong>{claim.score}</strong><span>/ 100</span></div><div className="score-copy"><RiskPill risk={claim.risk}/><h2>{riskCopy[0]}</h2><p>{claim.reason||riskCopy[1]}</p></div><div className="score-meta"><div><small>DECISIÓN SUGERIDA</small><strong><AlertTriangle/>{claim.recommendation}</strong></div><div><small>CONFIANZA DEL MODELO</small><strong>{claim.confidence?`${(claim.confidence*100).toFixed(1)}%`:'No informada'}</strong></div></div></section>
    <div className="detail-grid">
      <section className="panel findings"><div className="panel-head"><div><h3>Hallazgos principales</h3><p>Señales ordenadas por impacto en el score</p></div><span className="count-badge">{claim.findings.length} hallazgos</span></div>
        {claim.findings.length?claim.findings.map((finding,index)=><Finding key={`${finding.title}-${index}`} tone={finding.impact>=20?'red':'amber'} icon={finding.evidence.toLowerCase().includes('imagen')?<FileImage/>:<FileCheck2/>} title={finding.title} score={`+${finding.impact}`} text={finding.detail}/>):<EmptyState title="Sin hallazgos registrados" text="El análisis no devolvió señales explicables para este expediente."/>}
      </section>
      <aside className="detail-side">
        <section className="panel case-info"><div className="panel-head"><h3>Información del caso</h3></div><Info label="Póliza" value={claim.policyNumber}/><Info label="Fecha del evento" value={new Date(claim.occurredAt).toLocaleString('es-HN')}/><Info label="Ubicación" value={claim.location}/><Info label="Estado" value={claim.status}/></section>
        <section className="panel documents"><div className="panel-head"><h3>Evidencias</h3><span>{claim.evidence.length} archivos</span></div>{claim.evidence.length?claim.evidence.map((file,index)=><div key={`${file.name}-${index}`}>{file.contentType.startsWith('image/')?<FileImage/>:<FileText/>}<span><strong>{file.name}</strong><small>{(file.size/1024/1024).toFixed(1)} MB · {file.status||'Procesado'}</small></span></div>):<p className="empty-inline">No se adjuntaron evidencias.</p>}</section>
      </aside>
    </div>
    <section className="panel timeline"><div className="panel-head"><div><h3>Actividad del caso</h3><p>Trazabilidad disponible para el expediente</p></div></div><div className="timeline-list">{claim.status==='Analizado'&&<div><i className="done"><Check/></i><span><strong>Análisis automático completado</strong><small>Motor de riesgo</small></span></div>}{claim.evidence.length>0&&<div><i><UploadCloud/></i><span><strong>{claim.evidence.length} evidencias registradas</strong><small>Carga segura del expediente</small></span></div>}<div><i><Plus/></i><span><strong>Siniestro registrado</strong><small>{new Date(claim.createdAt).toLocaleString('es-HN')}</small></span></div></div></section>
  </div>
}

function Finding({ tone, icon, title, score, text }: { tone: string, icon: React.ReactNode, title: string, score: string, text: string }) {
  return <div className="finding"><span className={tone}>{icon}</span><div><div><strong>{title}</strong><b className={tone}>{score} pts</b></div><p>{text}</p></div></div>
}

function Info({label,value}:{label:string,value:string}) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div> }

function Reports({items}:{items:Claim[]}) {
  const stats=claimAnalytics(items)
  const reasonCounts=new Map<string,number>()
  items.flatMap(item=>item.findings).forEach(finding=>reasonCounts.set(finding.title,(reasonCounts.get(finding.title)||0)+1))
  const reasons=Array.from(reasonCounts,([n,v])=>({n,v})).sort((a,b)=>b.v-a.v).slice(0,5)
  const maxReason=Math.max(1,...reasons.map(reason=>reason.v))
  const analyzed=stats.completed.length
  const average=analyzed?Math.round(stats.completed.reduce((sum,item)=>sum+item.score,0)/analyzed):0
  const exportCsv=()=>{const rows=[['Siniestro','Asegurado','Placa','Riesgo','Score','Estado'],...items.map(item=>[item.id,item.insured,item.plate,item.risk,String(item.score),item.status])];downloadText('reporte-siniestros.csv',rows.map(row=>row.map(value=>`"${value.replaceAll('"','""')}"`).join(',')).join('\n'),'text/csv')}
  return <div className="page"><section className="welcome-row"><div><h1>Reportes y analítica</h1><p>Indicadores de detección, efectividad y tendencias operativas.</p></div><button className="secondary" onClick={exportCsv} disabled={!items.length}><Download/>Exportar reporte</button></section>
    <div className="report-filters"><span className="select-btn"><CalendarDays/>Datos disponibles</span><span className="select-btn"><SlidersHorizontal/>Ficohsa Seguros Honduras</span></div>
    <section className="metrics-grid report-metrics"><MetricCard label="Tasa de riesgo alto" value={`${items.length?(stats.high/items.length*100).toFixed(1):'0.0'}%`} note={`${stats.high} casos de ${items.length}`} icon={<Gauge/>} tone="red"/><MetricCard label="Análisis completados" value={String(analyzed)} note={`${stats.pending} aún en proceso`} icon={<ShieldAlert/>} tone="amber"/><MetricCard label="Score promedio" value={String(average)} note="Sobre los casos analizados" icon={<Sparkles/>} tone="blue"/><MetricCard label="Riesgo bajo" value={String(stats.low)} note="Casos con score menor de 35" icon={<CheckCircle2/>} tone="green"/></section>
    <div className="reports-grid"><section className="panel reasons"><div className="panel-head"><div><h3>Principales señales detectadas</h3><p>Frecuencia en los análisis disponibles</p></div></div>{reasons.length?reasons.map((r,i)=><div className="reason" key={r.n}><span>{i+1}</span><div><div><strong>{r.n}</strong><b>{r.v} casos</b></div><i><em style={{width:`${r.v/maxReason*100}%`}}/></i></div></div>):<EmptyState title="Aún no hay señales" text="Los hallazgos aparecerán cuando existan análisis completados."/>}</section>
      <section className="panel resolution"><div className="panel-head"><div><h3>Distribución de riesgo</h3><p>Resultado de los casos registrados</p></div></div><div className="resolution-ring" style={{background:`conic-gradient(#2fac82 0 ${items.length?stats.low/items.length*100:0}%,#e83e49 0 ${items.length?(stats.low+stats.high)/items.length*100:0}%,#efb04a 0)`}}><div><strong>{items.length}</strong><span>casos</span></div></div><div className="resolution-legend"><span><i className="green"/>Riesgo bajo <b>{stats.low}</b></span><span><i className="red"/>Riesgo alto <b>{stats.high}</b></span><span><i className="amber"/>Riesgo medio <b>{stats.medium}</b></span></div></section></div>
  </div>
}

function toClaim(saved:ApiClaim):Claim{return {id:saved.id,insured:saved.insuredName,vehicle:saved.vehicle,plate:saved.plate,date:new Date(saved.createdAt).toLocaleDateString('es-HN',{day:'2-digit',month:'short',year:'numeric'}),risk:saved.analysis?.risk||'Medio',score:saved.analysis?.score||0,status:saved.status==='COMPLETED'?'Analizado':saved.status==='FAILED'?'Fallido':'En análisis',reason:saved.analysis?.summary||'Análisis solicitado',policyNumber:saved.policyNumber,occurredAt:saved.occurredAt,location:saved.location,description:saved.description,recommendation:saved.analysis?.recommendation||'Pendiente de análisis',confidence:saved.analysis?.confidence||0,findings:saved.analysis?.findings||[],evidence:saved.evidence||[],createdAt:saved.createdAt}}

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [claimItems, setClaimItems] = useState<Claim[]>([])
  const [selected, setSelected] = useState<Claim|null>(null)
  const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const load=()=>{setLoading(true);setLoadError('');listClaims().then(items=>setClaimItems(items.map(toClaim))).catch(error=>setLoadError(error instanceof Error?error.message:'No fue posible cargar los siniestros')).finally(()=>setLoading(false))}
  useEffect(()=>{listClaims().then(items=>setClaimItems(items.map(toClaim))).catch(error=>setLoadError(error instanceof Error?error.message:'No fue posible cargar los siniestros')).finally(()=>setLoading(false))},[])
  const openClaim = (c: Claim) => { setSelected(c); setView('detail'); window.scrollTo({top:0}) }
  const completeClaim = (claim:Claim) => { setClaimItems(current=>[claim,...current.filter(item=>item.id!==claim.id)]); openClaim(claim) }
  const go = (v: View) => { setView(v); window.scrollTo({top:0}) }
  const titles: Record<View,string> = { dashboard: 'Centro de análisis', cases: 'Siniestros', reports: 'Reportes', new: 'Nuevo análisis', detail: 'Detalle del siniestro' }
  return <div className="app-shell"><Sidebar view={view} setView={go} open={menuOpen} close={() => setMenuOpen(false)} claimCount={claimItems.length}/><main><Topbar title={titles[view]} onMenu={() => setMenuOpen(true)}/>
    {view === 'dashboard' && <Dashboard setView={go} openClaim={openClaim} items={claimItems} loading={loading} error={loadError} retry={load}/>} {view === 'cases' && <Cases openClaim={openClaim} setView={go} items={claimItems} loading={loading} error={loadError} retry={load}/>} {view === 'new' && <NewAnalysis onDone={completeClaim} onCancel={() => go('cases')}/>} {view === 'detail' && selected && <ClaimDetail claim={selected} back={() => go('cases')}/>} {view === 'reports' && <Reports items={claimItems}/>}
  </main></div>
}
