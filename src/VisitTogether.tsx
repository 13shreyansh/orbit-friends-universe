import { useEffect, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Users, X } from 'lucide-react'
import { useProductStore } from './product/store/useProductStore'
import { adoptSessionToken } from './product/api/apiClient'
import './visit-together.css'

type Party = { id:string; visitorToken:string; shareUrl?:string; ownerId?:string }
type VisitState = { planetId:string; page:number; revision:number; participants:{id:string;name:string}[] }
const savedKey='orbit-shared-visit'
function restore():Party|null {try{const party=JSON.parse(sessionStorage.getItem(savedKey)||'null');return party?.id===new URLSearchParams(location.search).get('visit')?party:null}catch{return null}}
export function VisitTogether() {
  const phase=useProductStore(s=>s.phase), session=useProductStore(s=>s.session)
  const [party,setParty]=useState<Party|null>(restore)
  const [invite,setInvite]=useState(()=>new URLSearchParams(location.search).get('visit'))
  const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false)
  const [participants,setParticipants]=useState<VisitState['participants']>([])
  const revision=useRef(-1), localIntent=useRef(false), pending=useRef<VisitState|null>(null)
  useEffect(()=>{document.body.dataset.orbitGuest=String(!!session?.readOnly);return()=>{delete document.body.dataset.orbitGuest}},[session?.readOnly])
  useEffect(()=>{
    if(!party||!session)return
    if(party.ownerId && party.ownerId!==session.userId) leave()
    else if(!party.ownerId){const value={...party,ownerId:session.userId};sessionStorage.setItem(savedKey,JSON.stringify(value));setParty(value)}
  },[party,session])
  async function request(path:string,body?:unknown,token?:string) {
    const response=await fetch('/api/orbit/visits'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})})
    const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'The shared visit could not connect.');return data
  }
  function enter(value:Party) {value={...value,ownerId:useProductStore.getState().session?.userId};sessionStorage.setItem(savedKey,JSON.stringify(value));setParty(value);setInvite(value.id);revision.current=-1;const url=new URL(location.href);url.searchParams.set('visit',value.id);history.replaceState(null,'',url)}
  async function start() {
    if(!session)return;setBusy(true);setError('')
    try{const room=await request('',{name:name.trim()||'Host'},session.token);const planetId=useProductStore.getState().activePlanetId;await request(`/${room.id}/state`,{visitorToken:room.visitorToken,planetId,page:0});enter(room);await copy(room)}catch(e){setError(e instanceof Error?e.message:'Could not start the visit.')}finally{setBusy(false)}
  }
  async function join() {
    if(!invite)return;setBusy(true);setError('')
    try{const result=await request(`/${invite}/join`,{name:name.trim()||'Friend'});adoptSessionToken(result.session.token);useProductStore.getState().authenticate(result.session,result.cosmos.profile,result.cosmos,{arrivalComplete:true});useProductStore.getState().setUniverseScale('galaxy');enter(result)}catch(e){setError(e instanceof Error?e.message:'Could not join.')}finally{setBusy(false)}
  }
  async function copy(value:Party) {
    const url=value.shareUrl||`${location.origin}/?visit=${value.id}`
    try{await navigator.clipboard.writeText(url)}catch{const input=document.createElement('textarea');input.value=url;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove()}
    setCopied(true);window.setTimeout(()=>setCopied(false),2500)
  }
  function leave() {sessionStorage.removeItem(savedKey);setParty(null);setInvite(null);pending.current=null;const url=new URL(location.href);url.searchParams.delete('visit');history.replaceState(null,'',url)}
  useEffect(()=>{
    if(!party)return
    let disposed=false,inFlight=false
    const poll=async()=>{if(inFlight)return;inFlight=true;try{const state:VisitState=await request(`/${party.id}`);if(disposed)return;setParticipants(state.participants);setError('');if(state.revision>revision.current&&!localIntent.current){revision.current=state.revision;pending.current=state}const latest=pending.current,store=useProductStore.getState();if(latest&&!localIntent.current&&!store.isTraveling){if(store.activePlanetId!==latest.planetId){window.dispatchEvent(new CustomEvent('orbit-shared-travel',{detail:{planetId:latest.planetId}}))}else{window.dispatchEvent(new CustomEvent('orbit-shared-page',{detail:{page:latest.page}}))}}}catch(e){if(!disposed)setError(e instanceof Error?e.message:'Reconnecting…')}finally{inFlight=false}}
    const publish=async(detail:{planetId?:string;page?:number})=>{localIntent.current=true;pending.current=null;try{const state=await request(`/${party.id}/state`,{visitorToken:party.visitorToken,...detail});revision.current=state.revision;pending.current=state}catch(e){setError(e instanceof Error?e.message:'Could not sync this moment.')}finally{localIntent.current=false}}
    const travel=(event:Event)=>void publish({planetId:(event as CustomEvent).detail.planetId,page:0})
    const page=(event:Event)=>void publish({page:(event as CustomEvent).detail.page})
    const heartbeat=()=>void request(`/${party.id}/heartbeat`,{visitorToken:party.visitorToken}).catch(()=>{})
    window.addEventListener('orbit-local-travel',travel);window.addEventListener('orbit-local-page',page)
    void poll();heartbeat();const timer=setInterval(()=>void poll(),1500),pulse=setInterval(heartbeat,15000)
    return()=>{disposed=true;clearInterval(timer);clearInterval(pulse);window.removeEventListener('orbit-local-travel',travel);window.removeEventListener('orbit-local-page',page)}
  },[party])
  if(invite&&!party)return <div className="visit-join-scrim"><section className="visit-join"><button className="visit-close" aria-label="Close shared visit" onClick={leave}><X size={19}/></button><Users size={29}/><span>A MEMORY IS BETTER TOGETHER</span><h2>There’s a place<br/>for you here.</h2><p>Step into the same universe. Travel between planets and turn the photographs together.</p><label htmlFor="visitor-name">What should we call you?</label><input id="visitor-name" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="Your first name"/><button className="visit-join-button" disabled={busy} onClick={()=>void join()}>{busy?<LoaderCircle className="friends-spin" size={18}/>:<Users size={18}/>} {busy?'Opening your shared universe…':'Join this memory'}</button>{error&&<p role="alert">{error}</p>}</section></div>
  if(phase!=='universe')return null
  return <aside className="visit-together">{party?<><div className="visit-live"><i/>{participants.length>1?`${participants.length} here together`:'Your place is saved'}</div><div className="visit-names">{participants.map(p=>p.name).join(' · ')||'Waiting for friends'}</div><div className="visit-actions"><button onClick={()=>void copy(party)}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Link copied':'Invite someone'}</button><button aria-label="Leave shared visit" onClick={leave}><X size={14}/></button></div></>:<button className="visit-start" disabled={busy} onClick={()=>void start()}>{busy?<LoaderCircle className="friends-spin" size={16}/>:<Users size={16}/>} Visit together</button>}{error&&<p className="visit-error" role="alert">{error}</p>}</aside>
}
