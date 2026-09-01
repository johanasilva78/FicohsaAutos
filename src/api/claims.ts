export type ClaimRegistration = {
  policyNumber:string; occurredAt:string; insuredName:string; identityDocument:string
  vehicle:string; plate:string; location:string; description:string
}

export type ApiFinding = { title:string; detail:string; impact:number; evidence:string }
export type ApiEvidence = { name:string; contentType:string; size:number; status?:string }
export type ApiClaim = ClaimRegistration & {
  id:string; status:string; createdAt:string; updatedAt?:string; identityDocumentMasked?:string
  evidence?:ApiEvidence[]
  analysis?:{score:number;risk:'Alto'|'Medio'|'Bajo';recommendation:string;summary:string;confidence?:number;findings?:ApiFinding[]}
}
const API_URL=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')

function headers(){const token=sessionStorage.getItem('ficohsa_access_token')||import.meta.env.VITE_AUTH_TOKEN;return {'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}}
async function json<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,init);const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||`Error ${response.status}`);return data}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

export async function listClaims():Promise<ApiClaim[]>{
  if(!API_URL)throw new Error('Falta configurar VITE_API_URL')
  const result=await json<{items:ApiClaim[]}>(`${API_URL}/claims`,{headers:headers()})
  return result.items||[]
}

export async function registerAndAnalyze(input:ClaimRegistration,files:File[]):Promise<ApiClaim>{
  const oversized=files.find(file=>file.size>4*1024*1024)
  if(oversized)throw new Error(`${oversized.name} excede el máximo de 4 MB`)
  if(!API_URL)throw new Error('Falta configurar VITE_API_URL')
  const created=await json<{claimId:string;uploadUrls:{url?:string;path?:string;name:string}[]}>(`${API_URL}/claims`,{method:'POST',headers:headers(),body:JSON.stringify({...input,evidence:files.map(file=>({name:file.name,contentType:file.type,size:file.size}))})})
  await Promise.all(created.uploadUrls.map(async upload=>{const file=files.find(x=>x.name===upload.name);if(!file)throw new Error(`No se encontró ${upload.name}`);const target=upload.url||(upload.path?`${API_URL}${upload.path}`:'');if(!target)throw new Error(`No se recibió una ruta de carga para ${file.name}`);const result=await fetch(target,{method:'PUT',headers:{'content-type':file.type},body:file});if(!result.ok){const data=await result.json().catch(()=>({}));throw new Error(data.message||`No se pudo cargar ${file.name}`)}}))
  await json(`${API_URL}/claims/${created.claimId}/analyze`,{method:'POST',headers:headers()})
  for(let attempt=0;attempt<45;attempt++){await wait(2000);const claim=await json<ApiClaim>(`${API_URL}/claims/${created.claimId}`,{headers:headers()});if(claim.status==='COMPLETED')return claim;if(claim.status==='FAILED')throw new Error('El análisis automático falló; el expediente quedó registrado para reintento')}
  throw new Error('El análisis continúa en segundo plano. Consulta el expediente en unos minutos')
}
