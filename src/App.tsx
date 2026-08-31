import { useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays,
  Car, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3,
  Download, Eye, FileCheck2, FileImage, FileText, Filter, Gauge, LayoutDashboard,
  ListFilter, Menu, MessageSquareText, MoreHorizontal, Paperclip, Plus, Search,
  Send, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, UploadCloud,
  UserRound, UsersRound, X, XCircle,
} from 'lucide-react'
import { registerAndAnalyze, type ClaimRegistration } from './api/claims'

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
}

const claims: Claim[] = [
  { id: 'SIN-2026-00481', insured: 'Carlos Mendoza', vehicle: 'Toyota Hilux 2023', plate: 'HAB 4821', date: '31 ago, 2026', risk: 'Alto', score: 89, status: 'Escalado', reason: 'Patrón recurrente y posible duplicidad' },
  { id: 'SIN-2026-00480', insured: 'María López', vehicle: 'Honda CR-V 2022', plate: 'HAD 1934', date: '31 ago, 2026', risk: 'Bajo', score: 18, status: 'Por resolver', reason: 'Sin hallazgos relevantes' },
  { id: 'SIN-2026-00479', insured: 'Roberto Aguilar', vehicle: 'Ford Ranger 2021', plate: 'HAA 7602', date: '30 ago, 2026', risk: 'Medio', score: 57, status: 'En revisión', reason: 'Notificación tardía del siniestro' },
  { id: 'SIN-2026-00478', insured: 'Ana Martínez', vehicle: 'Hyundai Tucson 2024', plate: 'HBC 2456', date: '30 ago, 2026', risk: 'Alto', score: 82, status: 'Investigación', reason: 'Inconsistencias en imágenes y relato' },
  { id: 'SIN-2026-00477', insured: 'Jorge Hernández', vehicle: 'Kia Sportage 2020', plate: 'HAW 9823', date: '29 ago, 2026', risk: 'Bajo', score: 12, status: 'Aprobado', reason: 'Validaciones completadas' },
  { id: 'SIN-2026-00476', insured: 'Diana Flores', vehicle: 'Nissan Frontier 2022', plate: 'HAP 3308', date: '29 ago, 2026', risk: 'Medio', score: 64, status: 'En revisión', reason: 'Documentación incompleta' },
]

const monthly = [
  { m: 'Mar', total: 58, suspicious: 19 }, { m: 'Abr', total: 72, suspicious: 25 },
  { m: 'May', total: 66, suspicious: 18 }, { m: 'Jun', total: 85, suspicious: 31 },
  { m: 'Jul', total: 78, suspicious: 26 }, { m: 'Ago', total: 96, suspicious: 38 },
]

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="brand" aria-label="Ficohsa Seguros">
    <div className="brand-mark"><span /><span /><span /><span /></div>
    {!compact && <div><strong>Ficohsa</strong><small>SEGUROS</small></div>}
  </div>
}

function RiskPill({ risk, score }: { risk: Risk, score?: number }) {
  return <span className={`risk risk-${risk.toLowerCase()}`}><i /> {risk}{score !== undefined && ` · ${score}`}</span>
}

function Sidebar({ view, setView, open, close }: { view: View, setView: (v: View) => void, open: boolean, close: () => void }) {
  const go = (v: View) => { setView(v); close() }
  return <>
    <div className={`mobile-scrim ${open ? 'show' : ''}`} onClick={close} />
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-logo"><Logo /><button className="icon-btn mobile-only" onClick={close} aria-label="Cerrar menú"><X size={20}/></button></div>
      <div className="product-name"><ShieldCheck size={17}/><span>Gestión de Siniestros</span></div>
      <nav>
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => go('dashboard')}><LayoutDashboard/>Resumen</button>
        <button className={view === 'cases' || view === 'detail' ? 'active' : ''} onClick={() => go('cases')}><FileText/>Siniestros <b>14</b></button>
        <button onClick={() => go('new')}><Sparkles/>Nuevo análisis</button>
        <button className={view === 'reports' ? 'active' : ''} onClick={() => go('reports')}><BarChart3/>Reportes</button>
        <span className="nav-label">GESTIÓN</span>
        <button><UsersRound/>Investigadores</button>
        <button><ListFilter/>Reglas de negocio</button>
        <button><Activity/>Registro de actividad</button>
      </nav>
      <div className="sidebar-bottom">
        <button><CircleHelp/>Centro de ayuda</button>
        <button><Settings/>Configuración</button>
        <div className="user-card"><div className="avatar">LM</div><div><strong>Laura Mejía</strong><small>Analista Sr.</small></div><MoreHorizontal size={18}/></div>
      </div>
    </aside>
  </>
}

function Topbar({ title, onMenu }: { title: string, onMenu: () => void }) {
  return <header className="topbar">
    <div className="top-title"><button className="icon-btn mobile-only" onClick={onMenu} aria-label="Abrir menú"><Menu/></button><div><span>Ficohsa Seguros Honduras</span><h2>{title}</h2></div></div>
    <div className="top-actions"><button className="icon-btn notification" aria-label="Notificaciones"><Bell/><i/></button><button className="help"><CircleHelp/>Ayuda</button></div>
  </header>
}

function MetricCard({ label, value, delta, icon, tone }: { label: string, value: string, delta: string, icon: React.ReactNode, tone: string }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}>{icon}</div>
    <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small><b>{delta}</b> vs. mes anterior</small></div>
    <button className="icon-btn"><MoreHorizontal/></button>
  </article>
}

function Dashboard({ setView, openClaim }: { setView: (v: View) => void, openClaim: (c: Claim) => void }) {
  return <div className="page dashboard-page">
    <section className="welcome-row"><div><h1>Buenos días, Laura</h1><p>Este es el estado de los siniestros y alertas de fraude hoy.</p></div><button className="primary" onClick={() => setView('new')}><Plus/>Nuevo análisis</button></section>
    <section className="metrics-grid">
      <MetricCard label="Siniestros analizados" value="1,284" delta="+12.4%" icon={<FileCheck2/>} tone="blue"/>
      <MetricCard label="Sospechas detectadas" value="96" delta="+8.2%" icon={<ShieldAlert/>} tone="red"/>
      <MetricCard label="Casos confirmados" value="31" delta="+4.6%" icon={<CheckCircle2/>} tone="green"/>
      <MetricCard label="En revisión" value="14" delta="−2.1%" icon={<Clock3/>} tone="amber"/>
    </section>
    <section className="dashboard-grid">
      <article className="panel trend-panel">
        <div className="panel-head"><div><h3>Tendencia de siniestros</h3><p>Comportamiento de los últimos 6 meses</p></div><button className="select-btn"><CalendarDays/>Últimos 6 meses<ChevronDown/></button></div>
        <div className="chart-legend"><span><i className="blue-dot"/>Analizados</span><span><i className="red-dot"/>Sospechosos</span></div>
        <div className="bar-chart">
          {monthly.map(x => <div className="bar-group" key={x.m}><div className="bars"><div className="bar total" style={{height: `${x.total}%`}}/><div className="bar suspicious" style={{height: `${x.suspicious}%`}}/></div><span>{x.m}</span></div>)}
        </div>
      </article>
      <article className="panel risk-panel">
        <div className="panel-head"><div><h3>Distribución de riesgo</h3><p>Siniestros del mes actual</p></div><button className="icon-btn"><MoreHorizontal/></button></div>
        <div className="donut-row"><div className="donut"><div><strong>96</strong><span>Total alertas</span></div></div>
          <div className="risk-legend"><div><i className="high"/><span>Riesgo alto<small>Requiere investigación</small></span><strong>31</strong></div><div><i className="medium"/><span>Riesgo medio<small>Revisión manual</small></span><strong>42</strong></div><div><i className="low"/><span>Riesgo bajo<small>Monitoreo</small></span><strong>23</strong></div></div>
        </div>
      </article>
    </section>
    <section className="panel cases-panel">
      <div className="panel-head"><div><h3>Siniestros recientes</h3><p>Últimos casos evaluados por el motor de análisis</p></div><button className="text-btn" onClick={() => setView('cases')}>Ver todos <ArrowRight/></button></div>
      <ClaimsTable data={claims.slice(0, 5)} openClaim={openClaim}/>
    </section>
  </div>
}

function ClaimsTable({ data, openClaim }: { data: Claim[], openClaim: (c: Claim) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>SINIESTRO</th><th>ASEGURADO / VEHÍCULO</th><th>FECHA</th><th>NIVEL DE RIESGO</th><th>ESTADO</th><th /></tr></thead><tbody>
    {data.map(c => <tr key={c.id} onClick={() => openClaim(c)}><td><strong>{c.id}</strong><small>{c.plate}</small></td><td><strong>{c.insured}</strong><small>{c.vehicle}</small></td><td>{c.date}</td><td><RiskPill risk={c.risk} score={c.score}/></td><td><span className="status">{c.status}</span></td><td><button className="icon-btn" aria-label={`Abrir ${c.id}`}><ChevronRight/></button></td></tr>)}
  </tbody></table></div>
}

function Cases({ openClaim, setView }: { openClaim: (c: Claim) => void, setView: (v: View) => void }) {
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState('Todos')
  const filtered = useMemo(() => claims.filter(c => (risk === 'Todos' || c.risk === risk) && `${c.id} ${c.insured} ${c.plate}`.toLowerCase().includes(query.toLowerCase())), [query, risk])
  return <div className="page"><section className="welcome-row"><div><h1>Siniestros</h1><p>Consulta, analiza y da seguimiento a todos los casos.</p></div><button className="primary" onClick={() => setView('new')}><Plus/>Nuevo análisis</button></section>
    <section className="panel cases-panel full-list"><div className="filterbar"><div className="searchbox"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por siniestro, asegurado o placa..."/></div><div className="risk-filters">{['Todos','Alto','Medio','Bajo'].map(x => <button className={risk === x ? 'active' : ''} onClick={() => setRisk(x)} key={x}>{x}</button>)}</div><button className="select-btn"><Filter/>Más filtros</button></div>
      <div className="result-count">{filtered.length} de {claims.length} siniestros</div><ClaimsTable data={filtered} openClaim={openClaim}/>
    </section>
  </div>
}

function NewAnalysis({ onDone, onCancel }: { onDone: (claim: Claim) => void, onCancel: () => void }) {
  const [step, setStep] = useState(1)
  const [files, setFiles] = useState<File[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<ClaimRegistration>({ policyNumber:'AUT-HN-884291', occurredAt:'2026-08-29T22:40', insuredName:'Carlos Mendoza', identityDocument:'0801-1985-04127', vehicle:'Toyota Hilux 2023', plate:'HAB 4821', location:'Boulevard Morazán, Tegucigalpa', description:'Colisión frontal contra poste luego de perder el control del vehículo.' })
  const input = useRef<HTMLInputElement>(null)
  const field = (name: keyof ClaimRegistration) => ({ value:form[name], onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setForm({...form,[name]:event.target.value}) })
  const next = async () => {
    if (step < 3) setStep(step + 1)
    else {
      setAnalyzing(true); setError('')
      try {
        const saved=await registerAndAnalyze(form,files)
        onDone({id:saved.id,insured:saved.insuredName,vehicle:saved.vehicle,plate:saved.plate,date:new Date(saved.createdAt).toLocaleDateString('es-HN',{day:'2-digit',month:'short',year:'numeric'}),risk:saved.analysis?.risk||'Medio',score:saved.analysis?.score||0,status:saved.status==='COMPLETED'?'Analizado':'En análisis',reason:saved.analysis?.summary||'Análisis solicitado'})
      } catch (cause) { setError(cause instanceof Error?cause.message:'No fue posible registrar el siniestro'); setAnalyzing(false) }
    }
  }
  const addFiles = (list: FileList | null) => list && setFiles([...files, ...Array.from(list)].slice(0,10))
  return <div className="page form-page">
    <button className="back-link" onClick={onCancel}><ArrowLeft/>Volver a siniestros</button>
    <div className="form-title"><div><h1>Nuevo análisis de siniestro</h1><p>Ingresa la información para ejecutar las validaciones automáticas.</p></div><span>Borrador guardado</span></div>
    <div className="stepper">{['Información del siniestro','Documentos y evidencias','Revisión y análisis'].map((x,i) => <div className={step >= i+1 ? 'active' : ''} key={x}><span>{step > i+1 ? <Check/> : i+1}</span><b>{x}</b>{i < 2 && <i/>}</div>)}</div>
    <section className="panel form-panel">
      {step === 1 && <><div className="section-heading"><span><Car/></span><div><h3>Datos del siniestro</h3><p>Completa los campos obligatorios para identificar el caso.</p></div></div>
        <div className="form-grid"><label>Número de póliza *<div className="input-action"><input {...field('policyNumber')}/><button>Validar</button></div><small className="valid"><CheckCircle2/>Póliza vigente hasta 14/02/2027</small></label><label>Fecha y hora del siniestro *<input type="datetime-local" {...field('occurredAt')}/></label><label>Nombre del asegurado *<input {...field('insuredName')}/></label><label>Documento de identidad *<input {...field('identityDocument')}/></label><label>Vehículo *<input {...field('vehicle')}/></label><label>Placa *<input {...field('plate')}/></label><label className="wide">Lugar del siniestro *<input {...field('location')}/></label><label className="wide">Descripción del accidente *<textarea maxLength={2000} {...field('description')}/><small className="counter">{form.description.length} / 2000</small></label></div></>}
      {step === 2 && <><div className="section-heading"><span><Paperclip/></span><div><h3>Documentos y evidencias</h3><p>Adjunta los soportes. El sistema aplicará OCR y validaciones de integridad.</p></div></div>
        <input hidden multiple type="file" accept="application/pdf,image/jpeg,image/png,image/tiff" ref={input} onChange={e => addFiles(e.target.files)}/><button className="upload-zone" onClick={() => input.current?.click()}><UploadCloud/><strong>Arrastra los archivos o haz clic para buscar</strong><span>PDF, JPG, PNG o TIFF · Máximo 5 MB por archivo</span></button>
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

function ClaimDetail({ claim, back }: { claim: Claim, back: () => void }) {
  return <div className="page detail-page">
    <button className="back-link" onClick={back}><ArrowLeft/>Volver a siniestros</button>
    <section className="detail-title"><div><div className="eyebrow">SINIESTRO · {claim.date.toUpperCase()}</div><h1>{claim.id}</h1><p>{claim.insured} · {claim.vehicle} · {claim.plate}</p></div><div className="detail-actions"><button className="secondary"><Download/>Exportar informe</button><button className="primary"><Send/>Asignar investigador</button></div></section>
    <section className="score-hero panel"><div className="score-gauge"><svg viewBox="0 0 120 70"><path d="M15 60 A45 45 0 0 1 105 60"/><path className="fill" d="M15 60 A45 45 0 0 1 105 60"/></svg><strong>{claim.score}</strong><span>/ 100</span></div><div className="score-copy"><RiskPill risk={claim.risk}/><h2>Alta probabilidad de irregularidad</h2><p>El análisis automático encontró señales que requieren investigación antes de emitir una resolución.</p></div><div className="score-meta"><div><small>DECISIÓN SUGERIDA</small><strong><AlertTriangle/>Escalar a investigación</strong></div><div><small>CONFIANZA DEL MODELO</small><strong>94.2%</strong></div></div></section>
    <div className="detail-grid">
      <section className="panel findings"><div className="panel-head"><div><h3>Hallazgos principales</h3><p>Señales ordenadas por impacto en el score</p></div><span className="count-badge">4 hallazgos</span></div>
        <Finding tone="red" icon={<FileCheck2/>} title="Posible reclamo duplicado" score="+32" text="Coincidencia del 87% con SIN-2026-00192: mismo vehículo, ubicación y patrón de daño."/>
        <Finding tone="red" icon={<FileImage/>} title="Inconsistencia en metadatos" score="+24" text="Dos fotografías fueron capturadas 36 horas antes de la fecha declarada del accidente."/>
        <Finding tone="amber" icon={<Clock3/>} title="Notificación tardía" score="+18" text="El siniestro fue reportado 46 horas después del evento; la media del perfil es 3.2 horas."/>
        <Finding tone="amber" icon={<MessageSquareText/>} title="Contradicción en la declaración" score="+15" text="La dirección del impacto descrita no coincide con el análisis visual del vehículo."/>
      </section>
      <aside className="detail-side">
        <section className="panel case-info"><div className="panel-head"><h3>Información del caso</h3><button className="text-btn">Editar</button></div><Info label="Póliza" value="AUT-HN-884291"/><Info label="Cobertura" value="Todo riesgo"/><Info label="Monto estimado" value="L 186,400.00"/><Info label="Fecha del evento" value="29 ago, 2026 · 10:40 p. m."/><Info label="Ubicación" value="Tegucigalpa, Francisco Morazán"/></section>
        <section className="panel documents"><div className="panel-head"><h3>Evidencias</h3><span>5 archivos</span></div><div><FileText/><span><strong>Declaración del conductor</strong><small>OCR completado · 98%</small></span><button className="icon-btn"><Eye/></button></div><div><FileImage/><span><strong>Fotografías del vehículo</strong><small>3 imágenes analizadas</small></span><button className="icon-btn"><Eye/></button></div><div><FileText/><span><strong>Informe policial</strong><small>Validado</small></span><button className="icon-btn"><Eye/></button></div></section>
      </aside>
    </div>
    <section className="panel timeline"><div className="panel-head"><div><h3>Actividad del caso</h3><p>Trazabilidad completa de acciones y decisiones</p></div></div><div className="timeline-list"><div><i className="done"><Check/></i><span><strong>Análisis automático completado</strong><small>Motor de riesgo · Hoy, 10:31 a. m.</small></span></div><div><i><UploadCloud/></i><span><strong>Documentos cargados y procesados</strong><small>Laura Mejía · Hoy, 10:29 a. m.</small></span></div><div><i><Plus/></i><span><strong>Siniestro registrado</strong><small>Integración Core Seguros · Hoy, 10:27 a. m.</small></span></div></div></section>
  </div>
}

function Finding({ tone, icon, title, score, text }: { tone: string, icon: React.ReactNode, title: string, score: string, text: string }) {
  return <div className="finding"><span className={tone}>{icon}</span><div><div><strong>{title}</strong><b className={tone}>{score} pts</b></div><p>{text}</p><button>Ver evidencia <ChevronRight/></button></div></div>
}

function Info({label,value}:{label:string,value:string}) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div> }

function Reports() {
  const reasons = [{n:'Documentación inconsistente',v:78},{n:'Reclamo duplicado',v:61},{n:'Notificación tardía',v:49},{n:'Patrón de daño atípico',v:38},{n:'Contradicción en declaración',v:31}]
  return <div className="page"><section className="welcome-row"><div><h1>Reportes y analítica</h1><p>Indicadores de detección, efectividad y tendencias operativas.</p></div><button className="secondary"><Download/>Exportar reporte</button></section>
    <div className="report-filters"><button className="select-btn"><CalendarDays/>1 – 31 agosto, 2026<ChevronDown/></button><button className="select-btn"><SlidersHorizontal/>Ficohsa Seguros Honduras<ChevronDown/></button></div>
    <section className="metrics-grid report-metrics"><MetricCard label="Tasa de sospecha" value="7.5%" delta="+0.8%" icon={<Gauge/>} tone="red"/><MetricCard label="Fraudes confirmados" value="31" delta="+4.6%" icon={<ShieldAlert/>} tone="amber"/><MetricCard label="Precisión del modelo" value="92.8%" delta="+1.2%" icon={<Sparkles/>} tone="blue"/><MetricCard label="Ahorro estimado" value="L 4.2M" delta="+18.3%" icon={<CheckCircle2/>} tone="green"/></section>
    <div className="reports-grid"><section className="panel reasons"><div className="panel-head"><div><h3>Principales señales detectadas</h3><p>Participación por motivo de alerta</p></div><button className="icon-btn"><MoreHorizontal/></button></div>{reasons.map((r,i)=><div className="reason" key={r.n}><span>{i+1}</span><div><div><strong>{r.n}</strong><b>{r.v} casos</b></div><i><em style={{width:`${r.v}%`}}/></i></div></div>)}</section>
      <section className="panel resolution"><div className="panel-head"><div><h3>Resoluciones</h3><p>Resultado de los casos analizados</p></div></div><div className="resolution-ring"><div><strong>1,284</strong><span>casos</span></div></div><div className="resolution-legend"><span><i className="green"/>Aprobados <b>1,142</b></span><span><i className="red"/>Rechazados <b>31</b></span><span><i className="amber"/>En revisión <b>111</b></span></div></section></div>
  </div>
}

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [selected, setSelected] = useState<Claim>(claims[0])
  const [menuOpen, setMenuOpen] = useState(false)
  const openClaim = (c: Claim) => { setSelected(c); setView('detail'); window.scrollTo({top:0}) }
  const go = (v: View) => { setView(v); window.scrollTo({top:0}) }
  const titles: Record<View,string> = { dashboard: 'Centro de análisis', cases: 'Siniestros', reports: 'Reportes', new: 'Nuevo análisis', detail: 'Detalle del siniestro' }
  return <div className="app-shell"><Sidebar view={view} setView={go} open={menuOpen} close={() => setMenuOpen(false)}/><main><Topbar title={titles[view]} onMenu={() => setMenuOpen(true)}/>
    {view === 'dashboard' && <Dashboard setView={go} openClaim={openClaim}/>} {view === 'cases' && <Cases openClaim={openClaim} setView={go}/>} {view === 'new' && <NewAnalysis onDone={openClaim} onCancel={() => go('cases')}/>} {view === 'detail' && <ClaimDetail claim={selected} back={() => go('cases')}/>} {view === 'reports' && <Reports/>}
  </main></div>
}
